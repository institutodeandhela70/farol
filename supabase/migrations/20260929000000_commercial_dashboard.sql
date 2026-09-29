-- Base de dados do Dashboard Comercial (Fase 1).
--
-- 1) Promove pra coluna o que o dashboard filtra/agrupa e hoje só existe no
--    raw_properties (dono do negócio, closer, probabilidade, ganho/perdido,
--    quem agendou a reunião).
-- 2) Configuração de quais pipelines contam como venda (ex.: "Distrato" não conta).
-- 3) Cadastro de metas por vendedor/mês (a HubSpot sincronizada não tem metas).
-- 4) Funções de agregação — meses sempre no fuso de São Paulo.

-- ---------------------------------------------------------------------------
-- 1) Colunas promovidas
-- ---------------------------------------------------------------------------

-- owner_id (donos) e user_id (usuários) são IDs diferentes na HubSpot; reunião
-- guarda "quem criou" como user_id, então o mapeamento é necessário.
alter table public.hubspot_owners add column if not exists user_id text;
create index if not exists hubspot_owners_user_idx on public.hubspot_owners (workspace_id, user_id);

alter table public.hubspot_deals
  add column if not exists owner_id text,
  add column if not exists closer_owner_id text,
  add column if not exists stage_probability numeric(6, 4),
  add column if not exists is_closed boolean not null default false,
  add column if not exists is_closed_won boolean not null default false;

update public.hubspot_deals set
  owner_id = nullif(raw_properties->>'hubspot_owner_id', ''),
  closer_owner_id = nullif(raw_properties->>'closer_responsavel', ''),
  stage_probability = nullif(raw_properties->>'hs_deal_stage_probability', '')::numeric,
  is_closed = coalesce(raw_properties->>'hs_is_closed' = 'true', false),
  is_closed_won = coalesce(raw_properties->>'hs_is_closed_won' = 'true', false);

create index if not exists hubspot_deals_owner_idx on public.hubspot_deals (workspace_id, owner_id);
create index if not exists hubspot_deals_closer_idx on public.hubspot_deals (workspace_id, closer_owner_id);
create index if not exists hubspot_deals_open_idx on public.hubspot_deals (workspace_id, pipeline, is_closed);
create index if not exists hubspot_deals_closedate_idx on public.hubspot_deals (workspace_id, closedate);

alter table public.hubspot_meetings
  add column if not exists created_by_user_id text,
  add column if not exists source text;

update public.hubspot_meetings set
  created_by_user_id = nullif(raw_properties->>'hs_created_by_user_id', ''),
  source = nullif(raw_properties->>'hs_meeting_source', '');

create index if not exists hubspot_meetings_creator_idx on public.hubspot_meetings (workspace_id, created_by_user_id);
create index if not exists hubspot_meetings_created_idx on public.hubspot_meetings (workspace_id, created_at_hubspot);

-- ---------------------------------------------------------------------------
-- 2) Pipelines que contam como venda
-- ---------------------------------------------------------------------------

-- Sem linha = conta como venda. Só precisa gravar as exceções.
create table if not exists public.commercial_pipeline_settings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  pipeline_id text not null,
  counts_as_sales boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, pipeline_id)
);

alter table public.commercial_pipeline_settings enable row level security;

drop policy if exists "commercial_pipeline_settings_select_member" on public.commercial_pipeline_settings;
create policy "commercial_pipeline_settings_select_member"
  on public.commercial_pipeline_settings for select
  using (public.is_workspace_member(workspace_id));

drop policy if exists "commercial_pipeline_settings_write_admin" on public.commercial_pipeline_settings;
create policy "commercial_pipeline_settings_write_admin"
  on public.commercial_pipeline_settings for all
  using (public.is_workspace_member(workspace_id, array['owner', 'admin']::public.workspace_role[]))
  with check (public.is_workspace_member(workspace_id, array['owner', 'admin']::public.workspace_role[]));

-- Distrato é cancelamento de venda — "ganho" ali não é receita.
insert into public.commercial_pipeline_settings (workspace_id, pipeline_id, counts_as_sales)
select workspace_id, pipeline_id, false
from public.hubspot_pipelines
where label ilike '%distrato%'
on conflict (workspace_id, pipeline_id) do nothing;

-- ---------------------------------------------------------------------------
-- 3) Metas por vendedor/mês
-- ---------------------------------------------------------------------------

create table if not exists public.commercial_goals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id text not null,                 -- hubspot_owners.owner_id
  month date not null,                    -- sempre o dia 1 do mês
  revenue_target numeric(14, 2),          -- valor fechado (ganho)
  deals_target integer,                   -- negócios ganhos
  meetings_held_target integer,           -- reuniões conduzidas (closer)
  meetings_scheduled_target integer,      -- reuniões agendadas (SDR)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, owner_id, month),
  check (extract(day from month) = 1)
);

