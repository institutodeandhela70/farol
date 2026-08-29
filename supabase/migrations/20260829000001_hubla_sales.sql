-- Vendas da Hubla: carga inicial via planilha + atualização contínua via webhook.
-- Sem policy de INSERT/UPDATE para authenticated: todo write é feito por processo
-- server-side (import em lote via service role, ou a futura Edge Function de webhook).
create table if not exists public.hubla_sales (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,

  invoice_id text not null,
  invoice_type text,
  invoice_detail text,
  status text,
  decline_reason text,
  payment_method text,

  created_at_hubla timestamptz,
  paid_at timestamptz,
  refunded_at timestamptz,
  due_date timestamptz,
  release_date timestamptz,

  items_count integer,
  offer_name text,
  product_id text,
  product_name text,
  orderbump_product_id text,
  orderbump_product_name text,
  producer_id text,

  customer_id text,
  customer_name text,
  customer_document text,
  customer_email text,
  customer_phone text,

  subscription_id text,
  subscription_plan text,
  role text,

  product_value numeric(14, 2),
  discount_value numeric(14, 2),
  coupon_code text,

  smart_installment_id text,
  smart_installment_number integer,
  smart_installment_total integer,
  installments integer,
  installment_interest_value numeric(14, 2),

  total_value numeric(14, 2),
  hubla_fee_variable numeric(14, 2),
  hubla_fee_fixed numeric(14, 2),
  installment_interest_cost numeric(14, 2),
  affiliate_commission_value numeric(14, 2),
  net_value numeric(14, 2),
  coproducer_commission_value numeric(14, 2),
  your_commission_value numeric(14, 2),

  affiliate_id text,
  affiliate_name text,

  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,

  address_country text,
  address_state text,
  address_city text,
  address_neighborhood text,
  address_street text,
  address_number text,
  address_complement text,
  address_zip text,

  original_invoice_id text,
  cookie_gclid text,
  cookie_fbclid text,
  cookie_fbp text,
  cookie_fbc text,
  purchase_url text,
  has_multiple_cards boolean,
  card_count integer,

  source text not null default 'import' check (source in ('import', 'webhook')),
  raw_payload jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (workspace_id, invoice_id)
);

create index if not exists hubla_sales_workspace_status_idx on public.hubla_sales (workspace_id, status);
create index if not exists hubla_sales_workspace_paid_at_idx on public.hubla_sales (workspace_id, paid_at);

alter table public.hubla_sales enable row level security;

drop policy if exists "hubla_sales_select_member" on public.hubla_sales;
create policy "hubla_sales_select_member"
  on public.hubla_sales for select
  using (public.is_workspace_member(workspace_id));
