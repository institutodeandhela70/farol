-- Permissão do menu Resultado · Visão Geral (owner/admin sempre; gerente por padrão).
insert into public.permission_keys (key, category, label, sort_order) values
  ('menu.resultado.visao-geral', 'resultado', 'Resultado · Visão Geral', 59)
on conflict (key) do nothing;

insert into public.role_permissions (workspace_id, role, permission_key, granted)
select w.id, 'manager'::public.workspace_role, 'menu.resultado.visao-geral', true
from public.workspaces w
on conflict (workspace_id, role, permission_key) do update set granted = excluded.granted;
