-- De-para de categorias: botão "buscar categorias novas" (só dono/admin) — inclui no
-- de-para as categorias de receita que surgiram no plano de contas da IULI.
create or replace function public.iuli_category_map_refresh(p_workspace_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_workspace_member(p_workspace_id, array['owner', 'admin']::public.workspace_role[]) then
    raise exception 'sem permissão';
  end if;
  return public.iuli_category_map_seed(p_workspace_id);
end;
$$;
revoke all on function public.iuli_category_map_refresh(uuid) from public, anon;
grant execute on function public.iuli_category_map_refresh(uuid) to authenticated;
