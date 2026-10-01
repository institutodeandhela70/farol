-- Metadados da HubSpot (pipelines/etapas, donos e definições de propriedade) —
-- pequenos, então sincronizamos por completo a cada rodada (sem paginação
-- incremental). Usados pra resolver IDs internos em texto legível no frontend.

create table if not exists public.hubspot_pipelines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  pipeline_id text not null,
  label text not null,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, pipeline_id)
);

create table if not exists public.hubspot_pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  pipeline_id text not null,
  stage_id text not null,
  label text not null,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, pipeline_id, stage_id)
);

create table if not exists public.hubspot_owners (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id text not null,
  email text,
  first_name text,
  last_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, owner_id)
);

create table if not exists public.hubspot_property_defs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  object_type text not null,
  name text not null,
  label text not null,
  group_name text,
  group_label text,
  group_display_order integer not null default 0,
  display_order integer not null default 0,
  options jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, object_type, name)
);

create index if not exists hubspot_pipeline_stages_lookup_idx
  on public.hubspot_pipeline_stages (workspace_id, pipeline_id);
create index if not exists hubspot_property_defs_lookup_idx
  on public.hubspot_property_defs (workspace_id, object_type);

alter table public.hubspot_pipelines enable row level security;
alter table public.hubspot_pipeline_stages enable row level security;
alter table public.hubspot_owners enable row level security;
alter table public.hubspot_property_defs enable row level security;

drop policy if exists "hubspot_pipelines_select_member" on public.hubspot_pipelines;
create policy "hubspot_pipelines_select_member"
  on public.hubspot_pipelines for select
  using (public.is_workspace_member(workspace_id));

drop policy if exists "hubspot_pipeline_stages_select_member" on public.hubspot_pipeline_stages;
create policy "hubspot_pipeline_stages_select_member"
  on public.hubspot_pipeline_stages for select
  using (public.is_workspace_member(workspace_id));

drop policy if exists "hubspot_owners_select_member" on public.hubspot_owners;
create policy "hubspot_owners_select_member"
  on public.hubspot_owners for select
  using (public.is_workspace_member(workspace_id));

drop policy if exists "hubspot_property_defs_select_member" on public.hubspot_property_defs;
create policy "hubspot_property_defs_select_member"
  on public.hubspot_property_defs for select
  using (public.is_workspace_member(workspace_id));
