-- Liga/desliga a sincronização automática por integração (importante ter dev e
-- prod cada um com o seu próprio interruptor).
alter table public.integrations add column if not exists sync_enabled boolean not null default true;

-- Dados completos da HubSpot: colunas promovidas (consulta rápida) + raw_properties
-- jsonb com TODAS as propriedades vindas da API (inclusive customizadas), pra nunca
-- perder informação mesmo sem coluna dedicada.
create table if not exists public.hubspot_contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  hubspot_id text not null,
  email text,
  firstname text,
  lastname text,
  phone text,
  lifecyclestage text,
  created_at_hubspot timestamptz,
  updated_at_hubspot timestamptz,
  raw_properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, hubspot_id)
);

create table if not exists public.hubspot_companies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  hubspot_id text not null,
  name text,
  domain text,
  industry text,
  city text,
  state text,
  created_at_hubspot timestamptz,
  updated_at_hubspot timestamptz,
  raw_properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, hubspot_id)
);

create table if not exists public.hubspot_deals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  hubspot_id text not null,
  dealname text,
  amount numeric(14, 2),
  dealstage text,
  pipeline text,
  closedate timestamptz,
  created_at_hubspot timestamptz,
  updated_at_hubspot timestamptz,
  raw_properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, hubspot_id)
);

create index if not exists hubspot_contacts_workspace_idx on public.hubspot_contacts (workspace_id);
create index if not exists hubspot_companies_workspace_idx on public.hubspot_companies (workspace_id);
create index if not exists hubspot_deals_workspace_idx on public.hubspot_deals (workspace_id, dealstage);

alter table public.hubspot_contacts enable row level security;
alter table public.hubspot_companies enable row level security;
alter table public.hubspot_deals enable row level security;

drop policy if exists "hubspot_contacts_select_member" on public.hubspot_contacts;
create policy "hubspot_contacts_select_member"
  on public.hubspot_contacts for select
  using (public.is_workspace_member(workspace_id));

drop policy if exists "hubspot_companies_select_member" on public.hubspot_companies;
create policy "hubspot_companies_select_member"
  on public.hubspot_companies for select
  using (public.is_workspace_member(workspace_id));

drop policy if exists "hubspot_deals_select_member" on public.hubspot_deals;
create policy "hubspot_deals_select_member"
  on public.hubspot_deals for select
  using (public.is_workspace_member(workspace_id));
