-- Instagram (Graph API) — Fase 3: perfil, métricas diárias da conta, posts/reels/stories com
-- insights, demografia da audiência e comentários. Alimentadas pela função
-- sync-meta-instagram (retomável, mesmo esquema de cursor do sync-meta-ads).
--
-- Dias das métricas da conta seguem o fuso do Instagram (meia-noite do Pacífico).
-- Stories só existem na API por 24h: o sync captura os insights enquanto estão no ar
-- e a linha fica guardada depois que o story expira.

create table if not exists public.meta_ig_profile_daily (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  ig_user_id text not null,
  date date not null,
  followers_count integer,
  follows_count integer,
  media_count integer,
  primary key (workspace_id, ig_user_id, date)
);

create table if not exists public.meta_ig_account_daily (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  ig_user_id text not null,
  date date not null,
  reach bigint,
  views bigint,
  likes bigint,
  comments bigint,
  shares bigint,
  saves bigint,
  replies bigint,
  reposts bigint,
  total_interactions bigint,
  accounts_engaged bigint,
  follows_net bigint,                -- começaram a seguir − deixaram de seguir (soma dos dois follow_type)
  follows_breakdown jsonb,
  synced_at timestamptz not null default now(),
  primary key (workspace_id, ig_user_id, date)
);

create table if not exists public.meta_ig_media (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  ig_user_id text not null,
  media_id text not null,
  product_type text,                 -- FEED | REELS | STORY
  media_type text,                   -- IMAGE | VIDEO | CAROUSEL_ALBUM
  caption text,
  permalink text,
  shortcode text,
  media_url text,                    -- URLs da CDN expiram; o sync renova nos posts recentes
  thumbnail_url text,
  posted_at timestamptz,
  like_count integer,
  comments_count integer,
  is_shared_to_feed boolean,
  children_count integer,
  -- insights
  reach bigint,
  views bigint,
  likes bigint,
  comments bigint,
  shares bigint,
  saved bigint,
  total_interactions bigint,
  reposts bigint,
  follows bigint,
  profile_visits bigint,
  replies bigint,
  avg_watch_time_ms bigint,
  total_watch_time_ms bigint,
  story_navigation jsonb,            -- SWIPE_FORWARD / TAP_FORWARD / TAP_BACK / TAP_EXIT
  insights_synced_at timestamptz,
  insights_error text,
  -- comentários
  comments_synced_count integer,
  comments_synced_at timestamptz,
  expired_at timestamptz,            -- stories: quando deixou de aparecer na API
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, media_id)
);

create table if not exists public.meta_ig_audience (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  ig_user_id text not null,
  date date not null,
  metric text not null,              -- follower | engaged
  breakdown text not null,           -- age | gender | city | country
  key text not null,
  value bigint,
  primary key (workspace_id, ig_user_id, date, metric, breakdown, key)
);

create table if not exists public.meta_ig_comments (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  ig_user_id text not null,
  comment_id text not null,
  media_id text not null,
  parent_id text,
  text text,
  commented_at timestamptz,
  like_count integer,
  synced_at timestamptz not null default now(),
  primary key (workspace_id, comment_id)
);

create table if not exists public.meta_ig_sync_locks (
  integration_id uuid primary key references public.integrations(id) on delete cascade,
  locked_until timestamptz not null
);

create index if not exists meta_ig_media_posted_idx on public.meta_ig_media (workspace_id, ig_user_id, posted_at desc);
create index if not exists meta_ig_media_type_idx on public.meta_ig_media (workspace_id, product_type, posted_at desc);
create index if not exists meta_ig_comments_media_idx on public.meta_ig_comments (workspace_id, media_id);
create index if not exists meta_ig_account_daily_idx on public.meta_ig_account_daily (workspace_id, ig_user_id, date);

do $$
declare t text;
begin
  foreach t in array array['meta_ig_profile_daily','meta_ig_account_daily','meta_ig_media','meta_ig_audience','meta_ig_comments'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s_select_member" on public.%I', t, t);
    execute format('create policy "%s_select_member" on public.%I for select using (public.is_workspace_member(workspace_id))', t, t);
  end loop;
end $$;
alter table public.meta_ig_sync_locks enable row level security;

-- Agendamento: a cada 15 min, dispara o sync do Instagram só se houver carga pendente
-- ou se o último ciclo completo tem mais de 2h (stories precisam de captura frequente).
create or replace function public.trigger_meta_ig_sync()
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
    raise notice 'trigger_meta_ig_sync: faltando segredo no Vault — abortando.';
    return;
  end if;

  for v_row in
    select i.id
    from public.integrations i
    where i.provider = 'meta' and i.status <> 'disconnected' and i.sync_enabled = true
      and exists (select 1 from public.meta_ig_accounts a where a.integration_id = i.id and a.enabled)
      and (
        exists (
          select 1 from public.meta_sync_state s
          where s.integration_id = i.id and s.dataset like 'ig\_%' and (s.cursor_date is not null or s.cycle_started_at is not null)
        )
        or not exists (
          select 1 from public.meta_sync_state s
          where s.integration_id = i.id and s.dataset = 'ig_stories' and s.completed_at > now() - interval '2 hours'
        )
      )
  loop
    perform net.http_post(
      url := v_function_base_url || '/functions/v1/sync-meta-instagram',
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_internal_token, 'Content-Type', 'application/json'),
      body := jsonb_build_object('integration_id', v_row.id, 'background', true)
    );
  end loop;
end;
$$;
revoke all on function public.trigger_meta_ig_sync() from public, anon, authenticated;

select cron.unschedule('farol-meta-ig-sync') where exists (select 1 from cron.job where jobname = 'farol-meta-ig-sync');
select cron.schedule('farol-meta-ig-sync', '5,20,35,50 * * * *', $$ select public.trigger_meta_ig_sync(); $$);

-- Permissões do menu Marketing · Instagram (owner/admin sempre; gerente por padrão)
insert into public.permission_keys (key, category, label, sort_order) values
  ('menu.marketing.instagram', 'marketing', 'Marketing · Instagram — Visão Geral', 73),
  ('menu.marketing.instagram-conteudo', 'marketing', 'Marketing · Instagram — Conteúdo', 74),
  ('menu.marketing.instagram-audiencia', 'marketing', 'Marketing · Instagram — Audiência & Comentários', 75)
on conflict (key) do nothing;

insert into public.role_permissions (workspace_id, role, permission_key, granted)
select w.id, 'manager'::public.workspace_role, k.key, true
from public.workspaces w
cross join (values ('menu.marketing.instagram'), ('menu.marketing.instagram-conteudo'), ('menu.marketing.instagram-audiencia')) as k(key)
on conflict (workspace_id, role, permission_key) do update set granted = excluded.granted;

-- Posts que ainda precisam ter os comentários baixados (contagem mudou desde a última leitura).
create or replace function public.meta_ig_media_needing_comments(p_workspace_id uuid, p_limit integer)
returns table (media_id text, ig_user_id text, comments_count integer)
language sql
stable
set search_path = public
as $$
  select m.media_id, m.ig_user_id, m.comments_count
  from public.meta_ig_media m
  where m.workspace_id = p_workspace_id
    and m.product_type <> 'STORY'
    and m.comments_count > 0
    and (m.comments_synced_count is null or m.comments_synced_count <> m.comments_count)
  order by m.posted_at desc
  limit p_limit;
$$;
revoke all on function public.meta_ig_media_needing_comments(uuid, integer) from public, anon, authenticated;
