-- Allowlist de super admin global (independente de qualquer workspace).
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;

create or replace function public.is_platform_admin(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.platform_admins where user_id = p_user_id
  );
$$;

drop policy if exists "platform_admins_select_self" on public.platform_admins;
create policy "platform_admins_select_self"
  on public.platform_admins for select
  using (public.is_platform_admin());

drop policy if exists "platform_admins_write_admin" on public.platform_admins;
create policy "platform_admins_write_admin"
  on public.platform_admins for insert
  with check (public.is_platform_admin());

drop policy if exists "platform_admins_delete_admin" on public.platform_admins;
create policy "platform_admins_delete_admin"
  on public.platform_admins for delete
  using (public.is_platform_admin());
