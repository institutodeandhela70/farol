-- Hubla/TMB: nome do cliente normalizado como coluna gerada e indexada. As consultas de
-- Vendas (detalhe e "vendas que faltam em Contratos") buscam o contato do cliente por nome;
-- normalizar o nome de cada linha a cada consulta levava segundos.
alter table public.hubla_sales
  add column if not exists customer_norm text generated always as (public.receita_client_norm(customer_name)) stored;
alter table public.tmb_sales
  add column if not exists customer_norm text generated always as (public.receita_client_norm(customer_name)) stored;
create index if not exists hubla_sales_customer_norm_idx on public.hubla_sales (workspace_id, customer_norm);
create index if not exists tmb_sales_customer_norm_idx on public.tmb_sales (workspace_id, customer_norm);
