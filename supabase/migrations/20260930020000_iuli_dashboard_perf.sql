-- Dashboard Financeiro IULI — desempenho.
--
-- Como security invoker, as agregações rodavam o RLS (is_workspace_member)
-- LINHA A LINHA em ~42 mil vendas, e de novo em hubla_sales/tmb_sales (join
-- do produto). Pra um usuário logado: 1,3s a 6,5s por consulta; com ~10
-- consultas simultâneas na tela, várias passavam do statement_timeout de 8s do
-- papel authenticated e a tela mostrava zero.
--
-- Agora as funções são security definer e checam a permissão UMA vez —
-- (select public.is_workspace_member(p_workspace_id)) vira initplan — e
-- filtram sempre por p_workspace_id. Mesma garantia: ninguém lê outro workspace.
-- Mais índices na data (UTC, igual à IULI) pro filtro de período.

create index if not exists iuli_sales_ws_dia_idx
  on public.iuli_sales (workspace_id, ((competencia at time zone 'UTC')::date));
create index if not exists iuli_invoices_ws_dia_idx
  on public.iuli_invoices (workspace_id, ((criada_em at time zone 'UTC')::date));
create index if not exists iuli_subscriptions_ws_dia_idx
  on public.iuli_subscriptions (workspace_id, ((criada_em at time zone 'UTC')::date));

-- ---------------------------------------------------------------------------
-- Vendas
-- ---------------------------------------------------------------------------

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
security definer
set search_path = public
as $$
  select public.iuli_bucket(v.dia, p_grain), v.status, v.grupo, count(*), coalesce(sum(v.valor_total), 0), coalesce(sum(v.valor_liquido), 0)
  from public.iuli_sales_v v
  where (select public.is_workspace_member(p_workspace_id))
    and v.workspace_id = p_workspace_id
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
security definer
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
  where (select public.is_workspace_member(p_workspace_id))
    and v.workspace_id = p_workspace_id
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

-- Opções dos filtros: uma passada só (antes eram três varreduras completas).
create or replace function public.iuli_sales_options(p_workspace_id uuid, p_integration_ids uuid[] default null)
returns table (kind text, value text, qtd bigint)
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select coalesce(v.produto, '(não identificado)') as produto, v.origem, v.status
    from public.iuli_sales_v v
    where (select public.is_workspace_member(p_workspace_id))
      and v.workspace_id = p_workspace_id
      and (p_integration_ids is null or v.integration_id = any(p_integration_ids))
  ),
  g as (
    select produto, origem, status, count(*) as qtd from base group by grouping sets ((produto), (origem), (status))
  )
  select 'produto', produto, qtd from g where produto is not null and origem is null and status is null
  union all
  select 'origem', origem, qtd from g where origem is not null and produto is null and status is null
  union all
  select 'status', status, qtd from g where status is not null and produto is null and origem is null;
$$;

