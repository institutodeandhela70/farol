-- Logs por integração: o resumo da tela de logs passa a aceitar o id da
-- integração (cada card da tela de Integrações abre os logs só daquela
-- integração) e a consulta por integração ganha índice.

drop function if exists public.integration_logs_summary(uuid, text, text, text);

create or replace function public.integration_logs_summary(
  p_workspace_id uuid,
  p_provider text default null,
  p_status text default null,
  p_search text default null,
  p_integration_id uuid default null
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
    and (p_integration_id is null or integration_id = p_integration_id)
    and (p_search is null or p_search = '' or event_type ilike '%' || p_search || '%');
$$;

create index if not exists integration_logs_integration_created_idx
  on public.integration_logs (integration_id, created_at desc);
