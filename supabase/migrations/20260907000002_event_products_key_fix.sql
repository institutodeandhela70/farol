-- Fix: hubla_sales.product_id não é estável por produto — é granular por
-- oferta/checkout (ex: "[MXP] Memorável Experience 2026" sozinho tem 35
-- product_id distintos pras mesmas 368 vendas, um por variação de
-- oferta/parcelamento/afiliado). A chave real e estável é product_name.
-- event_products passa a linkar por hubla_product_name; product_id sai do
-- modelo (não serve pra filtrar hubla_sales de forma confiável).
alter table public.event_products drop constraint if exists event_products_event_id_hubla_product_id_role_key;
alter table public.event_products drop column if exists hubla_product_id;

alter table public.event_products
  add constraint event_products_event_id_hubla_product_name_role_key
  unique (event_id, hubla_product_name, role);