-- Lista das maiores vendas (antes era uma consulta direta à view, com RLS por linha).
create or replace function public.iuli_sales_list(
  p_workspace_id uuid,
  p_integration_ids uuid[] default null,
  p_from date default null,
  p_to date default null,
  p_cliente text default null,
  p_status text[] default null,
  p_produto text[] default null,
  p_origem text[] default null,
  p_excluir_entre_empresas boolean default false,
  p_limit integer default 50
)
returns table (iuli_id bigint, empresa text, status text, valor_total numeric, dia date, cliente text, produto text, origem text, total_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select v.iuli_id, v.empresa, v.status, v.valor_total, v.dia, v.cliente, v.produto, v.origem, count(*) over ()
  from public.iuli_sales_v v
  where (select public.is_workspace_member(p_workspace_id))
    and v.workspace_id = p_workspace_id
    and (p_integration_ids is null or v.integration_id = any(p_integration_ids))
    and (p_from is null or v.dia >= p_from)
    and (p_to is null or v.dia <= p_to)
    and (p_cliente is null or public.iuli_norm(v.cliente) like '%' || public.iuli_norm(p_cliente) || '%')
    and (p_status is null or v.status = any(p_status))
    and (p_produto is null or coalesce(v.produto, '(não identificado)') = any(p_produto))
    and (p_origem is null or v.origem = any(p_origem))
    and (not p_excluir_entre_empresas or not v.entre_empresas)
  order by v.valor_total desc nulls last
  limit p_limit;
$$;

-- ---------------------------------------------------------------------------
-- Títulos
-- ---------------------------------------------------------------------------

create or replace function public.iuli_receivables_flow(
  p_workspace_id uuid,
  p_integration_ids uuid[] default null,
  p_from date default null,
  p_to date default null,
  p_grain text default 'none',
  p_cliente text default null,
  p_nf text default null,
  p_excluir_entre_empresas boolean default false
)
returns table (bucket date, serie text, qtd bigint, total numeric)
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select * from public.iuli_receivables_v v
    where (select public.is_workspace_member(p_workspace_id))
      and v.workspace_id = p_workspace_id
      and (p_integration_ids is null or v.integration_id = any(p_integration_ids))
      and (p_cliente is null or public.iuli_norm(v.cliente) like '%' || public.iuli_norm(p_cliente) || '%')
      and (p_nf is null or (p_nf = 'com') = v.tem_nf)
      -- só o que vence OU foi pago no período (antes marcava "entre empresas" nos 51 mil títulos)
      and (
        (p_from is null or v.due_date >= p_from) and (p_to is null or v.due_date <= p_to)
        or (p_from is null or v.pagamento >= p_from) and (p_to is null or v.pagamento <= p_to)
      )
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
security definer
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
  where (select public.is_workspace_member(p_workspace_id))
    and v.workspace_id = p_workspace_id
    and v.status <> 'recebida'
    and (p_integration_ids is null or v.integration_id = any(p_integration_ids))
    and (p_cliente is null or public.iuli_norm(v.cliente) like '%' || public.iuli_norm(p_cliente) || '%')
    and (p_nf is null or (p_nf = 'com') = v.tem_nf)
    and (not p_excluir_entre_empresas or not v.entre_empresas)
  group by 1;
$$;

-- ---------------------------------------------------------------------------
-- Notas e assinaturas
-- ---------------------------------------------------------------------------

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
security definer
set search_path = public
as $$
  select public.iuli_bucket(v.dia, p_grain), v.status, sum(v.qtd)::bigint, coalesce(sum(v.total), 0)
  from public.iuli_invoices_daily_v v
  where (select public.is_workspace_member(p_workspace_id))
    and v.workspace_id = p_workspace_id
    and (p_integration_ids is null or v.integration_id = any(p_integration_ids))
    and (p_from is null or v.dia >= p_from)
    and (p_to is null or v.dia <= p_to)
    and (p_status is null or v.status = any(p_status))
  group by 1, 2;
$$;

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
security definer
set search_path = public
as $$
  select public.iuli_bucket(v.dia, p_grain), coalesce(v.produto, '(sem produto)'), v.ciclo, v.status,
         count(*), coalesce(sum(v.valor_mensalizado), 0), coalesce(sum(v.valor), 0)
  from public.iuli_subscriptions_v v
  where (select public.is_workspace_member(p_workspace_id))
    and v.workspace_id = p_workspace_id
    and (p_integration_ids is null or v.integration_id = any(p_integration_ids))
    and (p_from is null or v.dia >= p_from)
    and (p_to is null or v.dia <= p_to)
    and (p_cliente is null or public.iuli_norm(v.cliente) like '%' || public.iuli_norm(p_cliente) || '%')
    and (p_produto is null or coalesce(v.produto, '(sem produto)') = any(p_produto))
    and (p_ciclo is null or v.ciclo = any(p_ciclo))
    and (p_status is null or v.status = any(p_status))
  group by 1, 2, 3, 4;
$$;

revoke all on function
  public.iuli_sales_agg(uuid, uuid[], date, date, text, text, text[], text[], text[], boolean),
  public.iuli_sales_top(uuid, text, uuid[], date, date, text, text[], text[], text[], boolean, integer),
  public.iuli_sales_options(uuid, uuid[]),
  public.iuli_sales_list(uuid, uuid[], date, date, text, text[], text[], text[], boolean, integer),
  public.iuli_receivables_flow(uuid, uuid[], date, date, text, text, text, boolean),
  public.iuli_receivables_position(uuid, uuid[], text, text, boolean),
  public.iuli_invoices_agg(uuid, uuid[], date, date, text, text[]),
  public.iuli_subscriptions_agg(uuid, uuid[], date, date, text, text, text[], text[], text[])
from public, anon;

grant execute on function
  public.iuli_sales_agg(uuid, uuid[], date, date, text, text, text[], text[], text[], boolean),
  public.iuli_sales_top(uuid, text, uuid[], date, date, text, text[], text[], text[], boolean, integer),
  public.iuli_sales_options(uuid, uuid[]),
  public.iuli_sales_list(uuid, uuid[], date, date, text, text[], text[], text[], boolean, integer),
  public.iuli_receivables_flow(uuid, uuid[], date, date, text, text, text, boolean),
  public.iuli_receivables_position(uuid, uuid[], text, text, boolean),
  public.iuli_invoices_agg(uuid, uuid[], date, date, text, text[]),
  public.iuli_subscriptions_agg(uuid, uuid[], date, date, text, text, text[], text[], text[])
to authenticated;
