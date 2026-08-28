-- Integrações genéricas (Asaas, Hubla, Hotmart, TMB) + dados sincronizados do Asaas.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'integration_provider') then
    create type public.integration_provider as enum ('asaas', 'hubla', 'hotmart', 'tmb');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'integration_status') then
    create type public.integration_status as enum ('disconnected', 'connected', 'error');
  end if;
end $$;

create table if not exists public.integrations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider public.integration_provider not null,
  status public.integration_status not null default 'disconnected',
  config jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider)
);

-- Credenciais separadas da tabela operacional: nenhuma policy de SELECT é criada aqui de
-- propósito — só a Edge Function (service role) lê; o cliente só grava.
create table if not exists public.integration_secrets (
  integration_id uuid primary key references public.integrations(id) on delete cascade,
  api_key text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.asaas_charges (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  external_id text not null,
  customer_name text,
  value numeric(12,2) not null default 0,
  status text not null,
  due_date date,
  payment_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, external_id)
);

alter table public.integrations enable row level security;
alter table public.integration_secrets enable row level security;
alter table public.asaas_charges enable row level security;

drop policy if exists "integrations_select_member" on public.integrations;
create policy "integrations_select_member"
  on public.integrations for select
  using (public.is_workspace_member(workspace_id));

drop policy if exists "integrations_insert_admin" on public.integrations;
create policy "integrations_insert_admin"
  on public.integrations for insert
  with check (public.is_workspace_member(workspace_id, array['owner', 'admin']::public.workspace_role[]));

drop policy if exists "integrations_update_admin" on public.integrations;
create policy "integrations_update_admin"
  on public.integrations for update
  using (public.is_workspace_member(workspace_id, array['owner', 'admin']::public.workspace_role[]));

drop policy if exists "integrations_delete_admin" on public.integrations;
create policy "integrations_delete_admin"
  on public.integrations for delete
  using (public.is_workspace_member(workspace_id, array['owner', 'admin']::public.workspace_role[]));

drop policy if exists "integration_secrets_insert_admin" on public.integration_secrets;
create policy "integration_secrets_insert_admin"
  on public.integration_secrets for insert
  with check (
    exists (
      select 1 from public.integrations i
      where i.id = integration_id
        and public.is_workspace_member(i.workspace_id, array['owner', 'admin']::public.workspace_role[])
    )
  );

drop policy if exists "integration_secrets_update_admin" on public.integration_secrets;
create policy "integration_secrets_update_admin"
  on public.integration_secrets for update
  using (
    exists (
      select 1 from public.integrations i
      where i.id = integration_id
        and public.is_workspace_member(i.workspace_id, array['owner', 'admin']::public.workspace_role[])
    )
  );

drop policy if exists "asaas_charges_select_member" on public.asaas_charges;
create policy "asaas_charges_select_member"
  on public.asaas_charges for select
  using (public.is_workspace_member(workspace_id));
