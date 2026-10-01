-- Vendas: os dois campos de produto viram colunas geradas de hubspot_deals.
-- Ler raw_properties (JSON grande, guardado à parte) negócio a negócio deixava a
-- consulta lenta; como coluna, a leitura é direta e a sincronização não muda.
alter table public.hubspot_deals
  add column if not exists produto_contratos text generated always as (raw_properties->>'produto_de_interesse') stored,
  add column if not exists produto_hubla text generated always as (raw_properties->>'produtos') stored;

create or replace view public.sales_deals_v with (security_invoker = true) as
select
  d.workspace_id,
  d.hubspot_id,
  d.dealname,
  d.amount,
  d.closedate,
  (d.closedate at time zone 'America/Sao_Paulo')::date as dia,
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
  d.dealname_norm as cliente_norm
from public.hubspot_deals d
join public.sales_pipeline_roles r on r.workspace_id = d.workspace_id and r.pipeline_id = d.pipeline
cross join lateral (
  select case when r.role = 'contratos' then d.produto_contratos else d.produto_hubla end as raw
) src
left join public.sales_product_overrides o on o.workspace_id = d.workspace_id and o.source = r.role and o.raw_value = src.raw
cross join lateral (select coalesce(o.produto, public.sales_canon_product(src.raw)) as produto) prod
left join public.sales_product_catalog c on c.workspace_id = d.workspace_id and c.produto = prod.produto
where d.is_closed_won and d.closedate is not null;
