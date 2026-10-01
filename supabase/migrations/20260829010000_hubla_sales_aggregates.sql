-- hubla_sales pode ter dezenas de milhares de linhas — bem acima do max_rows da API.
-- Totais e opções de filtro (distinct) precisam ser calculados no banco, não trazendo
-- tudo pro cliente; a listagem paginada continua sendo feita direto via .range().

create or replace function public.hubla_sales_summary(
  p_workspace_id uuid,
  p_search text default null,
  p_status text default null,
  p_product text default null
)
returns table (total_count bigint, gross_total numeric, net_total numeric)
language sql
stable
security definer
set search_path = public
as $$
  select
    count(*)::bigint,
    coalesce(sum(total_value), 0),
    coalesce(sum(net_value), 0)
  from public.hubla_sales
  where workspace_id = p_workspace_id
    and public.is_workspace_member(p_workspace_id)
    and (p_status is null or status = p_status)
    and (p_product is null or product_name = p_product)
    and (
      p_search is null or p_search = '' or
      customer_name ilike '%' || p_search || '%' or
      customer_email ilike '%' || p_search || '%' or
      invoice_id ilike '%' || p_search || '%'
    );
$$;

create or replace function public.hubla_sales_filter_options(p_workspace_id uuid)
returns table (statuses text[], products text[])
language sql
stable
security definer
set search_path = public
as $$
  select
    (
      select array_agg(distinct status order by status)
      from public.hubla_sales
      where workspace_id = p_workspace_id and public.is_workspace_member(p_workspace_id)
    ),
    (
      select array_agg(distinct product_name order by product_name)
      from public.hubla_sales
      where workspace_id = p_workspace_id and public.is_workspace_member(p_workspace_id)
    );
$$;

create or replace function public.hubla_sales_monthly_totals(p_workspace_id uuid)
returns table (month text, gross_total numeric)
language sql
stable
security definer
set search_path = public
as $$
  select to_char(paid_at, 'YYYY-MM') as month, sum(total_value)
  from public.hubla_sales
  where workspace_id = p_workspace_id
    and public.is_workspace_member(p_workspace_id)
    and paid_at is not null
  group by 1
  order by 1;
$$;
