-- Permissões de menu por perfil (workspace_role), com override individual por
-- usuário. owner/admin sempre têm acesso total (bypass) — nunca precisam de
-- linha aqui; só manager/vendedor têm defaults configuráveis.
create table if not exists public.role_permissions (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  role public.workspace_role not null,
  permission_key text not null references public.permission_keys(key) on delete cascade,
  granted boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, role, permission_key)
);

create table if not exists public.user_permission_overrides (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  permission_key text not null references public.permission_keys(key) on delete cascade,
  granted boolean not null,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id, permission_key)
);

alter table public.role_permissions enable row level security;
alter table public.user_permission_overrides enable row level security;

drop policy if exists "role_permissions_select_member" on public.role_permissions;
create policy "role_permissions_select_member"
  on public.role_permissions for select
  using (public.is_workspace_member(workspace_id));

drop policy if exists "role_permissions_insert_admin" on public.role_permissions;
create policy "role_permissions_insert_admin"
  on public.role_permissions for insert
  with check (public.is_workspace_member(workspace_id, array['owner', 'admin']::public.workspace_role[]));

drop policy if exists "role_permissions_update_admin" on public.role_permissions;
create policy "role_permissions_update_admin"
  on public.role_permissions for update
  using (public.is_workspace_member(workspace_id, array['owner', 'admin']::public.workspace_role[]));

drop policy if exists "role_permissions_delete_admin" on public.role_permissions;
create policy "role_permissions_delete_admin"
  on public.role_permissions for delete
  using (public.is_workspace_member(workspace_id, array['owner', 'admin']::public.workspace_role[]));

drop policy if exists "user_permission_overrides_select_member_or_self" on public.user_permission_overrides;
create policy "user_permission_overrides_select_member_or_self"
  on public.user_permission_overrides for select
  using (public.is_workspace_member(workspace_id) or user_id = auth.uid());

drop policy if exists "user_permission_overrides_insert_admin" on public.user_permission_overrides;
create policy "user_permission_overrides_insert_admin"
  on public.user_permission_overrides for insert
  with check (public.is_workspace_member(workspace_id, array['owner', 'admin']::public.workspace_role[]));

drop policy if exists "user_permission_overrides_update_admin" on public.user_permission_overrides;
create policy "user_permission_overrides_update_admin"
  on public.user_permission_overrides for update
  using (public.is_workspace_member(workspace_id, array['owner', 'admin']::public.workspace_role[]));

drop policy if exists "user_permission_overrides_delete_admin" on public.user_permission_overrides;
create policy "user_permission_overrides_delete_admin"
  on public.user_permission_overrides for delete
  using (public.is_workspace_member(workspace_id, array['owner', 'admin']::public.workspace_role[]));

-- Defaults por perfil, para todos os workspaces já existentes.
-- GERENTE: tudo, exceto a categoria "settings" (Configurações).
insert into public.role_permissions (workspace_id, role, permission_key, granted)
select w.id, 'manager'::public.workspace_role, pk.key, true
from public.workspaces w
cross join public.permission_keys pk
where pk.category <> 'settings'
on conflict (workspace_id, role, permission_key) do update set granted = excluded.granted;

-- VENDEDOR: visão geral, eventos e a área comercial (sua ficha, agenda, pipeline,
-- fechamento) — sem financeiro, dashboards de integração, metas ou configurações.
-- É um default conservador, ajustável depois pela tela de permissões (Fase 4)
-- ou por override individual por pessoa.
insert into public.role_permissions (workspace_id, role, permission_key, granted)
select w.id, 'vendedor'::public.workspace_role, pk.key, true
from public.workspaces w
cross join public.permission_keys pk
where pk.category in ('top', 'comercial') and pk.key <> 'menu.comercial.metas'
on conflict (workspace_id, role, permission_key) do update set granted = excluded.granted;

-- Semeia os mesmos defaults automaticamente para workspaces criados a partir de agora.
create or replace function public.handle_new_workspace_permissions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.role_permissions (workspace_id, role, permission_key, granted)
  select new.id, 'manager'::public.workspace_role, pk.key, true
  from public.permission_keys pk
  where pk.category <> 'settings';

  insert into public.role_permissions (workspace_id, role, permission_key, granted)
  select new.id, 'vendedor'::public.workspace_role, pk.key, true
  from public.permission_keys pk
  where pk.category in ('top', 'comercial') and pk.key <> 'menu.comercial.metas';

  return new;
end;
$$;

drop trigger if exists on_workspace_created_permissions on public.workspaces;
create trigger on_workspace_created_permissions
  after insert on public.workspaces
  for each row execute function public.handle_new_workspace_permissions();

-- Substitui o stub v1 ("todo membro ativo recebe o catálogo completo") por uma
-- checagem real: owner/admin sempre true; senão override individual; senão
-- default do perfil; senão false.
create or replace function public.user_has_permission(p_user_id uuid, p_workspace_id uuid, p_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role public.workspace_role;
  v_override boolean;
  v_role_default boolean;
begin
  select role into v_role
  from public.workspace_members
  where workspace_id = p_workspace_id and user_id = p_user_id and is_active = true;

  if v_role is null then
    return false;
  end if;

  if v_role in ('owner', 'admin') then
    return true;
  end if;

  select granted into v_override
  from public.user_permission_overrides
  where workspace_id = p_workspace_id and user_id = p_user_id and permission_key = p_key;

  if v_override is not null then
    return v_override;
  end if;

  select granted into v_role_default
  from public.role_permissions
  where workspace_id = p_workspace_id and role = v_role and permission_key = p_key;

  return coalesce(v_role_default, false);
end;
$$;

create or replace function public.get_my_permissions(p_workspace_id uuid)
returns setof text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role public.workspace_role;
begin
  select role into v_role
  from public.workspace_members
  where workspace_id = p_workspace_id and user_id = auth.uid() and is_active = true;

  if v_role is null then
    return;
  end if;

  if v_role in ('owner', 'admin') then
    return query select key from public.permission_keys;
    return;
  end if;

  return query
  select pk.key
  from public.permission_keys pk
  where coalesce(
    (select uo.granted from public.user_permission_overrides uo
     where uo.workspace_id = p_workspace_id and uo.user_id = auth.uid() and uo.permission_key = pk.key),
    (select rp.granted from public.role_permissions rp
     where rp.workspace_id = p_workspace_id and rp.role = v_role and rp.permission_key = pk.key),
    false
  );
end;
$$;
