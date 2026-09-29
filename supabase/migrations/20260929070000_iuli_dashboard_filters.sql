-- Dashboard Financeiro IULI — Fase B: filtros.
--
-- As telas passam a agregar os registros (iuli_sales/receivables/invoices/
-- subscriptions) em vez dos totais fixos dos snapshots, com filtro de período
-- livre, empresa (uma ou todas), cliente, status, produto e origem.
--
-- Tudo aqui é security invoker: o RLS das tabelas limita cada usuário ao
-- próprio workspace.

-- ---------------------------------------------------------------------------
-- Normalização de nomes (sem acento, minúsculo) — pra casar "Deândhela" com
-- "DEANDHELA". Sem depender da extensão unaccent.
-- ---------------------------------------------------------------------------
create or replace function public.iuli_norm(p text)
returns text
language sql
immutable
as $$
  select lower(translate(coalesce(p, ''),
    'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
    'aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn'));
$$;

-- ---------------------------------------------------------------------------
-- Operações entre as empresas do grupo: contrapartes que, no consolidado,
-- contariam em dobro (a receber de uma = a pagar da outra). pattern é um LIKE
-- sobre o nome normalizado (iuli_norm).
-- ---------------------------------------------------------------------------
create table if not exists public.iuli_counterparty_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  pattern text not null,
  label text,
  created_at timestamptz not null default now(),
  unique (workspace_id, pattern)
);

alter table public.iuli_counterparty_rules enable row level security;
drop policy if exists "iuli_counterparty_rules_member" on public.iuli_counterparty_rules;
create policy "iuli_counterparty_rules_member" on public.iuli_counterparty_rules for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

-- Contrapartes encontradas nos dados em 29/09/2026 (Instituto Deandhela ↔ Memorável).
insert into public.iuli_counterparty_rules (workspace_id, pattern, label)
select distinct i.workspace_id, r.pattern, r.label
from public.integrations i
cross join (values
  ('%memoravel global%', 'Memorável Global LTDA'),
  ('%instituto deandhela desenvolvimento%', 'Instituto Deandhela Desenvolvimento Humano LTDA'),
  ('instituto deandhela', 'Instituto Deândhela (a própria empresa)')
) as r(pattern, label)
where i.provider = 'iuli'
on conflict (workspace_id, pattern) do nothing;

create or replace function public.iuli_is_intercompany(p_workspace_id uuid, p_name text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.iuli_counterparty_rules r
    where r.workspace_id = p_workspace_id and public.iuli_norm(p_name) like r.pattern
  );
$$;

-- ---------------------------------------------------------------------------
-- Views enriquecidas (sem os registros marcados como removidos)
-- ---------------------------------------------------------------------------

-- Vendas: + empresa, origem (plataforma) e produto. A IULI não traz produto na
-- venda; ele vem do cruzamento do external_id com as vendas da Hubla
-- (invoice_id) e da TMB (pedido_id) que o Farol já sincroniza. Mês/dia da
-- venda em UTC, igual a IULI (conferido em 29/09/2026).
create or replace view public.iuli_sales_v with (security_invoker = true) as
select
  s.integration_id,
  s.iuli_id,
  s.workspace_id,
  i.label as empresa,
  s.status,
  s.valor_total,
  s.valor_liquido,
  s.competencia,
  (s.competencia at time zone 'UTC')::date as dia,
  s.pagamento,
  s.external_id,
  s.cliente,
  coalesce(h.product_name, t.product_name) as produto,
  case
    when h.invoice_id is not null then 'hubla'
    when t.pedido_id is not null or s.external_id ~* '^tmb_' then 'tmb'
    when s.external_id ~ '^HP' then 'hotmart'
    when s.external_id ~ '^(Vda_)?\d{8}_\d+$' then 'importacao'
    when s.external_id is null then 'sem_id'
    else 'outra'
  end as origem,
  case s.status
    when 'aprovada' then 'efetiva' when 'concluida' then 'efetiva'
    when 'cancelada' then 'perdida' when 'reembolsada' then 'perdida'
    when 'chargeback' then 'perdida' when 'expirada' then 'perdida'
    else 'aberta'
  end as grupo,
  public.iuli_is_intercompany(s.workspace_id, s.cliente) as entre_empresas
from public.iuli_sales s
join public.integrations i on i.id = s.integration_id
left join lateral (
  select h.invoice_id, h.product_name from public.hubla_sales h
  where h.workspace_id = s.workspace_id and h.invoice_id = s.external_id
  limit 1
) h on true
left join lateral (
  select t.pedido_id, t.product_name from public.tmb_sales t
  where s.external_id ~ '^\d{1,15}$' and t.workspace_id = s.workspace_id and t.pedido_id = s.external_id::bigint
  limit 1
) t on true
where s.removed_at is null;

