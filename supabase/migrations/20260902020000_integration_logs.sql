-- Log unificado de toda atividade de integração — tanto webhooks recebidos (inbound,
-- ex: hubla-webhook) quanto syncs/diagnósticos disparados por nós (outbound, ex:
-- sync-asaas, sync-hubspot, diagnose-asaas, diagnose-hubspot). Uma linha por chamada.
-- Escrita exclusiva via service role (mesmo padrão das demais tabelas de integração).
--
-- workspace_id e integration_id ficam nullable de propósito: uma chamada de webhook
-- com token inválido nunca chega a resolver workspace/integração, mas ainda vale
-- registrar (é exatamente o tipo de coisa que essa tela existe pra diagnosticar).
create table if not exists public.integration_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  integration_id uuid references public.integrations(id) on delete cascade,

  provider public.integration_provider not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  event_type text not null,

  status text not null check (status in ('success', 'error')),
  status_code integer,
  error_message text,
  duration_ms integer,

  request_payload jsonb,
  response_payload jsonb,

  created_at timestamptz not null default now()
);

create index if not exists integration_logs_workspace_created_idx on public.integration_logs (workspace_id, created_at desc);
create index if not exists integration_logs_workspace_status_idx on public.integration_logs (workspace_id, status);
create index if not exists integration_logs_workspace_provider_idx on public.integration_logs (workspace_id, provider);

alter table public.integration_logs enable row level security;

-- Membro vê os logs do próprio workspace; platform admin vê tudo (inclusive as
-- linhas sem workspace_id resolvido, como tentativas de webhook com token errado).
drop policy if exists "integration_logs_select" on public.integration_logs;
create policy "integration_logs_select"
  on public.integration_logs for select
  using (
    (workspace_id is not null and public.is_workspace_member(workspace_id))
    or public.is_platform_admin()
  );

-- hubla_sales/hubla_subscriptions/etc já são grandes o bastante pra precisar de RPC
-- em vez de contar client-side — integration_logs vai crescer rápido (uma linha por
-- webhook recebido), então já nasce com o mesmo padrão.
create or replace function public.integration_logs_summary(
  p_workspace_id uuid,
  p_provider text default null,
  p_status text default null,
  p_search text default null
)
returns table (total_count bigint, error_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    count(*)::bigint,
    count(*) filter (where status = 'error')::bigint
  from public.integration_logs
  where workspace_id = p_workspace_id
    and public.is_workspace_member(p_workspace_id)
    and (p_provider is null or provider::text = p_provider)
    and (p_status is null or status = p_status)
    and (p_search is null or p_search = '' or event_type ilike '%' || p_search || '%');
$$;

create or replace function public.integration_logs_filter_options(p_workspace_id uuid)
returns table (providers text[], event_types text[])
language sql
stable
security definer
set search_path = public
as $$
  select
    (
      select array_agg(distinct provider::text order by provider::text)
      from public.integration_logs
      where workspace_id = p_workspace_id and public.is_workspace_member(p_workspace_id)
    ),
    (
      select array_agg(distinct event_type order by event_type)
      from public.integration_logs
      where workspace_id = p_workspace_id and public.is_workspace_member(p_workspace_id)
    );
$$;
