-- Vendas — dedupe: combo de Contratos com mais de uma pessoa ("A e B", "A & B").
-- Além do nome igual, o negócio da Hubla & TMB também é duplicado quando o nome
-- dele (10+ caracteres) aparece dentro do nome do negócio de Contratos.
create or replace view public.sales_deals_x_v with (security_invoker = true) as
select
  v.*,
  (
    v.pipeline_kind = 'hubla_tmb' and v.is_high and v.cliente_norm <> ''
    and coalesce(s.dedupe_enabled, true)
    and (
      exists (
        select 1 from public.sales_deals_v k
        where k.workspace_id = v.workspace_id
          and k.pipeline_kind = 'contratos'
          and k.is_high
          and k.produto = v.produto
          and k.cliente_norm = v.cliente_norm
          and abs(k.dia - v.dia) <= coalesce(s.dedupe_days, 90)
      )
      or (
        length(v.cliente_norm) >= 10
        and exists (
          select 1 from public.sales_deals_v k
          where k.workspace_id = v.workspace_id
            and k.pipeline_kind = 'contratos'
            and k.is_high
            and k.produto = v.produto
            and position(v.cliente_norm in k.cliente_norm) > 0
            and abs(k.dia - v.dia) <= coalesce(s.dedupe_days, 90)
        )
      )
    )
  ) as duplicado
from public.sales_deals_v v
left join public.sales_settings s on s.workspace_id = v.workspace_id;