-- Títulos a receber: + empresa, situação na data de hoje (fuso de SP) e marca entre empresas.
create or replace view public.iuli_receivables_v with (security_invoker = true) as
select
  r.integration_id,
  r.iuli_id,
  r.workspace_id,
  i.label as empresa,
  r.description,
  r.status,
  r.due_date,
  r.competencia,
  r.pagamento,
  r.valor,
  r.valor_pago,
  r.juros,
  r.empresa as cliente,
  r.nf_numero,
  r.tem_nf,
  r.tem_anexo,
  r.tem_comprovante,
  r.tem_boleto,
  case
    when r.status = 'recebida' then 'recebido'
    when r.due_date < (now() at time zone 'America/Sao_Paulo')::date then 'vencido'
    else 'a_vencer'
  end as situacao,
  public.iuli_is_intercompany(r.workspace_id, r.empresa) as entre_empresas
from public.iuli_receivables r
join public.integrations i on i.id = r.integration_id
where r.removed_at is null;

create or replace view public.iuli_invoices_v with (security_invoker = true) as
select
  n.integration_id, n.iuli_id, n.workspace_id, i.label as empresa,
  n.numero, n.valor, n.status, n.detalhe_status, n.venda_id, n.criada_em,
  (n.criada_em at time zone 'UTC')::date as dia
from public.iuli_invoices n
join public.integrations i on i.id = n.integration_id
where n.removed_at is null;

create or replace view public.iuli_subscriptions_v with (security_invoker = true) as
select
  a.integration_id, a.iuli_id, a.workspace_id, i.label as empresa,
  a.status, a.ciclo, a.valor, a.valor_mensalizado, a.forma_pagamento, a.origem,
  a.criada_em, (a.criada_em at time zone 'UTC')::date as dia, a.cliente, a.produto
from public.iuli_subscriptions a
join public.integrations i on i.id = a.integration_id
where a.removed_at is null;

-- ---------------------------------------------------------------------------
-- Agregações. Parâmetros comuns:
--   p_integration_ids  null = todas as empresas do workspace
--   p_from / p_to      null = sem filtro de período
--   p_grain            'day' | 'week' | 'month' | 'none' (sem série: bucket null)
--   p_cliente          busca por parte do nome (sem acento)
--   p_excluir_entre_empresas  tira as operações entre as empresas do grupo
-- ---------------------------------------------------------------------------

create or replace function public.iuli_bucket(p_day date, p_grain text)
returns date
language sql
immutable
as $$
  select case p_grain
    when 'day' then p_day
    when 'week' then date_trunc('week', p_day)::date
    when 'month' then date_trunc('month', p_day)::date
    else null
  end;
$$;

-- Vendas por período × status (a tela monta KPIs, gráfico e tabela disso).
create or replace function public.iuli_sales_agg(
  p_workspace_id uuid,
  p_integration_ids uuid[] default null,
  p_from date default null,
  p_to date default null,
  p_grain text default 'none',
  p_cliente text default null,
  p_status text[] default null,
  p_produto text[] default null,
  p_origem text[] default null,
  p_excluir_entre_empresas boolean default false
)
returns table (bucket date, status text, grupo text, qtd bigint, total numeric, liquido numeric)
language sql
stable
set search_path = public
as $$
  select public.iuli_bucket(v.dia, p_grain), v.status, v.grupo, count(*), coalesce(sum(v.valor_total), 0), coalesce(sum(v.valor_liquido), 0)
  from public.iuli_sales_v v
  where v.workspace_id = p_workspace_id
    and (p_integration_ids is null or v.integration_id = any(p_integration_ids))
    and (p_from is null or v.dia >= p_from)
    and (p_to is null or v.dia <= p_to)
    and (p_cliente is null or public.iuli_norm(v.cliente) like '%' || public.iuli_norm(p_cliente) || '%')
    and (p_status is null or v.status = any(p_status))
    and (p_produto is null or coalesce(v.produto, '(não identificado)') = any(p_produto))
    and (p_origem is null or v.origem = any(p_origem))
    and (not p_excluir_entre_empresas or not v.entre_empresas)
  group by 1, 2, 3;
$$;

