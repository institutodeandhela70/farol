-- Fix: agrupar só por product_name — product_id é granular por
-- oferta/checkout, não por produto (ver 20260907000002). Assinatura de
-- retorno mudou (sem product_id), precisa dropar antes de recriar.
drop function if exists public.hubla_distinct_products(uuid);

create or replace function public.hubla_distinct_products(p_workspace_id uuid)
returns table (product_name text, sales_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select product_name, count(*)::bigint as sales_count
  from public.hubla_sales
  where workspace_id = p_workspace_id
    and public.is_workspace_member(p_workspace_id)
    and product_name is not null
  group by product_name
  order by sales_count desc;
$$;
