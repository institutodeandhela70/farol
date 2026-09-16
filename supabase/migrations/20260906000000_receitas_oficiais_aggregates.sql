-- Agregados sobre a base oficial de receitas (view receitas_oficiais), mesmo
-- padrão de 20260829010000_hubla_sales_aggregates.sql — totais e opções de
-- filtro calculados no banco, não trazendo tudo pro cliente.

create or replace function public.receitas_oficiais_summary(
  p_workspace_id uuid,
  p_search text default null,
  p_bank_account_id uuid default null,
  p_product_id text default null,
  p_owner_id text default null
)
returns table (total_count bigint, gross_total numeric)
language sql
stable
security definer
set search_path = public
as $$
  select
    count(*)::bigint,
    coalesce(sum(amount), 0)
  from public.receitas_oficiais
  where workspace_id = p_workspace_id
    and public.is_workspace_member(p_workspace_id)
    and (p_bank_account_id is null or bank_account_id = p_bank_account_id)
    and (p_product_id is null or hubspot_product_id = p_product_id)
    and (p_owner_id is null or hubspot_owner_id = p_owner_id)
    and (
      p_search is null or p_search = '' or
      contact_name ilike '%' || p_search || '%' or
      payer_name ilike '%' || p_search || '%'
    );
$$;

create or replace function public.receitas_oficiais_filter_options(p_workspace_id uuid)
returns table (products jsonb, owners jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select
    (
      select jsonb_agg(distinct jsonb_build_object('id', hubspot_product_id, 'name', product_name))
      from public.receitas_oficiais
      where workspace_id = p_workspace_id and public.is_workspace_member(p_workspace_id)
        and hubspot_product_id is not null
    ),
    (
      select jsonb_agg(distinct jsonb_build_object('id', hubspot_owner_id, 'name', owner_name))
      from public.receitas_oficiais
      where workspace_id = p_workspace_id and public.is_workspace_member(p_workspace_id)
        and hubspot_owner_id is not null
    );
$$;

create or replace function public.receitas_oficiais_monthly_totals(p_workspace_id uuid)
returns table (month text, gross_total numeric)
language sql
stable
security definer
set search_path = public
as $$
  select to_char(posted_at, 'YYYY-MM') as month, sum(amount)
  from public.receitas_oficiais
  where workspace_id = p_workspace_id
    and public.is_workspace_member(p_workspace_id)
    and posted_at is not null
  group by 1
  order by 1;
$$;
