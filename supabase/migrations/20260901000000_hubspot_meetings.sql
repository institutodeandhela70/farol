-- Reuniões da HubSpot (objeto de engajamento "meetings"), pra responder
-- "quantas reuniões um vendedor realizou/vai realizar".

create table if not exists public.hubspot_meetings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  hubspot_id text not null,
  title text,
  start_time timestamptz,
  end_time timestamptz,
  outcome text,
  activity_type text,
  owner_id text,
  created_at_hubspot timestamptz,
  updated_at_hubspot timestamptz,
  raw_properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, hubspot_id)
);

create index if not exists hubspot_meetings_owner_idx on public.hubspot_meetings (workspace_id, owner_id);
create index if not exists hubspot_meetings_start_time_idx on public.hubspot_meetings (workspace_id, start_time);

alter table public.hubspot_meetings enable row level security;

drop policy if exists "hubspot_meetings_select_member" on public.hubspot_meetings;
create policy "hubspot_meetings_select_member"
  on public.hubspot_meetings for select
  using (public.is_workspace_member(workspace_id));

-- hubspot_meetings pode passar de 1000 linhas (max_rows da API) — agregações
-- via RPC, mesmo padrão de hubspot_deals_summary/hubspot_deals_filter_options.

create or replace function public.hubspot_meetings_summary(
  p_workspace_id uuid,
  p_start_date timestamptz default null,
  p_end_date timestamptz default null
)
returns table (total_count bigint, held_count bigint, upcoming_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    count(*)::bigint,
    count(*) filter (where start_time <= now())::bigint,
    count(*) filter (where start_time > now())::bigint
  from public.hubspot_meetings
  where workspace_id = p_workspace_id
    and public.is_workspace_member(p_workspace_id)
    and (p_start_date is null or start_time >= p_start_date)
    and (p_end_date is null or start_time <= p_end_date);
$$;

create or replace function public.hubspot_meetings_by_owner(
  p_workspace_id uuid,
  p_start_date timestamptz default null,
  p_end_date timestamptz default null
)
returns table (
  owner_id text,
  held_count bigint,
  upcoming_count bigint,
  completed_count bigint,
  no_show_count bigint,
  rescheduled_count bigint,
  canceled_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(owner_id, '(sem proprietário)'),
    count(*) filter (where start_time <= now())::bigint,
    count(*) filter (where start_time > now())::bigint,
    count(*) filter (where outcome = 'COMPLETED')::bigint,
    count(*) filter (where outcome = 'NO_SHOW')::bigint,
    count(*) filter (where outcome = 'RESCHEDULED')::bigint,
    count(*) filter (where outcome = 'CANCELED')::bigint
  from public.hubspot_meetings
  where workspace_id = p_workspace_id
    and public.is_workspace_member(p_workspace_id)
    and (p_start_date is null or start_time >= p_start_date)
    and (p_end_date is null or start_time <= p_end_date)
  group by owner_id
  order by count(*) desc;
$$;
