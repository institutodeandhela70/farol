-- Catálogo de permissões (controla visibilidade de itens de menu/rotas).
create table if not exists public.permission_keys (
  key text primary key,
  category text not null,
  label text not null,
  description text,
  is_menu boolean not null default true,
  sort_order integer not null default 0
);

alter table public.permission_keys enable row level security;

drop policy if exists "permission_keys_select_authenticated" on public.permission_keys;
create policy "permission_keys_select_authenticated"
  on public.permission_keys for select
  to authenticated
  using (true);

insert into public.permission_keys (key, category, label, sort_order) values
  ('menu.dashboard', 'dashboards', 'Visão geral', 0),
  ('menu.dashboards.hubla', 'dashboards', 'Hubla', 1),
  ('menu.dashboards.asaas', 'dashboards', 'Asaas', 2),
  ('menu.dashboards.hotmart', 'dashboards', 'Hotmart', 3),
  ('menu.dashboards.tmb', 'dashboards', 'TMB', 4),
  ('menu.dashboards.planilhas', 'dashboards', 'Planilhas', 5),
  ('menu.settings.integracoes', 'settings', 'Integrações', 6),
  ('menu.settings.equipe', 'settings', 'Equipe', 7),
  ('menu.settings.geral', 'settings', 'Geral', 8)
on conflict (key) do update set
  category = excluded.category,
  label = excluded.label,
  sort_order = excluded.sort_order;

-- Retorna as permission_keys concedidas ao usuário autenticado no workspace informado.
-- v1: todo membro ativo recebe o catálogo completo (sem override granular ainda).
-- Restrição por membro/role fica para uma fase futura, sem precisar mudar este contrato.
create or replace function public.get_my_permissions(p_workspace_id uuid)
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select pk.key
  from public.permission_keys pk
  where public.is_workspace_member(p_workspace_id);
$$;
