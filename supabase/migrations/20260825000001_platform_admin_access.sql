-- Super admin enxerga todos os workspaces (bypass sobre a RLS normal de membership).
drop policy if exists "workspaces_select_member" on public.workspaces;
create policy "workspaces_select_member"
  on public.workspaces for select
  using (public.is_workspace_member(id) or public.is_platform_admin());

-- Lista de usuários para a área /platform (auth.users não é exposta via API diretamente).
create or replace function public.platform_list_users()
returns table (
  id uuid,
  email text,
  full_name text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, u.email::text, p.full_name, u.created_at
  from auth.users u
  left join public.profiles p on p.id = u.id
  where public.is_platform_admin()
  order by u.created_at desc;
$$;
