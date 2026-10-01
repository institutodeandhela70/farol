-- tmb_sales pode crescer bastante (webhook + backfill) — totais e opções de
-- filtro calculados no banco, mesmo padrão de 20260829010000_hubla_sales_aggregates.sql.
-- Sem net_total: a TMB não tem conceito de valor líquido, só valor_total.

create or replace function public.tmb_sales_summary(
  p_workspace_id uuid,
  p_search text default null,
  p_status text default null,
  p_product text default null
)
returns table (total_count bigint, gross_total numeric)
language sql
stable
security definer
set search_path = public
as $$
  select
    count(*)::bigint,
    coalesce(sum(valor_total), 0)
  from public.tmb_sales
  where workspace_id = p_workspace_id
    and public.is_workspace_member(p_workspace_id)
    and (p_status is null or status = p_status)
    and (p_product is null or product_name = p_product)
    and (
      p_search is null or p_search = '' or
      customer_name ilike '%' || p_search || '%' or
      customer_email ilike '%' || p_search || '%' or
      customer_document ilike '%' || p_search || '%'
    );
$$;

create or replace function public.tmb_sales_filter_options(p_workspace_id uuid)
returns table (statuses text[], products text[])
language sql
stable
security definer
set search_path = public
as $$
  select
    (
      select array_agg(distinct status order by status)
      from public.tmb_sales
      where workspace_id = p_workspace_id and public.is_workspace_member(p_workspace_id)
    ),
    (
      select array_agg(distinct product_name order by product_name)
      from public.tmb_sales
      where workspace_id = p_workspace_id and public.is_workspace_member(p_workspace_id)
    );
$$;

create or replace function public.tmb_sales_monthly_totals(p_workspace_id uuid)
returns table (month text, gross_total numeric)
language sql
stable
security definer
set search_path = public
as $$
  select to_char(data_efetivado, 'YYYY-MM') as month, sum(valor_total)
  from public.tmb_sales
  where workspace_id = p_workspace_id
    and public.is_workspace_member(p_workspace_id)
    and data_efetivado is not null
  group by 1
  order by 1;
$$;

create or replace function public.tmb_installments_summary(p_workspace_id uuid)
returns table (status_pagamento text, count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select status_pagamento, count(*)::bigint
  from public.tmb_installments
  where workspace_id = p_workspace_id
    and public.is_workspace_member(p_workspace_id)
  group by 1
  order by 1;
$$;

create or replace function public.tmb_checkout_steps_summary(p_workspace_id uuid)
returns table (fase_checkout text, count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select fase_checkout, count(*)::bigint
  from public.tmb_checkout_steps
  where workspace_id = p_workspace_id
    and public.is_workspace_member(p_workspace_id)
  group by 1
  order by 1;
$$;