-- Ranking de produtos ou clientes (p_dim = 'produto' | 'cliente' | 'origem' | 'empresa').
create or replace function public.iuli_sales_top(
  p_workspace_id uuid,
  p_dim text,
  p_integration_ids uuid[] default null,
  p_from date default null,
  p_to date default null,
  p_cliente text default null,
  p_status text[] default null,
  p_produto text[] default null,
  p_origem text[] default null,
  p_excluir_entre_empresas boolean default false,
  p_limit integer default 15
)
returns table (nome text, qtd bigint, total numeric)
language sql
stable
set search_path = public
as $$
  select
    case p_dim
      when 'produto' then coalesce(v.produto, '(não identificado)')
      when 'cliente' then coalesce(v.cliente, '(sem nome)')
      when 'origem' then v.origem
      else coalesce(v.empresa, '(sem nome)')
    end as nome,
    count(*), coalesce(sum(v.valor_total), 0)
  from public.iuli_sales_v v
  where v.workspace_id = p_workspace_id
    and (p_integration_ids is null or v.integration_id = any(p_integration_ids))
    and (p_from is null or v.dia >= p_from)
    and (p_to is null or v.dia <= p_to)
    and (p_cliente is null or public.iuli_norm(v.cliente) like '%' || public.iuli_norm(p_cliente) || '%')
    and (p_status is null or v.status = any(p_status))
    and (p_produto is null or coalesce(v.produto, '(não identificado)') = any(p_produto))
    and (p_origem is null or v.origem = any(p_origem))
    and (not p_excluir_entre_empresas or not v.entre_empresas)
  group by 1
  order by 3 desc
  limit p_limit;
$$;

-- Opções dos filtros de vendas (produtos, origens, status) com contagem.
create or replace function public.iuli_sales_options(p_workspace_id uuid, p_integration_ids uuid[] default null)
returns table (kind text, value text, qtd bigint)
language sql
stable
set search_path = public
as $$
  select 'produto', coalesce(v.produto, '(não identificado)'), count(*) from public.iuli_sales_v v
  where v.workspace_id = p_workspace_id and (p_integration_ids is null or v.integration_id = any(p_integration_ids)) group by 2
  union all
  select 'origem', v.origem, count(*) from public.iuli_sales_v v
  where v.workspace_id = p_workspace_id and (p_integration_ids is null or v.integration_id = any(p_integration_ids)) group by 2
  union all
  select 'status', v.status, count(*) from public.iuli_sales_v v
  where v.workspace_id = p_workspace_id and (p_integration_ids is null or v.integration_id = any(p_integration_ids)) group by 2;
$$;

-- Títulos: fluxo no período.
--   serie 'vence_recebido' / 'vence_aberto' = títulos que VENCEM no período (já pagos / sem baixa)
--   serie 'recebido' = o que foi RECEBIDO no período (pela data do pagamento)
create or replace function public.iuli_receivables_flow(
  p_workspace_id uuid,
  p_integration_ids uuid[] default null,
  p_from date default null,
  p_to date default null,
  p_grain text default 'none',
  p_cliente text default null,
  p_nf text default null, -- 'com' | 'sem'
  p_excluir_entre_empresas boolean default false
)
returns table (bucket date, serie text, qtd bigint, total numeric)
language sql
stable
set search_path = public
as $$
  with base as (
    select * from public.iuli_receivables_v v
    where v.workspace_id = p_workspace_id
      and (p_integration_ids is null or v.integration_id = any(p_integration_ids))
      and (p_cliente is null or public.iuli_norm(v.cliente) like '%' || public.iuli_norm(p_cliente) || '%')
      and (p_nf is null or (p_nf = 'com') = v.tem_nf)
      and (not p_excluir_entre_empresas or not v.entre_empresas)
  )
  select public.iuli_bucket(due_date, p_grain), case when status = 'recebida' then 'vence_recebido' else 'vence_aberto' end, count(*),
         coalesce(sum(case when status = 'recebida' then valor_pago else valor end), 0)
  from base
  where (p_from is null or due_date >= p_from) and (p_to is null or due_date <= p_to)
  group by 1, 2
  union all
  select public.iuli_bucket(pagamento, p_grain), 'recebido', count(*), coalesce(sum(valor_pago), 0)
  from base
  where status = 'recebida' and pagamento is not null
    and (p_from is null or pagamento >= p_from) and (p_to is null or pagamento <= p_to)
  group by 1, 2;
$$;

