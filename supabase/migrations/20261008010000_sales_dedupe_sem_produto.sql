-- Negócio da Hubla & TMB sem produto que repete um pagamento já registrado com
-- produto (mesmo contato e mesmo valor) é duplicidade do HubSpot: não conta
-- de novo nas Vendas. Casos de set/26: Yara Leal (Dubai R$ 34.800) e Thimila
-- Coutinho (DZP R$ 997).

create or replace view public.sales_deals_v with (security_invoker = true) as
select
  d.workspace_id,
  d.hubspot_id,
  d.dealname,
  d.amount,
  d.closedate,
  case when r.role = 'contratos' then
    public.sales_efetivacao_dia(
      (d.closedate at time zone 'America/Sao_Paulo')::date,
      coalesce(public.sales_prop_date(d.raw_properties->>'data_pagamento_entrada'), public.sales_prop_date(d.raw_properties->>'data_da_compra')),
      public.sales_prop_date(d.raw_properties->>'data_da_assinatura_do_contrato'))
  else (d.closedate at time zone 'America/Sao_Paulo')::date end as dia,
  r.role as pipeline_kind,
  d.owner_id,
  src.raw as produto_raw,
  prod.produto,
  coalesce(c.is_high, false) as is_high,
  case
    when coalesce(c.is_high, false) then 'high'
    when r.role = 'contratos' then 'fora_dos_6'
    else 'demais'
  end as grupo,
  d.dealname_norm as cliente_norm,
  d.dealname_parts as cliente_parts,
  coalesce(c.count_hubla, false) as count_hubla,
  d.contact_ids
from public.hubspot_deals d
join public.sales_pipeline_roles r on r.workspace_id = d.workspace_id and r.pipeline_id = d.pipeline
cross join lateral (
  select case when r.role = 'contratos' then d.produto_contratos else d.produto_hubla end as raw
) src
left join public.sales_product_overrides o on o.workspace_id = d.workspace_id and o.source = r.role and o.raw_value = src.raw
cross join lateral (select coalesce(o.produto, public.sales_canon_product(src.raw)) as produto) prod
left join public.sales_product_catalog c on c.workspace_id = d.workspace_id and c.produto = prod.produto
where d.is_closed_won and d.closedate is not null
  and coalesce(d.amount, 0) > 0
  and not (
    coalesce(d.raw_properties->>'informacoes_para_o_financeiro', '') ~* '^gratuito'
    and coalesce(d.raw_properties->>'informacoes_para_o_financeiro', '') !~* 'permuta'
  );

create or replace view public.sales_deals_x_v with (security_invoker = true) as
with contratos as materialized (
  select workspace_id, produto, cliente_norm, dia
  from public.sales_deals_v
  where pipeline_kind = 'contratos' and is_high and cliente_norm <> ''
)
select
  v.workspace_id, v.hubspot_id, v.dealname, v.amount, v.closedate, v.dia, v.pipeline_kind,
  v.owner_id, v.produto_raw, v.produto, v.is_high, v.grupo, v.cliente_norm, v.cliente_parts, v.count_hubla,
  (
    (
      v.pipeline_kind = 'hubla_tmb' and v.is_high
      and (
        not v.count_hubla
        or (
          v.cliente_norm <> '' and coalesce(s.dedupe_enabled, true)
          and exists (
            select 1 from contratos k
            where k.workspace_id = v.workspace_id and k.produto = v.produto
              and abs(k.dia - v.dia) <= coalesce(s.dedupe_days, 90)
              and (k.cliente_norm = v.cliente_norm
                   or (length(v.cliente_norm) >= 10 and position(v.cliente_norm in k.cliente_norm) > 0))
          )
        )
      )
    )
    or (
      v.pipeline_kind = 'hubla_tmb' and v.produto = '(sem produto)'
      and exists (
        select 1 from public.hubspot_deals b
        join public.sales_pipeline_roles br on br.workspace_id = b.workspace_id and br.pipeline_id = b.pipeline and br.role = 'hubla_tmb'
        where b.workspace_id = v.workspace_id and b.is_closed_won
          and b.hubspot_id <> v.hubspot_id and b.amount = v.amount
          and b.contact_ids && v.contact_ids
          and coalesce(b.produto_hubla, '') <> ''
      )
    )
  ) as duplicado
from public.sales_deals_v v
left join public.sales_settings s on s.workspace_id = v.workspace_id;

grant select on public.sales_deals_x_v to authenticated;
