-- Demais categorias de webhook da Hubla (além de invoice.*, já coberto por hubla_sales):
-- assinatura, membro (acesso), lead (carrinho abandonado), parcelamento inteligente,
-- solicitação de reembolso. Todas escritas exclusivamente pela Edge Function hubla-webhook
-- (service role) — sem policy de insert/update para authenticated, mesmo padrão de hubla_sales.

create table if not exists public.hubla_subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,

  subscription_id text not null,
  status text,
  subscription_type text,
  billing_cycle_months integer,
  credits integer,
  payment_method text,
  auto_renew boolean,
  free_trial boolean,

  product_id text,
  product_name text,
  seller_id text,
  payer_id text,

  customer_name text,
  customer_document text,
  customer_email text,
  customer_phone text,

  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,

  activated_at timestamptz,
  deactivated_at timestamptz,
  created_at_hubla timestamptz,
  modified_at_hubla timestamptz,

  last_event_type text,
  raw_payload jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (workspace_id, subscription_id)
);

create index if not exists hubla_subscriptions_workspace_status_idx on public.hubla_subscriptions (workspace_id, status);

alter table public.hubla_subscriptions enable row level security;
drop policy if exists "hubla_subscriptions_select_member" on public.hubla_subscriptions;
create policy "hubla_subscriptions_select_member"
  on public.hubla_subscriptions for select
  using (public.is_workspace_member(workspace_id));


create table if not exists public.hubla_memberships (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,

  subscription_id text not null,
  product_id text,
  product_name text,

  status text,
  payment_method text,
  auto_renew boolean,
  credits integer,

  customer_name text,
  customer_document text,
  customer_email text,
  customer_phone text,

  granted_at timestamptz,
  removed_at timestamptz,

  raw_payload jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (workspace_id, subscription_id)
);

create index if not exists hubla_memberships_workspace_status_idx on public.hubla_memberships (workspace_id, status);

alter table public.hubla_memberships enable row level security;
drop policy if exists "hubla_memberships_select_member" on public.hubla_memberships;
create policy "hubla_memberships_select_member"
  on public.hubla_memberships for select
  using (public.is_workspace_member(workspace_id));


create table if not exists public.hubla_abandoned_checkouts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,

  lead_id text not null,
  full_name text,
  email text,
  phone text,

  product_id text,
  product_name text,
  products jsonb,
  checkout_url text,

  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  cookie_fbp text,
  cookie_fbc text,
  cookie_gclid text,

  created_at_hubla timestamptz,
  raw_payload jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (workspace_id, lead_id)
);

create index if not exists hubla_abandoned_checkouts_workspace_created_idx on public.hubla_abandoned_checkouts (workspace_id, created_at_hubla);

alter table public.hubla_abandoned_checkouts enable row level security;
drop policy if exists "hubla_abandoned_checkouts_select_member" on public.hubla_abandoned_checkouts;
create policy "hubla_abandoned_checkouts_select_member"
  on public.hubla_abandoned_checkouts for select
  using (public.is_workspace_member(workspace_id));


create table if not exists public.hubla_installments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,

  smart_installment_id text not null,
  subscription_id text,
  source_invoice_id text,
  seller_id text,
  payer_id text,

  installment_number integer,
  installments_total integer,
  payment_method text,
  installment_type text,
  status text,
  total_value numeric(14, 2),

  product_id text,
  product_name text,
  customer_name text,
  customer_document text,
  customer_email text,
  customer_phone text,

  created_at_hubla timestamptz,
  modified_at_hubla timestamptz,
  raw_payload jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (workspace_id, smart_installment_id)
);

create index if not exists hubla_installments_workspace_status_idx on public.hubla_installments (workspace_id, status);

alter table public.hubla_installments enable row level security;
drop policy if exists "hubla_installments_select_member" on public.hubla_installments;
create policy "hubla_installments_select_member"
  on public.hubla_installments for select
  using (public.is_workspace_member(workspace_id));


create table if not exists public.hubla_refund_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,

  refund_id text not null,
  status text,
  description text,
  is_auto_accepted boolean,

  invoice_id text,
  subscription_id text,
  product_id text,
  product_name text,
  total_value numeric(14, 2),

  customer_name text,
  customer_document text,
  customer_email text,
  customer_phone text,

  created_at_hubla timestamptz,
  updated_at_hubla timestamptz,
  raw_payload jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (workspace_id, refund_id)
);

create index if not exists hubla_refund_requests_workspace_status_idx on public.hubla_refund_requests (workspace_id, status);

alter table public.hubla_refund_requests enable row level security;
drop policy if exists "hubla_refund_requests_select_member" on public.hubla_refund_requests;
create policy "hubla_refund_requests_select_member"
  on public.hubla_refund_requests for select
  using (public.is_workspace_member(workspace_id));
