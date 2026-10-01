-- Resultado — Fase 4: Caixa.
--
-- Caixa = receitas da IULI pela DATA DE VENCIMENTO (quando o dinheiro entra),
-- só as de categoria "de produto" (iuli_category_map.tratamento = 'soma'). O que
-- não é produto (a classificar, outras receitas, não operacional, a revisar) e o
-- que ainda não tem categoria carregada ficam fora da soma e são mostrados à
-- parte. Valor do caixa: recebido = valor pago; em aberto = valor previsto.

create or replace view public.caixa_lancamentos_v with (security_invoker = true) as
select
  r.workspace_id,
  r.integration_id,
  r.iuli_id,
  i.label as empresa,
  r.empresa as cliente,
  r.description,
  r.due_date,
  r.pagamento,
  r.status,
  case
    when r.status = 'recebida' then 'recebido'
    when r.due_date < (now() at time zone 'America/Sao_Paulo')::date then 'vencido'
    else 'a_vencer'
  end as situacao,
  r.categoria_id,
  r.categoria,
  case when r.categoria_id is null then 'sem_categoria' else coalesce(m.tratamento, 'revisar') end as tratamento,
  case when m.tratamento = 'soma' then coalesce(nullif(m.produto, ''), r.categoria) end as produto,
  case when r.status = 'recebida' then coalesce(r.valor_pago, r.valor, 0) else coalesce(r.valor, 0) end as valor_caixa
from public.iuli_receivables r
join public.integrations i on i.id = r.integration_id
left join public.iuli_category_map m
  on m.workspace_id = r.workspace_id and m.nome_norm = public.iuli_norm(btrim(r.categoria))
where r.removed_at is null;

-- Série por período (só receita de produto), por situação.
create or replace function public.caixa_series(
  p_workspace_id uuid, p_from date, p_to date, p_grain text default 'day',
  p_integration_ids uuid[] default null, p_produto text[] default null, p_excluir_ee boolean default true
)
returns table (bucket date, situacao text, qtd bigint, total numeric)
language sql stable security definer set search_path = public
as $$
  select date_trunc(case when p_grain in ('week', 'month') then p_grain else 'day' end, v.due_date::timestamp)::date,
         v.situacao, count(*), coalesce(sum(v.valor_caixa), 0)
  from public.caixa_lancamentos_v v
  where public.is_workspace_member(p_workspace_id)
    and v.workspace_id = p_workspace_id
    and v.due_date between p_from and p_to
    and v.tratamento = 'soma'
    and (p_integration_ids is null or v.integration_id = any(p_integration_ids))
    and (p_produto is null or v.produto = any(p_produto))
    and (not p_excluir_ee or not public.iuli_is_intercompany(v.workspace_id, v.cliente))
  group by 1, 2;
$$;

-- Totais por situação e produto.
create or replace function public.caixa_summary(
  p_workspace_id uuid, p_from date, p_to date,
  p_integration_ids uuid[] default null, p_produto text[] default null, p_excluir_ee boolean default true
)
returns table (situacao text, produto text, qtd bigint, total numeric)
language sql stable security definer set search_path = public
as $$
  select v.situacao, v.produto, count(*), coalesce(sum(v.valor_caixa), 0)
  from public.caixa_lancamentos_v v
  where public.is_workspace_member(p_workspace_id)
    and v.workspace_id = p_workspace_id
    and v.due_date between p_from and p_to
    and v.tratamento = 'soma'
    and (p_integration_ids is null or v.integration_id = any(p_integration_ids))
    and (p_produto is null or v.produto = any(p_produto))
    and (not p_excluir_ee or not public.iuli_is_intercompany(v.workspace_id, v.cliente))
  group by 1, 2;
$$;

-- O que ficou FORA da soma, por tratamento (inclui "sem categoria carregada").
create or replace function public.caixa_fora(
  p_workspace_id uuid, p_from date, p_to date,
  p_integration_ids uuid[] default null, p_excluir_ee boolean default true
)
returns table (tratamento text, categoria text, qtd bigint, total numeric)
language sql stable security definer set search_path = public
as $$
  select v.tratamento, coalesce(v.categoria, '(sem categoria)'), count(*), coalesce(sum(v.valor_caixa), 0)
  from public.caixa_lancamentos_v v
  where public.is_workspace_member(p_workspace_id)
    and v.workspace_id = p_workspace_id
    and v.due_date between p_from and p_to
    and v.tratamento <> 'soma'
    and (p_integration_ids is null or v.integration_id = any(p_integration_ids))
    and (not p_excluir_ee or not public.iuli_is_intercompany(v.workspace_id, v.cliente))
  group by 1, 2;
$$;

