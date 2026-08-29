-- hubspot_contacts e hubspot_deals têm dezenas de milhares de linhas — acima do
-- max_rows da API. Totais e opções de filtro vêm de RPCs; a listagem em si
-- continua paginada via .range() direto na tabela.

create or replace function public.hubspot_contacts_summary(
  p_workspace_id uuid,
  p_search text default null,
  p_lifecyclestage text default null
)
returns table (total_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::bigint
  from public.hubspot_contacts
  where workspace_id = p_workspace_id
    and public.is_workspace_member(p_workspace_id)
    and (p_lifecyclestage is null or lifecyclestage = p_lifecyclestage)
    and (
      p_search is null or p_search = '' or
      email ilike '%' || p_search || '%' or
      firstname ilike '%' || p_search || '%' or
      lastname ilike '%' || p_search || '%'
    );
$$;

create or replace function public.hubspot_contacts_filter_options(p_workspace_id uuid)
returns table (lifecyclestages text[])
language sql
stable
security definer
set search_path = public
as $$
  select array_agg(distinct lifecyclestage order by lifecyclestage)
  from public.hubspot_contacts
  where workspace_id = p_workspace_id
    and public.is_workspace_member(p_workspace_id)
    and lifecyclestage is not null;
$$;

create or replace function public.hubspot_deals_summary(
  p_workspace_id uuid,
  p_search text default null,
  p_dealstage text default null,
  p_pipeline text default null
)
returns table (total_count bigint, total_amount numeric)
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::bigint, coalesce(sum(amount), 0)
  from public.hubspot_deals
  where workspace_id = p_workspace_id
    and public.is_workspace_member(p_workspace_id)
    and (p_dealstage is null or dealstage = p_dealstage)
    and (p_pipeline is null or pipeline = p_pipeline)
    and (p_search is null or p_search = '' or dealname ilike '%' || p_search || '%');
$$;

create or replace function public.hubspot_deals_filter_options(p_workspace_id uuid)
returns table (dealstages text[], pipelines text[])
language sql
stable
security definer
set search_path = public
as $$
  select
    (
      select array_agg(distinct dealstage order by dealstage)
      from public.hubspot_deals
      where workspace_id = p_workspace_id and public.is_workspace_member(p_workspace_id) and dealstage is not null
    ),
    (
      select array_agg(distinct pipeline order by pipeline)
      from public.hubspot_deals
      where workspace_id = p_workspace_id and public.is_workspace_member(p_workspace_id) and pipeline is not null
    );
$$;
