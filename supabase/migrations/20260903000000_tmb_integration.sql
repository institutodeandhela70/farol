-- Integração TMB Educação (Tem Mais no Boleto): webhook_secret separado do
-- api_key porque a TMB usa duas credenciais distintas — Bearer token da REST
-- API (api_key) e um valor de header escolhido pelo produtor, colado nas 3
-- configurações de webhook do painel da TMB (webhook_secret). Hubla/Asaas/
-- HubSpot continuam usando só api_key.
alter table public.integration_secrets add column if not exists webhook_secret text;

-- tmb_sales: uma linha por pedido, alimentada pelo webhook de Vendas
-- (status_pedido: Efetivado/Cancelado) e reconciliada depois via sync REST.
-- Mesmo padrão de hubla_sales: sem policy de insert/update pra authenticated
-- (só a Edge Function, via service role, escreve aqui), raw_payload guarda o
-- payload cru pra tolerar campos novos sem quebrar.
create table if not exists public.tmb_sales (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,

  pedido_id integer not null,
  status text,
  status_financeiro text,

  producer_id integer,
  producer_name text,
  product_id integer,
  product_name text,

  customer_name text,
  customer_document text,
  customer_email text,
  customer_phone text,

  valor_principal numeric(14, 2),
  valor_entrada numeric(14, 2),
  valor_parcela numeric(14, 2),
  valor_total numeric(14, 2),
  taxa_administracao numeric(14, 2),
  parcelas integer,
  melhor_dia_pagamento integer,

  criado_em timestamptz,
  data_efetivado timestamptz,

  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_last_source text,
  utm_last_medium text,
  utm_last_campaign text,
  utm_last_content text,

  endereco_pais text,
  endereco_estado text,
  endereco_cidade text,
  endereco_bairro text,
  endereco_logradouro text,
  endereco_numero text,
  endereco_complemento text,
  endereco_cep text,

  source text check (source in ('webhook', 'import')) default 'webhook',
  raw_payload jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (workspace_id, pedido_id)
);

create index if not exists tmb_sales_workspace_status_idx on public.tmb_sales (workspace_id, status);
create index if not exists tmb_sales_workspace_efetivado_idx on public.tmb_sales (workspace_id, data_efetivado);

alter table public.tmb_sales enable row level security;
drop policy if exists "tmb_sales_select_member" on public.tmb_sales;
create policy "tmb_sales_select_member"
  on public.tmb_sales for select
  using (public.is_workspace_member(workspace_id));


-- tmb_installments: uma linha por parcela, alimentada pelo webhook Financeiro
-- (status_pagamento: Aguardando pagamento/Recebido/Vencido/DELETED/Estornado).
create table if not exists public.tmb_installments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,

  parcela_id text not null,
  pedido_id integer,
  parcela integer,

  status_pagamento text,
  vencimento_parcela date,
  data_pagamento timestamptz,

  valor_parcela_sem_juros numeric(14, 2),
  repasse numeric(14, 2),

  produto text,
  product_id integer,
  modalidade_contrato text,

  customer_name text,
  customer_document text,
  customer_email text,

  raw_payload jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (workspace_id, parcela_id)
);

create index if not exists tmb_installments_workspace_status_idx on public.tmb_installments (workspace_id, status_pagamento);

alter table public.tmb_installments enable row level security;
drop policy if exists "tmb_installments_select_member" on public.tmb_installments;
create policy "tmb_installments_select_member"
  on public.tmb_installments for select
  using (public.is_workspace_member(workspace_id));


-- tmb_checkout_steps: uma linha por pedido, guardando só a etapa atual do
-- funil de checkout (fase_checkout) — não o histórico completo das etapas.
create table if not exists public.tmb_checkout_steps (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,

  pedido_id integer not null,
  fase_checkout text,
  status_pedido text,

  customer_name text,
  customer_document text,
  customer_email text,

  product_id integer,
  product_name text,
  valor_total numeric(14, 2),

  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,

  url_boleto_entrada text,
  criado_em timestamptz,

  raw_payload jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (workspace_id, pedido_id)
);

create index if not exists tmb_checkout_steps_workspace_fase_idx on public.tmb_checkout_steps (workspace_id, fase_checkout);

alter table public.tmb_checkout_steps enable row level security;
drop policy if exists "tmb_checkout_steps_select_member" on public.tmb_checkout_steps;
create policy "tmb_checkout_steps_select_member"
  on public.tmb_checkout_steps for select
  using (public.is_workspace_member(workspace_id));