alter table public.commercial_goals enable row level security;

drop policy if exists "commercial_goals_select_member" on public.commercial_goals;
create policy "commercial_goals_select_member"
  on public.commercial_goals for select
  using (public.is_workspace_member(workspace_id));

drop policy if exists "commercial_goals_write_admin" on public.commercial_goals;
create policy "commercial_goals_write_admin"
  on public.commercial_goals for all
  using (public.is_workspace_member(workspace_id, array['owner', 'admin']::public.workspace_role[]))
  with check (public.is_workspace_member(workspace_id, array['owner', 'admin']::public.workspace_role[]));

-- ---------------------------------------------------------------------------
-- 4) Funções de agregação
-- ---------------------------------------------------------------------------

-- Pipelines considerados: os passados explicitamente, ou (se null) todos os que
-- contam como venda.
create or replace function public.commercial_sales_pipelines(p_workspace_id uuid, p_pipeline_ids text[])
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    p_pipeline_ids,
    array(
      select p.pipeline_id
      from public.hubspot_pipelines p
      left join public.commercial_pipeline_settings s
        on s.workspace_id = p.workspace_id and s.pipeline_id = p.pipeline_id
      where p.workspace_id = p_workspace_id
        and coalesce(s.counts_as_sales, true)
    )
  );
$$;

