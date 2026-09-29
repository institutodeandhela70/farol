-- Lista os membros de um workspace com e-mail incluso (auth.users não é
-- exposta via API diretamente) — mesmo padrão de platform_list_users().
create or replace function public.workspace_list_members(p_workspace_id uuid)
returns table (
  membership_id uuid,
  user_id uuid,
  email text,
  full_name text,
  role public.workspace_role,
  is_active boolean,
  must_change_password boolean,
  joined_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    wm.id,
    wm.user_id,
    u.email::text,
    p.full_name,
    wm.role,
    wm.is_active,
    coalesce(p.must_change_password, false),
    wm.joined_at,
    wm.created_at
  from public.workspace_members wm
  join auth.users u on u.id = wm.user_id
  left join public.profiles p on p.id = wm.user_id
  where wm.workspace_id = p_workspace_id
    and public.is_workspace_member(p_workspace_id)
  order by wm.created_at asc;
$$;