-- Títulos: posição de hoje (sem baixa por faixa de vencimento) — não depende do período.
create or replace function public.iuli_receivables_position(
  p_workspace_id uuid,
  p_integration_ids uuid[] default null,
  p_cliente text default null,
  p_nf text default null,
  p_excluir_entre_empresas boolean default false
)
returns table (faixa text, qtd bigint, total numeric, com_nf bigint, com_anexo bigint)
language sql
stable
set search_path = public
as $$
  with hoje as (select (now() at time zone 'America/Sao_Paulo')::date as d)
  select
    case
      when v.due_date < hoje.d - 365 then 'vencido_365_mais'
      when v.due_date < hoje.d - 180 then 'vencido_181_365'
      when v.due_date < hoje.d - 90 then 'vencido_91_180'
      when v.due_date < hoje.d - 30 then 'vencido_31_90'
      when v.due_date < hoje.d then 'vencido_1_30'
      when v.due_date <= hoje.d + 30 then 'a_vencer_0_30'
      when v.due_date <= hoje.d + 90 then 'a_vencer_31_90'
      when v.due_date <= hoje.d + 180 then 'a_vencer_91_180'
      else 'a_vencer_180_mais'
    end,
    count(*), coalesce(sum(v.valor), 0),
    count(*) filter (where v.tem_nf), count(*) filter (where v.tem_anexo)
  from public.iuli_receivables_v v, hoje
  where v.workspace_id = p_workspace_id
    and v.status <> 'recebida'
    and (p_integration_ids is null or v.integration_id = any(p_integration_ids))
    and (p_cliente is null or public.iuli_norm(v.cliente) like '%' || public.iuli_norm(p_cliente) || '%')
    and (p_nf is null or (p_nf = 'com') = v.tem_nf)
    and (not p_excluir_entre_empresas or not v.entre_empresas)
  group by 1;
$$;

-- Notas por período × status.
create or replace function public.iuli_invoices_agg(
  p_workspace_id uuid,
  p_integration_ids uuid[] default null,
  p_from date default null,
  p_to date default null,
  p_grain text default 'none',
  p_status text[] default null
)
returns table (bucket date, status text, qtd bigint, total numeric)
language sql
stable
set search_path = public
as $$
  select public.iuli_bucket(v.dia, p_grain), v.status, count(*), coalesce(sum(v.valor), 0)
  from public.iuli_invoices_v v
  where v.workspace_id = p_workspace_id
    and (p_integration_ids is null or v.integration_id = any(p_integration_ids))
    and (p_from is null or v.dia >= p_from)
    and (p_to is null or v.dia <= p_to)
    and (p_status is null or v.status = any(p_status))
  group by 1, 2;
$$;

-- Assinaturas por (mês/dia de criação) × produto × ciclo × status.
create or replace function public.iuli_subscriptions_agg(
  p_workspace_id uuid,
  p_integration_ids uuid[] default null,
  p_from date default null,
  p_to date default null,
  p_grain text default 'none',
  p_cliente text default null,
  p_produto text[] default null,
  p_ciclo text[] default null,
  p_status text[] default null
)
returns table (bucket date, produto text, ciclo text, status text, qtd bigint, mensal numeric, valor numeric)
language sql
stable
set search_path = public
as $$
  select public.iuli_bucket(v.dia, p_grain), coalesce(v.produto, '(sem produto)'), v.ciclo, v.status,
         count(*), coalesce(sum(v.valor_mensalizado), 0), coalesce(sum(v.valor), 0)
  from public.iuli_subscriptions_v v
  where v.workspace_id = p_workspace_id
    and (p_integration_ids is null or v.integration_id = any(p_integration_ids))
    and (p_from is null or v.dia >= p_from)
    and (p_to is null or v.dia <= p_to)
    and (p_cliente is null or public.iuli_norm(v.cliente) like '%' || public.iuli_norm(p_cliente) || '%')
    and (p_produto is null or coalesce(v.produto, '(sem produto)') = any(p_produto))
    and (p_ciclo is null or v.ciclo = any(p_ciclo))
    and (p_status is null or v.status = any(p_status))
  group by 1, 2, 3, 4;
$$;

grant select on public.iuli_sales_v, public.iuli_receivables_v, public.iuli_invoices_v, public.iuli_subscriptions_v to authenticated;
grant execute on function
  public.iuli_norm(text),
  public.iuli_is_intercompany(uuid, text),
  public.iuli_bucket(date, text),
  public.iuli_sales_agg(uuid, uuid[], date, date, text, text, text[], text[], text[], boolean),
  public.iuli_sales_top(uuid, text, uuid[], date, date, text, text[], text[], text[], boolean, integer),
  public.iuli_sales_options(uuid, uuid[]),
  public.iuli_receivables_flow(uuid, uuid[], date, date, text, text, text, boolean),
  public.iuli_receivables_position(uuid, uuid[], text, text, boolean),
  public.iuli_invoices_agg(uuid, uuid[], date, date, text, text[]),
  public.iuli_subscriptions_agg(uuid, uuid[], date, date, text, text, text[], text[], text[])
to authenticated;
