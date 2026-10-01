-- "Visão por cliente": usa o campo dedicado "Produtos" do HubSpot (raw_properties
-- ->>'produtos') como fonte principal do produto — nomes limpos e corretos, ex.:
-- "[MXP] Memorável Experience 2026". A tag entre colchetes no nome do negócio vira
-- fallback só quando o campo está vazio, e só quando não é uma tag de plataforma de
-- pagamento (ex.: "HUBLA", "TMB"), já que o nome do negócio nesses casos é o próprio
-- gateway, não o produto. Último fallback: nome do pipeline.
create or replace function public.commercial_customers(
  p_workspace_id uuid,
  p_start_date timestamptz default null,
  p_end_date timestamptz default null,
  p_attribution text default 'owner',
  p_pipeline_ids text[] default null
)
returns table (
  contact_id text,
  customer_name text,
  customer_email text,
  owner_id text,
  produto text,
  deal_count bigint,
  total_amount numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(d.contact_ids[1], '(sem contato)'),
    coalesce(nullif(trim(concat_ws(' ', c.firstname, c.lastname)), ''), c.email, 'Sem contato vinculado'),
    c.email,
    coalesce(case when p_attribution = 'closer' then d.closer_owner_id else d.owner_id end, '(sem proprietário)'),
    coalesce(
      nullif(trim(d.raw_properties->>'produtos'), ''),
      case
        when (regexp_match(d.dealname, '^\[([^\]]+)\]'))[1] in ('HUBLA', 'TMB', 'ASAAS') then null
        else (regexp_match(d.dealname, '^\[([^\]]+)\]'))[1]
      end,
      p.label,
      'Sem produto identificado'
    ),
    count(*),
    coalesce(sum(d.amount), 0)
  from public.hubspot_deals d
  left join public.hubspot_contacts c
    on c.workspace_id = d.workspace_id and c.hubspot_id = d.contact_ids[1] and d.contact_ids[1] is not null and d.contact_ids[1] <> '-'
  left join public.hubspot_pipelines p
    on p.workspace_id = d.workspace_id and p.pipeline_id = d.pipeline
  where d.workspace_id = p_workspace_id
    and public.is_workspace_member(p_workspace_id)
    and d.is_closed_won
    and d.closedate is not null
    and d.pipeline = any(public.commercial_sales_pipelines(p_workspace_id, p_pipeline_ids))
    and (p_start_date is null or d.closedate >= p_start_date)
    and (p_end_date is null or d.closedate <= p_end_date)
  group by 1, 2, 3, 4, 5
  order by 7 desc;
$$;