-- Clientes que mais pagam / mais devem no período.
create or replace function public.caixa_clientes(
  p_workspace_id uuid, p_from date, p_to date,
  p_integration_ids uuid[] default null, p_produto text[] default null, p_excluir_ee boolean default true,
  p_limit integer default 10
)
returns table (cliente text, qtd bigint, total numeric, recebido numeric, aberto numeric)
language sql stable security definer set search_path = public
as $$
  select coalesce(v.cliente, '(sem nome)'), count(*), coalesce(sum(v.valor_caixa), 0),
         coalesce(sum(v.valor_caixa) filter (where v.situacao = 'recebido'), 0),
         coalesce(sum(v.valor_caixa) filter (where v.situacao <> 'recebido'), 0)
  from public.caixa_lancamentos_v v
  where public.is_workspace_member(p_workspace_id)
    and v.workspace_id = p_workspace_id
    and v.due_date between p_from and p_to
    and v.tratamento = 'soma'
    and (p_integration_ids is null or v.integration_id = any(p_integration_ids))
    and (p_produto is null or v.produto = any(p_produto))
    and (not p_excluir_ee or not public.iuli_is_intercompany(v.workspace_id, v.cliente))
  group by 1
  order by 3 desc
  limit least(greatest(p_limit, 1), 100);
$$;

-- Vencido de hoje (independe do período), por faixa de atraso.
create or replace function public.caixa_aging(
  p_workspace_id uuid,
  p_integration_ids uuid[] default null, p_produto text[] default null, p_excluir_ee boolean default true
)
returns table (faixa text, ordem integer, qtd bigint, total numeric)
language sql stable security definer set search_path = public
as $$
  with hoje as (select (now() at time zone 'America/Sao_Paulo')::date as d)
  select case
           when h.d - v.due_date <= 30 then 'Até 30 dias'
           when h.d - v.due_date <= 90 then '31 a 90 dias'
           when h.d - v.due_date <= 180 then '91 a 180 dias'
           when h.d - v.due_date <= 365 then '181 a 365 dias'
           else 'Mais de 1 ano'
         end,
         case
           when h.d - v.due_date <= 30 then 1
           when h.d - v.due_date <= 90 then 2
           when h.d - v.due_date <= 180 then 3
           when h.d - v.due_date <= 365 then 4
           else 5
         end,
         count(*), coalesce(sum(v.valor_caixa), 0)
  from public.caixa_lancamentos_v v, hoje h
  where public.is_workspace_member(p_workspace_id)
    and v.workspace_id = p_workspace_id
    and v.situacao = 'vencido'
    and v.tratamento = 'soma'
    and (p_integration_ids is null or v.integration_id = any(p_integration_ids))
    and (p_produto is null or v.produto = any(p_produto))
    and (not p_excluir_ee or not public.iuli_is_intercompany(v.workspace_id, v.cliente))
  group by 1, 2;
$$;

-- Títulos do período (maiores, ou só uma situação).
create or replace function public.caixa_titulos(
  p_workspace_id uuid, p_from date, p_to date,
  p_situacao text default null,
  p_integration_ids uuid[] default null, p_produto text[] default null, p_excluir_ee boolean default true,
  p_limit integer default 20
)
returns table (empresa text, cliente text, categoria text, produto text, due_date date, pagamento date, situacao text, valor numeric)
language sql stable security definer set search_path = public
as $$
  select v.empresa, v.cliente, v.categoria, v.produto, v.due_date, v.pagamento, v.situacao, v.valor_caixa
  from public.caixa_lancamentos_v v
  where public.is_workspace_member(p_workspace_id)
    and v.workspace_id = p_workspace_id
    and v.due_date between p_from and p_to
    and v.tratamento = 'soma'
    and (p_situacao is null or v.situacao = p_situacao)
    and (p_integration_ids is null or v.integration_id = any(p_integration_ids))
    and (p_produto is null or v.produto = any(p_produto))
    and (not p_excluir_ee or not public.iuli_is_intercompany(v.workspace_id, v.cliente))
  order by v.valor_caixa desc
  limit least(greatest(p_limit, 1), 200);
$$;

-- Produtos com entrada no período (para o filtro).
create or replace function public.caixa_produtos(p_workspace_id uuid, p_from date, p_to date)
returns table (produto text, total numeric)
language sql stable security definer set search_path = public
as $$
  select v.produto, coalesce(sum(v.valor_caixa), 0)
  from public.caixa_lancamentos_v v
  where public.is_workspace_member(p_workspace_id)
    and v.workspace_id = p_workspace_id and v.due_date between p_from and p_to and v.tratamento = 'soma'
  group by 1 order by 2 desc;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'caixa_series(uuid, date, date, text, uuid[], text[], boolean)',
    'caixa_summary(uuid, date, date, uuid[], text[], boolean)',
    'caixa_fora(uuid, date, date, uuid[], boolean)',
    'caixa_clientes(uuid, date, date, uuid[], text[], boolean, integer)',
    'caixa_aging(uuid, uuid[], text[], boolean)',
    'caixa_titulos(uuid, date, date, text, uuid[], text[], boolean, integer)',
    'caixa_produtos(uuid, date, date)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

insert into public.permission_keys (key, category, label, sort_order) values
  ('menu.resultado.caixa', 'resultado', 'Resultado · Caixa', 61)
on conflict (key) do nothing;

insert into public.role_permissions (workspace_id, role, permission_key, granted)
select w.id, 'manager'::public.workspace_role, 'menu.resultado.caixa', true
from public.workspaces w
on conflict (workspace_id, role, permission_key) do update set granted = excluded.granted;
