-- Núcleo multi-tenant: workspaces, membros e convites.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'workspace_role') then
    create type public.workspace_role as enum ('owner', 'admin', 'member');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'invite_status') then
    create type public.invite_status as enum ('pending', 'accepted', 'rejected', 'expired', 'cancelled');
  end if;
end $$;

-- Representa uma organização/tenant. Cada workspace isola completamente seus dados.
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  logo_url text,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.workspace_role not null default 'member',
  is_active boolean not null default true,
  invited_by uuid references auth.users(id),
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create table if not exists public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null,
  role public.workspace_role not null default 'member',
  token text not null unique default encode(gen_random_bytes(32), 'hex'),
  status public.invite_status not null default 'pending',
  invited_by uuid references auth.users(id),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

-- Fronteira de segurança: "o usuário é membro ativo deste workspace (com um dos papéis, se informado)?".
-- Nunca depender de variável de sessão Postgres para isso (não é confiável com pooler) — ver CLAUDE.md.
create or replace function public.is_workspace_member(p_workspace_id uuid, p_roles public.workspace_role[] default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = auth.uid()
      and wm.is_active = true
      and (p_roles is null or wm.role = any(p_roles))
  );
$$;

-- Adiciona automaticamente o criador do workspace como owner.
create or replace function public.handle_new_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role, joined_at)
  values (new.id, auth.uid(), 'owner', now());
  return new;
end;
$$;

drop trigger if exists on_workspace_created on public.workspaces;
create trigger on_workspace_created
  after insert on public.workspaces
  for each row execute function public.handle_new_workspace();

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invites enable row level security;

drop policy if exists "workspaces_select_member" on public.workspaces;
create policy "workspaces_select_member"
  on public.workspaces for select
  using (public.is_workspace_member(id));

drop policy if exists "workspaces_insert_authenticated" on public.workspaces;
create policy "workspaces_insert_authenticated"
  on public.workspaces for insert
  with check (auth.uid() is not null);

drop policy if exists "workspaces_update_admin" on public.workspaces;
create policy "workspaces_update_admin"
  on public.workspaces for update
  using (public.is_workspace_member(id, array['owner', 'admin']::public.workspace_role[]));

drop policy if exists "workspaces_delete_owner" on public.workspaces;
create policy "workspaces_delete_owner"
  on public.workspaces for delete
  using (public.is_workspace_member(id, array['owner']::public.workspace_role[]));

drop policy if exists "workspace_members_select_same_workspace" on public.workspace_members;
create policy "workspace_members_select_same_workspace"
  on public.workspace_members for select
  using (public.is_workspace_member(workspace_id) or user_id = auth.uid());

drop policy if exists "workspace_members_insert_self_or_admin" on public.workspace_members;
create policy "workspace_members_insert_self_or_admin"
  on public.workspace_members for insert
  with check (user_id = auth.uid() or public.is_workspace_member(workspace_id, array['owner', 'admin']::public.workspace_role[]));

drop policy if exists "workspace_members_update_self_or_admin" on public.workspace_members;
create policy "workspace_members_update_self_or_admin"
  on public.workspace_members for update
  using (user_id = auth.uid() or public.is_workspace_member(workspace_id, array['owner', 'admin']::public.workspace_role[]));

drop policy if exists "workspace_members_delete_self_or_admin" on public.workspace_members;
create policy "workspace_members_delete_self_or_admin"
  on public.workspace_members for delete
  using (user_id = auth.uid() or public.is_workspace_member(workspace_id, array['owner', 'admin']::public.workspace_role[]));

drop policy if exists "workspace_invites_select_member_or_invited" on public.workspace_invites;
create policy "workspace_invites_select_member_or_invited"
  on public.workspace_invites for select
  using (
    public.is_workspace_member(workspace_id)
    or email = (select email from auth.users where id = auth.uid())
  );

drop policy if exists "workspace_invites_select_anon_by_token" on public.workspace_invites;
create policy "workspace_invites_select_anon_by_token"
  on public.workspace_invites for select
  to anon
  using (status = 'pending' and expires_at > now());

drop policy if exists "workspace_invites_write_admin" on public.workspace_invites;
create policy "workspace_invites_write_admin"
  on public.workspace_invites for insert
  with check (public.is_workspace_member(workspace_id, array['owner', 'admin']::public.workspace_role[]));

drop policy if exists "workspace_invites_update_admin_or_invited" on public.workspace_invites;
create policy "workspace_invites_update_admin_or_invited"
  on public.workspace_invites for update
  using (
    public.is_workspace_member(workspace_id, array['owner', 'admin']::public.workspace_role[])
    or email = (select email from auth.users where id = auth.uid())
  );

drop policy if exists "workspace_invites_delete_admin" on public.workspace_invites;
create policy "workspace_invites_delete_admin"
  on public.workspace_invites for delete
  using (public.is_workspace_member(workspace_id, array['owner', 'admin']::public.workspace_role[]));