-- Reuniões por quem CONDUZ (dono da reunião). "Sem registro" = já passou e o
-- resultado continua "agendada" ou vazio — ninguém marcou se aconteceu.
create or replace function public.commercial_meetings_by_conductor(
  p_workspace_id uuid,
  p_start_date timestamptz default null,
  p_end_date timestamptz default null,
  p_activity_types text[] default null
)
returns table (
  owner_id text,
  total_count bigint,
  past_count bigint,
  upcoming_count bigint,
  completed_count bigint,
  no_show_count bigint,
  rescheduled_count bigint,
  canceled_count bigint,
  unrecorded_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(m.owner_id, '(sem proprietário)'),
    count(*),
    count(*) filter (where m.start_time <= now()),
    count(*) filter (where m.start_time > now()),
    count(*) filter (where m.outcome = 'COMPLETED'),
    count(*) filter (where m.outcome = 'NO_SHOW'),
    count(*) filter (where m.outcome = 'RESCHEDULED'),
    count(*) filter (where m.outcome = 'CANCELED'),
    count(*) filter (where m.start_time <= now() and coalesce(m.outcome, 'SCHEDULED') = 'SCHEDULED')
  from public.hubspot_meetings m
  where m.workspace_id = p_workspace_id
    and public.is_workspace_member(p_workspace_id)
    and (p_start_date is null or m.start_time >= p_start_date)
    and (p_end_date is null or m.start_time <= p_end_date)
    and (p_activity_types is null or m.activity_type = any(p_activity_types))
  group by 1
  order by 2 desc;
$$;

-- Reuniões por quem AGENDOU (SDR). p_date_basis:
--   'created' — reuniões criadas no período (produtividade de agendamento)
--   'meeting' — reuniões que acontecem no período
create or replace function public.commercial_meetings_by_scheduler(
  p_workspace_id uuid,
  p_start_date timestamptz default null,
  p_end_date timestamptz default null,
  p_date_basis text default 'created',
  p_activity_types text[] default null
)
returns table (
  scheduler_user_id text,
  scheduler_owner_id text,
  total_count bigint,
  for_others_count bigint,
  past_count bigint,
  upcoming_count bigint,
  completed_count bigint,
  no_show_count bigint,
  rescheduled_count bigint,
  canceled_count bigint,
  unrecorded_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select
      m.*,
      case when p_date_basis = 'meeting' then m.start_time else m.created_at_hubspot end as ref_date
    from public.hubspot_meetings m
    where m.workspace_id = p_workspace_id
      and public.is_workspace_member(p_workspace_id)
      and (p_activity_types is null or m.activity_type = any(p_activity_types))
  )
  select
    coalesce(b.created_by_user_id, '(desconhecido)'),
    max(o.owner_id),
    count(*),
    -- Compara user ids direto da reunião (não depende do mapeamento de donos).
    count(*) filter (
      where b.created_by_user_id is not null
        and not (b.created_by_user_id = any(string_to_array(coalesce(b.raw_properties->>'hs_user_ids_of_all_owners', ''), ';')))
    ),
    count(*) filter (where b.start_time <= now()),
    count(*) filter (where b.start_time > now()),
    count(*) filter (where b.outcome = 'COMPLETED'),
    count(*) filter (where b.outcome = 'NO_SHOW'),
    count(*) filter (where b.outcome = 'RESCHEDULED'),
    count(*) filter (where b.outcome = 'CANCELED'),
    count(*) filter (where b.start_time <= now() and coalesce(b.outcome, 'SCHEDULED') = 'SCHEDULED')
  from base b
  left join public.hubspot_owners o
    on o.workspace_id = b.workspace_id and o.user_id = b.created_by_user_id
  where (p_start_date is null or b.ref_date >= p_start_date)
    and (p_end_date is null or b.ref_date <= p_end_date)
  group by 1
  order by 3 desc;
$$;

-- Fechamento por mês (data de fechamento, fuso SP) × vendedor.
-- p_attribution: 'owner' (dono do negócio) ou 'closer' (campo Closer responsável).
create or replace function public.commercial_monthly_closing(
  p_workspace_id uuid,
  p_start_date timestamptz default null,
  p_end_date timestamptz default null,
  p_attribution text default 'owner',
  p_pipeline_ids text[] default null
)
returns table (
  month date,
  owner_id text,
  won_count bigint,
  won_amount numeric,
  lost_count bigint,
  lost_amount numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    date_trunc('month', d.closedate at time zone 'America/Sao_Paulo')::date,
    coalesce(case when p_attribution = 'closer' then d.closer_owner_id else d.owner_id end, '(sem proprietário)'),
    count(*) filter (where d.is_closed_won),
    coalesce(sum(d.amount) filter (where d.is_closed_won), 0),
    count(*) filter (where not d.is_closed_won),
    coalesce(sum(d.amount) filter (where not d.is_closed_won), 0)
  from public.hubspot_deals d
  where d.workspace_id = p_workspace_id
    and public.is_workspace_member(p_workspace_id)
    and d.is_closed
    and d.closedate is not null
    and d.pipeline = any(public.commercial_sales_pipelines(p_workspace_id, p_pipeline_ids))
    and (p_start_date is null or d.closedate >= p_start_date)
    and (p_end_date is null or d.closedate <= p_end_date)
  group by 1, 2
  order by 1, 4 desc;
$$;

-- Negócios em aberto: pipeline × etapa × vendedor × mês previsto de fechamento.
-- Previsão ponderada = valor × probabilidade da etapa. close_month null = sem
-- data prevista; close_month no passado = previsão vencida.
create or replace function public.commercial_open_pipeline(
  p_workspace_id uuid,
  p_attribution text default 'owner',
  p_pipeline_ids text[] default null
)
returns table (
  pipeline_id text,
  stage_id text,
  owner_id text,
  close_month date,
  open_count bigint,
  open_amount numeric,
  weighted_amount numeric,
  without_amount_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    d.pipeline,
    d.dealstage,
    coalesce(case when p_attribution = 'closer' then d.closer_owner_id else d.owner_id end, '(sem proprietário)'),
    date_trunc('month', d.closedate at time zone 'America/Sao_Paulo')::date,
    count(*),
    coalesce(sum(d.amount), 0),
    coalesce(sum(d.amount * coalesce(d.stage_probability, 0)), 0),
    count(*) filter (where d.amount is null)
  from public.hubspot_deals d
  where d.workspace_id = p_workspace_id
    and public.is_workspace_member(p_workspace_id)
    and not d.is_closed
    and d.pipeline = any(public.commercial_sales_pipelines(p_workspace_id, p_pipeline_ids))
  group by 1, 2, 3, 4;
$$;

-- ---------------------------------------------------------------------------
-- 5) Sync diário não pode abandonar integração que deu erro uma vez
-- ---------------------------------------------------------------------------
-- Antes pulava status = 'error': um único 429 da HubSpot (10/09) deixou o sync
-- parado por semanas. Erro transitório tem que ser tentado de novo no dia
-- seguinte; só "disconnected" (sem credencial) fica de fora.
create or replace function public.trigger_scheduled_syncs()
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
  select decrypted_secret into v_internal_token
  from vault.decrypted_secrets
  where name = 'farol_internal_token'
  limit 1;

  select decrypted_secret into v_function_base_url
  from vault.decrypted_secrets
  where name = 'edge_functions_base_url'
  limit 1;

  if v_internal_token is null or v_function_base_url is null then
    raise notice 'trigger_scheduled_syncs: faltando segredo no Vault (farol_internal_token ou edge_functions_base_url) — abortando.';
    return;
  end if;

  for v_row in
    select id, provider
    from public.integrations
    where provider in ('asaas', 'hubspot', 'tmb')
      and status <> 'disconnected'
      and sync_enabled = true
  loop
    perform net.http_post(
      url := v_function_base_url || '/functions/v1/sync-' || v_row.provider,
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_internal_token,
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object('integration_id', v_row.id)
    );
  end loop;
end;
$$;
