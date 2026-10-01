-- Vendas: a lista de maiores negócios não pode trazer os de "fora dos 6" (não entram na soma).
drop function if exists public.sales_deals_list(uuid, date, date, text, text, text[], integer, boolean);
create or replace function public.sales_deals_list(
  p_workspace_id uuid, p_from date, p_to date,
  p_grupo text default null, p_owner text default null, p_produto text[] default null,
  p_limit integer default 50, p_only_duplicates boolean default false, p_exclude_fora boolean default false
)
returns table (hubspot_id text, dealname text, produto text, produto_raw text, pipeline_kind text, grupo text, dia date, owner_id text, amount numeric, duplicado boolean)
language sql
stable
security invoker
set search_path = public
as $$
  select v.hubspot_id, v.dealname, v.produto, v.produto_raw, v.pipeline_kind, v.grupo, v.dia, v.owner_id, v.amount, v.duplicado
  from public.sales_deals_x_v v
  where v.workspace_id = p_workspace_id
    and v.dia between p_from and p_to
    and (case when p_only_duplicates then v.duplicado else not v.duplicado end)
    and (p_grupo is null or v.grupo = p_grupo)
    and (not p_exclude_fora or v.grupo <> 'fora_dos_6')
    and (p_owner is null or v.owner_id = p_owner)
    and (p_produto is null or v.produto = any(p_produto))
  order by v.amount desc nulls last, v.dia desc
  limit least(greatest(p_limit, 1), 500);
$$;
