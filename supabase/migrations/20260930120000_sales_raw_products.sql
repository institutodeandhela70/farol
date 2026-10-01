-- Vendas: valores de produto que existem nos negócios ganhos (todo o histórico),
-- com o nome padronizado e o grupo atual — base da tela Produtos (de-para).
create or replace function public.sales_raw_products(p_workspace_id uuid)
returns table (pipeline_kind text, produto_raw text, produto text, grupo text, qtd bigint, total numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select v.pipeline_kind, v.produto_raw, v.produto, v.grupo, count(*), coalesce(sum(v.amount), 0)
  from public.sales_deals_v v
  where v.workspace_id = p_workspace_id
  group by 1, 2, 3, 4
  order by 6 desc;
$$;
