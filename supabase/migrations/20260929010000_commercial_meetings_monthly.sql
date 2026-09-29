-- Reuniões por mês (data da reunião, fuso SP) — evolução e comparação com o
-- período anterior no Dashboard Comercial.
create or replace function public.commercial_meetings_monthly(
  p_workspace_id uuid,
  p_start_date timestamptz default null,
  p_end_date timestamptz default null,
  p_activity_types text[] default null
)
returns table (
  month date,
  total_count bigint,
  past_count bigint,
  completed_count bigint,
  no_show_count bigint,
  rescheduled_count bigint,
  canceled_count bigint,
  unrecorded_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    date_trunc('month', m.start_time at time zone 'America/Sao_Paulo')::date,
    count(*),
    count(*) filter (where m.start_time <= now()),
    count(*) filter (where m.outcome = 'COMPLETED'),
    count(*) filter (where m.outcome = 'NO_SHOW'),
    count(*) filter (where m.outcome = 'RESCHEDULED'),
    count(*) filter (where m.outcome = 'CANCELED'),
    count(*) filter (where m.start_time <= now() and coalesce(m.outcome, 'SCHEDULED') = 'SCHEDULED')
  from public.hubspot_meetings m
  where m.workspace_id = p_workspace_id
    and public.is_workspace_member(p_workspace_id)
    and m.start_time is not null
    and (p_start_date is null or m.start_time >= p_start_date)
    and (p_end_date is null or m.start_time <= p_end_date)
    and (p_activity_types is null or m.activity_type = any(p_activity_types))
  group by 1
  order by 1;
$$;
