-- Produtos distintos já vendidos na Hubla, pra alimentar o multi-select de
-- "quais produtos alimentam este evento" no cadastro de eventos (Fase 1 do
-- módulo de Eventos). Não existe catálogo de produtos Hubla separado — a
-- única fonte é o texto livre já gravado em hubla_sales.product_id/product_name.
-- Mesmo padrão de guard/security definer de tmb_sales_summary em
-- 20260903020000_tmb_dashboard_aggregates.sql.
create or replace function public.hubla_distinct_products(p_workspace_id uuid)
returns table (product_id text, product_name text, sales_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select product_id, product_name, count(*)::bigint as sales_count
  from public.hubla_sales
  where workspace_id = p_workspace_id
    and public.is_workspace_member(p_workspace_id)
    and product_id is not null
  group by product_id, product_name
  order by sales_count desc;
$$;
