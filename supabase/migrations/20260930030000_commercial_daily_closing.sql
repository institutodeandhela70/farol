-- Fechamento por dia (mesma lógica de commercial_monthly_closing, granularidade
-- diária) — usado pelo gráfico "Fechamento diário" na Visão Geral do Comercial.
create or replace function public.commercial_daily_closing(
  p_workspace_id uuid,
  p_start_date timestamptz default null,
  p_end_date timestamptz default null,
  p_attribution text default 'owner',
  p_pipeline_ids text[] default null
)
returns table (
  day date,
  owner_id text,
  won_count bigint,
  won_amount numeric,
  lost_count bigint,
  lost_amount numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    date_trunc('day', d.closedate at time zone 'America/Sao_Paulo')::date,
    coalesce(case when p_attribution = 'closer' then d.closer_owner_id else d.owner_id end, '(sem proprietário)'),
    count(*) filter (where d.is_closed_won),
    coalesce(sum(d.amount) filter (where d.is_closed_won), 0),
    count(*) filter (where not d.is_closed_won),
    coalesce(sum(d.amount) filter (where not d.is_closed_won), 0)
  from public.hubspot_deals d
  where d.workspace_id = p_workspace_id
    and public.is_workspace_member(p_workspace_id)
    and d.is_closed
    and d.closedate is not null
    and d.pipeline = any(public.commercial_sales_pipelines(p_workspace_id, p_pipeline_ids))
    and (p_start_date is null or d.closedate >= p_start_date)
    and (p_end_date is null or d.closedate <= p_end_date)
  group by 1, 2
  order by 1, 4 desc;
$$;
