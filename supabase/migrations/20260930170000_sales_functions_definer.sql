-- Vendas: as funções passam a security definer, com a checagem de membro do
-- workspace feita UMA vez por consulta (como as commercial_*). Com security
-- invoker o RLS de hubspot_deals rodava a cada negócio lido e cada consulta
-- levava ~7s pelo app (0,5s direto no banco).

create or replace function public.sales_summary(
  p_workspace_id uuid, p_from date, p_to date,
  p_owner text default null, p_produto text[] default null, p_dedupe boolean default true
)
returns table (grupo text, pipeline_kind text, produto text, qtd bigint, total numeric)
language sql stable security definer set search_path = public
as $$
  select v.grupo, v.pipeline_kind, v.produto, count(*), coalesce(sum(v.amount), 0)
  from public.sales_deals_x_v v
  where public.is_workspace_member(p_workspace_id)
    and v.workspace_id = p_workspace_id
    and v.dia between p_from and p_to
    and (not p_dedupe or not v.duplicado)
    and (p_owner is null or v.owner_id = p_owner)
    and (p_produto is null or v.produto = any(p_produto))
  group by 1, 2, 3;
$$;

create or replace function public.sales_series(
  p_workspace_id uuid, p_from date, p_to date, p_grain text default 'day',
  p_owner text default null, p_produto text[] default null, p_dedupe boolean default true
)
returns table (bucket date, pipeline_kind text, grupo text, qtd bigint, total numeric)
language sql stable security definer set search_path = public
as $$
  select date_trunc(case when p_grain in ('week', 'month') then p_grain else 'day' end, v.dia::timestamp)::date,
         v.pipeline_kind, v.grupo, count(*), coalesce(sum(v.amount), 0)
  from public.sales_deals_x_v v
  where public.is_workspace_member(p_workspace_id)
    and v.workspace_id = p_workspace_id
    and v.dia between p_from and p_to
    and (not p_dedupe or not v.duplicado)
    and (p_owner is null or v.owner_id = p_owner)
    and (p_produto is null or v.produto = any(p_produto))
  group by 1, 2, 3;
$$;

create or replace function public.sales_deals_list(
  p_workspace_id uuid, p_from date, p_to date,
  p_grupo text default null, p_owner text default null, p_produto text[] default null,
  p_limit integer default 50, p_only_duplicates boolean default false, p_exclude_fora boolean default false
)
returns table (hubspot_id text, dealname text, produto text, produto_raw text, pipeline_kind text, grupo text, dia date, owner_id text, amount numeric, duplicado boolean)
language sql stable security definer set search_path = public
as $$
  select v.hubspot_id, v.dealname, v.produto, v.produto_raw, v.pipeline_kind, v.grupo, v.dia, v.owner_id, v.amount, v.duplicado
  from public.sales_deals_x_v v
  where public.is_workspace_member(p_workspace_id)
    and v.workspace_id = p_workspace_id
    and v.dia between p_from and p_to
    and (case when p_only_duplicates then v.duplicado else not v.duplicado end)
    and (p_grupo is null or v.grupo = p_grupo)
    and (not p_exclude_fora or v.grupo <> 'fora_dos_6')
    and (p_owner is null or v.owner_id = p_owner)
    and (p_produto is null or v.produto = any(p_produto))
  order by v.amount desc nulls last, v.dia desc
  limit least(greatest(p_limit, 1), 500);
$$;

create or replace function public.sales_duplicates(p_workspace_id uuid, p_from date, p_to date)
returns table (produto text, qtd bigint, total numeric)
language sql stable security definer set search_path = public
as $$
  select v.produto, count(*), coalesce(sum(v.amount), 0)
  from public.sales_deals_x_v v
  where public.is_workspace_member(p_workspace_id)
    and v.workspace_id = p_workspace_id and v.dia between p_from and p_to and v.duplicado
  group by 1 order by 3 desc;
$$;

create or replace function public.sales_options(p_workspace_id uuid, p_from date, p_to date)
returns table (kind text, value text, qtd bigint)
language sql stable security definer set search_path = public
as $$
  select 'produto', v.produto, count(*) from public.sales_deals_v v
  where public.is_workspace_member(p_workspace_id) and v.workspace_id = p_workspace_id and v.dia between p_from and p_to group by 2
  union all
  select 'owner', coalesce(v.owner_id, '(sem proprietário)'), count(*) from public.sales_deals_v v
  where public.is_workspace_member(p_workspace_id) and v.workspace_id = p_workspace_id and v.dia between p_from and p_to group by 2;
$$;

create or replace function public.sales_raw_products(p_workspace_id uuid)
returns table (pipeline_kind text, produto_raw text, produto text, grupo text, qtd bigint, total numeric)
language sql stable security definer set search_path = public
as $$
  select v.pipeline_kind, v.produto_raw, v.produto, v.grupo, count(*), coalesce(sum(v.amount), 0)
  from public.sales_deals_v v
  where public.is_workspace_member(p_workspace_id) and v.workspace_id = p_workspace_id
  group by 1, 2, 3, 4
  order by 6 desc;
$$;

revoke all on function public.sales_summary(uuid, date, date, text, text[], boolean) from public, anon;
revoke all on function public.sales_series(uuid, date, date, text, text, text[], boolean) from public, anon;
revoke all on function public.sales_deals_list(uuid, date, date, text, text, text[], integer, boolean, boolean) from public, anon;
revoke all on function public.sales_duplicates(uuid, date, date) from public, anon;
revoke all on function public.sales_options(uuid, date, date) from public, anon;
revoke all on function public.sales_raw_products(uuid) from public, anon;
grant execute on function public.sales_summary(uuid, date, date, text, text[], boolean) to authenticated;
grant execute on function public.sales_series(uuid, date, date, text, text, text[], boolean) to authenticated;
grant execute on function public.sales_deals_list(uuid, date, date, text, text, text[], integer, boolean, boolean) to authenticated;
grant execute on function public.sales_duplicates(uuid, date, date) to authenticated;
grant execute on function public.sales_options(uuid, date, date) to authenticated;
grant execute on function public.sales_raw_products(uuid) to authenticated;
