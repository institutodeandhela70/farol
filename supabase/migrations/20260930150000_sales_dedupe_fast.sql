-- Vendas — dedupe mais rápida: a lista de ganhos de Contratos dos 6 é montada
-- uma vez por consulta (CTE) e cada negócio da Hubla & TMB só é comparado com ela.
create or replace view public.sales_deals_x_v with (security_invoker = true) as
with contratos as materialized (
  select workspace_id, produto, cliente_norm, dia
  from public.sales_deals_v
  where pipeline_kind = 'contratos' and is_high and cliente_norm <> ''
)
select
  v.*,
  (
    v.pipeline_kind = 'hubla_tmb' and v.is_high and v.cliente_norm <> ''
    and coalesce(s.dedupe_enabled, true)
    and exists (
      select 1 from contratos k
      where k.workspace_id = v.workspace_id
        and k.produto = v.produto
        and abs(k.dia - v.dia) <= coalesce(s.dedupe_days, 90)
        and (
          k.cliente_norm = v.cliente_norm
          or (length(v.cliente_norm) >= 10 and position(v.cliente_norm in k.cliente_norm) > 0)
        )
    )
  ) as duplicado
from public.sales_deals_v v
left join public.sales_settings s on s.workspace_id = v.workspace_id;
