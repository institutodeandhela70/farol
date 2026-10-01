-- Dashboard Financeiro IULI.
--
-- A IULI não é consultada ao vivo pelas telas: ela só aceita UMA consulta em
-- andamento por empresa (429 nas demais) e algumas tools levam ~6s. Então a
-- edge function sync-iuli roda as consultas em fila e guarda cada resposta
-- aqui como um "snapshot" (uma linha por consulta, identificada por `key`,
-- ex: 'sales_month:2026-09'). As telas só leem esta tabela.
--
-- Cada snapshot tem validade (expires_at): mês corrente expira rápido, meses
-- fechados duram dias. O cron a cada 15 min atualiza os vencidos dentro de um
-- limite de tempo por execução — o que não coube fica pra próxima rodada.

create table if not exists public.iuli_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  integration_id uuid not null references public.integrations(id) on delete cascade,
  key text not null,
  tool text not null,
  args jsonb not null default '{}'::jsonb,
  payload jsonb,
  error text,
  fetched_at timestamptz,
  expires_at timestamptz not null default now(),
  duration_ms integer,
  updated_at timestamptz not null default now(),
  unique (integration_id, key)
);

create index if not exists iuli_snapshots_workspace_key_idx on public.iuli_snapshots (workspace_id, key);
create index if not exists iuli_snapshots_expires_idx on public.iuli_snapshots (integration_id, expires_at);

-- Mesmo padrão de tmb_sales: só leitura pra membros; escrita só pela edge
-- function (service role).
alter table public.iuli_snapshots enable row level security;
drop policy if exists "iuli_snapshots_select_member" on public.iuli_snapshots;
create policy "iuli_snapshots_select_member"
  on public.iuli_snapshots for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------
-- Cron: a cada 15 min chama sync-iuli pra cada integração IULI ativa.
-- Usa os mesmos segredos do Vault do farol-daily-sync.
-- ---------------------------------------------------------------------------
create or replace function public.trigger_iuli_sync()
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
    raise notice 'trigger_iuli_sync: faltando segredo no Vault (farol_internal_token ou edge_functions_base_url) — abortando.';
    return;
  end if;

  for v_row in
    select id
    from public.integrations
    where provider = 'iuli'
      and status <> 'disconnected'
      and sync_enabled = true
  loop
    perform net.http_post(
      url := v_function_base_url || '/functions/v1/sync-iuli',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_internal_token,
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object('integration_id', v_row.id),
      timeout_milliseconds := 150000
    );
  end loop;
end;
$$;

select cron.unschedule('farol-iuli-sync')
where exists (select 1 from cron.job where jobname = 'farol-iuli-sync');

select cron.schedule(
  'farol-iuli-sync',
  '*/15 * * * *',
  $$ select public.trigger_iuli_sync(); $$
);
