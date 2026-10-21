-- Meta Ads — Fase 2: estrutura (campanhas / conjuntos / anúncios), métricas
-- diárias por anúncio e breakdowns por campanha. Alimentadas pela função
-- sync-meta-ads, que é retomável (cursor por conta e dataset) porque a carga
-- de histórico não cabe numa única execução de Edge Function.
--
-- Valores monetários ficam na moeda da conta (hoje tudo BRL), já em reais
-- (a Graph API devolve orçamento em centavos; insights de gasto já vêm em reais).

create table if not exists public.meta_campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  account_id text not null,
  campaign_id text not null,
  name text,
  objective text,
  status text,
  effective_status text,
  buying_type text,
  bid_strategy text,
  daily_budget numeric(14, 2),
  lifetime_budget numeric(14, 2),
  start_time timestamptz,
  stop_time timestamptz,
  created_time timestamptz,
  updated_time timestamptz,
  raw_payload jsonb,
  synced_at timestamptz not null default now(),
  unique (workspace_id, campaign_id)
);

create table if not exists public.meta_adsets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  account_id text not null,
  adset_id text not null,
  campaign_id text,
  name text,
  status text,
  effective_status text,
  optimization_goal text,
  billing_event text,
  bid_strategy text,
  destination_type text,
  daily_budget numeric(14, 2),
  lifetime_budget numeric(14, 2),
  start_time timestamptz,
  end_time timestamptz,
  created_time timestamptz,
  updated_time timestamptz,
  targeting jsonb,
  promoted_object jsonb,
  synced_at timestamptz not null default now(),
  unique (workspace_id, adset_id)
);

create table if not exists public.meta_ads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  account_id text not null,
  ad_id text not null,
  adset_id text,
  campaign_id text,
  name text,
  status text,
  effective_status text,
  created_time timestamptz,
  updated_time timestamptz,
  creative_id text,
  creative_name text,
  creative_title text,
  creative_body text,
  creative_thumbnail_url text,
  creative_image_url text,
  creative_object_type text,
  creative_call_to_action text,
  effective_object_story_id text,   -- id do post (Página_post) — liga o anúncio ao post do Instagram/Facebook
  instagram_permalink_url text,
  raw_payload jsonb,
  synced_at timestamptz not null default now(),
  unique (workspace_id, ad_id)
);

create table if not exists public.meta_ad_insights_daily (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  account_id text not null,
  ad_id text not null,
  date date not null,
  campaign_id text,
  adset_id text,
  spend numeric(14, 2),
  impressions bigint,
  reach bigint,
  clicks bigint,
  link_clicks bigint,
  ctr numeric(10, 4),
  cpm numeric(14, 4),
  cpc numeric(14, 4),
  frequency numeric(10, 4),
  actions jsonb,         -- [{action_type, value}] — leads, compras, conversas etc.
  action_values jsonb,   -- valor monetário por action_type
  extra jsonb,           -- purchase_roas, video_thruplay_watched_actions
  synced_at timestamptz not null default now(),
  primary key (workspace_id, ad_id, date)
);

-- Breakdowns por campanha/dia. breakdown = 'placement' | 'age_gender' | 'region'
-- placement: key1 = publisher_platform, key2 = platform_position
-- age_gender: key1 = age, key2 = gender    region: key1 = region
create table if not exists public.meta_insights_breakdowns (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  account_id text not null,
  campaign_id text not null,
  date date not null,
  breakdown text not null,
  key1 text not null default '',
  key2 text not null default '',
  spend numeric(14, 2),
  impressions bigint,
  reach bigint,
  clicks bigint,
  link_clicks bigint,
  actions jsonb,
  action_values jsonb,
  synced_at timestamptz not null default now(),
  primary key (workspace_id, campaign_id, date, breakdown, key1, key2)
);

create index if not exists meta_campaigns_account_idx on public.meta_campaigns (workspace_id, account_id);
create index if not exists meta_adsets_campaign_idx on public.meta_adsets (workspace_id, campaign_id);
create index if not exists meta_ads_campaign_idx on public.meta_ads (workspace_id, campaign_id);
create index if not exists meta_ad_insights_date_idx on public.meta_ad_insights_daily (workspace_id, date);
create index if not exists meta_ad_insights_campaign_idx on public.meta_ad_insights_daily (workspace_id, campaign_id, date);
create index if not exists meta_breakdowns_account_date_idx on public.meta_insights_breakdowns (workspace_id, account_id, date);

-- Cursor de carga por conta e dataset (campaigns, adsets, ads, insights, bd_placement, bd_age_gender, bd_region).
--   cursor_date    — insights: próximo dia a carregar enquanto um ciclo está em andamento (null = ocioso)
--   after_cursor   — estrutura: cursor de paginação da Graph API
--   cycle_started_at — estrutura: ciclo em andamento (null = ocioso)
--   loaded_through — insights: último dia carregado por completo
--   completed_at   — quando o dataset terminou o último ciclo (evita refazer na continuação encadeada)
--   synced_at      — estrutura: início do último ciclo concluído (próximo ciclo só busca o que mudou depois)
create table if not exists public.meta_sync_state (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  integration_id uuid not null references public.integrations(id) on delete cascade,
  account_id text not null,
  dataset text not null,
  cursor_date date,
  after_cursor text,
  cycle_started_at timestamptz,
  loaded_through date,
  synced_at timestamptz,
  completed_at timestamptz,
  rows_loaded bigint not null default 0,
  last_error text,
  updated_at timestamptz not null default now(),
  primary key (integration_id, account_id, dataset)
);

-- Trava pra duas execuções do sync não rodarem juntas na mesma integração.
create table if not exists public.meta_sync_locks (
  integration_id uuid primary key references public.integrations(id) on delete cascade,
  locked_until timestamptz not null
);

do $$
declare t text;
begin
  foreach t in array array['meta_campaigns','meta_adsets','meta_ads','meta_ad_insights_daily','meta_insights_breakdowns','meta_sync_state'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s_select_member" on public.%I', t, t);
    execute format('create policy "%s_select_member" on public.%I for select using (public.is_workspace_member(workspace_id))', t, t);
  end loop;
end $$;

alter table public.meta_sync_locks enable row level security;

-- Agendamento: a cada 3 horas dispara o sync de cada integração Meta ativa.
-- A função se encadeia sozinha enquanto houver carga pendente (backfill).
create or replace function public.trigger_meta_sync()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_internal_token text;
  v_function_base_url text;
  v_row record;
begin
  select decrypted_secret into v_internal_token from vault.decrypted_secrets where name = 'farol_internal_token' limit 1;
  select decrypted_secret into v_function_base_url from vault.decrypted_secrets where name = 'edge_functions_base_url' limit 1;

  if v_internal_token is null or v_function_base_url is null then
    raise notice 'trigger_meta_sync: faltando segredo no Vault — abortando.';
    return;
  end if;

  for v_row in
    select id from public.integrations
    where provider = 'meta' and status <> 'disconnected' and sync_enabled = true
  loop
    perform net.http_post(
      url := v_function_base_url || '/functions/v1/sync-meta-ads',
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_internal_token, 'Content-Type', 'application/json'),
      body := jsonb_build_object('integration_id', v_row.id, 'background', true)
    );
  end loop;
end;
$$;
revoke all on function public.trigger_meta_sync() from public, anon, authenticated;

select cron.unschedule('farol-meta-sync') where exists (select 1 from cron.job where jobname = 'farol-meta-sync');
select cron.schedule('farol-meta-sync', '10 */3 * * *', $$ select public.trigger_meta_sync(); $$);
