-- Meta (Ads + Instagram) — Fase 1: cadastro das contas descobertas pelo token
-- (System User) e quais delas o usuário escolheu sincronizar. As tabelas de
-- dados (campanhas, insights, posts) entram nas fases seguintes.

create table if not exists public.meta_ad_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  integration_id uuid not null references public.integrations(id) on delete cascade,

  account_id text not null,            -- formato act_123456
  name text,
  currency text,
  timezone_name text,
  account_status integer,              -- 1 = ativa, 2 = desativada, 3 = pendente de pagamento etc.
  business_id text,
  business_name text,
  amount_spent numeric(16, 2),         -- total gasto na vida da conta, na moeda dela
  enabled boolean not null default true,

  raw_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (workspace_id, account_id)
);

create table if not exists public.meta_ig_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  integration_id uuid not null references public.integrations(id) on delete cascade,

  ig_user_id text not null,
  username text,
  name text,
  followers_count integer,
  follows_count integer,
  media_count integer,
  profile_picture_url text,
  page_id text,
  page_name text,
  enabled boolean not null default true,

  raw_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (workspace_id, ig_user_id)
);

create index if not exists meta_ad_accounts_integration_idx on public.meta_ad_accounts (integration_id);
create index if not exists meta_ig_accounts_integration_idx on public.meta_ig_accounts (integration_id);

alter table public.meta_ad_accounts enable row level security;
drop policy if exists "meta_ad_accounts_select_member" on public.meta_ad_accounts;
create policy "meta_ad_accounts_select_member"
  on public.meta_ad_accounts for select
  using (public.is_workspace_member(workspace_id));

alter table public.meta_ig_accounts enable row level security;
drop policy if exists "meta_ig_accounts_select_member" on public.meta_ig_accounts;
create policy "meta_ig_accounts_select_member"
  on public.meta_ig_accounts for select
  using (public.is_workspace_member(workspace_id));
