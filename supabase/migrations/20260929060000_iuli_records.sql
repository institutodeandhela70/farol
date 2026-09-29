-- IULI — registros um a um (Fase A dos filtros do Dashboard Financeiro).
--
-- Os snapshots (iuli_snapshots) só têm totais de períodos fixos. Pra filtrar
-- por qualquer período, cliente, status e produto, o Farol guarda cada venda,
-- título a receber, nota fiscal e assinatura da IULI, e agrega no banco.
--
-- Quem preenche é a edge function sync-iuli-records, em "passos" de uma página
-- por vez (a IULI é lenta e limita volume), guardando o progresso em
-- iuli_sync_state — a carga inicial leva ~1h espalhada em várias execuções.
--
-- CPF/CNPJ não são guardados: o filtro de cliente é pelo nome.

create table if not exists public.iuli_sales (
  integration_id uuid not null references public.integrations(id) on delete cascade,
  iuli_id bigint not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  status text,
  valor_total numeric(14, 2),
  valor_liquido numeric(14, 2),
  competencia timestamptz,
  pagamento timestamptz,
  external_id text,
  venda_mae_id bigint,
  nfe_status integer,
  cliente text,
  descricao text,
  synced_at timestamptz not null default now(),
  primary key (integration_id, iuli_id)
);
create index if not exists iuli_sales_ws_competencia_idx on public.iuli_sales (workspace_id, competencia);
create index if not exists iuli_sales_ws_external_idx on public.iuli_sales (workspace_id, external_id);

create table if not exists public.iuli_receivables (
  integration_id uuid not null references public.integrations(id) on delete cascade,
  iuli_id bigint not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  description text,
  status text,
  due_date date,
  competencia date,
  pagamento date,
  valor numeric(14, 2),
  valor_pago numeric(14, 2),
  juros numeric(14, 2),
  empresa text,
  nf_numero text,
  qtd_anexos integer,
  tipos_anexo text[],
  tem_anexo boolean,
  tem_boleto boolean,
  tem_comprovante boolean,
  tem_nf boolean,
  synced_at timestamptz not null default now(),
  primary key (integration_id, iuli_id)
);
create index if not exists iuli_receivables_ws_due_idx on public.iuli_receivables (workspace_id, due_date);
create index if not exists iuli_receivables_ws_pagamento_idx on public.iuli_receivables (workspace_id, pagamento);

create table if not exists public.iuli_invoices (
  integration_id uuid not null references public.integrations(id) on delete cascade,
  iuli_id bigint not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  numero text,
  serie text,
  valor numeric(14, 2),
  status text,
  detalhe_status text,
  venda_id bigint,
  lancamento_id bigint,
  invoice_type integer,
  criada_em timestamptz,
  atualizada_em timestamptz,
  synced_at timestamptz not null default now(),
  primary key (integration_id, iuli_id)
);
create index if not exists iuli_invoices_ws_criada_idx on public.iuli_invoices (workspace_id, criada_em);

create table if not exists public.iuli_subscriptions (
  integration_id uuid not null references public.integrations(id) on delete cascade,
  iuli_id bigint not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  status text,
  ciclo text,
  valor numeric(14, 2),
  valor_mensalizado numeric(14, 2),
  forma_pagamento text,
  origem text,
  criada_em timestamptz,
  proximo_vencimento timestamptz,
  fim timestamptz,
  external_id text,
  cliente text,
  produto text,
  synced_at timestamptz not null default now(),
  primary key (integration_id, iuli_id)
);
create index if not exists iuli_subscriptions_ws_criada_idx on public.iuli_subscriptions (workspace_id, criada_em);

-- Progresso de cada varredura: uma linha por (integração, tarefa).
-- cursor = offset da próxima página ou início da próxima janela de datas.
create table if not exists public.iuli_sync_state (
  integration_id uuid not null references public.integrations(id) on delete cascade,
  task text not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  cursor jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  next_run_at timestamptz not null default now(),
  total_expected integer,
  rows_synced integer not null default 0,
  last_error text,
  updated_at timestamptz not null default now(),
  primary key (integration_id, task)
);

-- Mesmo padrão dos outros dados de integração: leitura pra membros do
-- workspace, escrita só pela edge function (service role).
alter table public.iuli_sales enable row level security;
alter table public.iuli_receivables enable row level security;
alter table public.iuli_invoices enable row level security;
alter table public.iuli_subscriptions enable row level security;
alter table public.iuli_sync_state enable row level security;

drop policy if exists "iuli_sales_select_member" on public.iuli_sales;
create policy "iuli_sales_select_member" on public.iuli_sales for select to authenticated
  using (public.is_workspace_member(workspace_id));
drop policy if exists "iuli_receivables_select_member" on public.iuli_receivables;
create policy "iuli_receivables_select_member" on public.iuli_receivables for select to authenticated
  using (public.is_workspace_member(workspace_id));
drop policy if exists "iuli_invoices_select_member" on public.iuli_invoices;
create policy "iuli_invoices_select_member" on public.iuli_invoices for select to authenticated
  using (public.is_workspace_member(workspace_id));
drop policy if exists "iuli_subscriptions_select_member" on public.iuli_subscriptions;
create policy "iuli_subscriptions_select_member" on public.iuli_subscriptions for select to authenticated
  using (public.is_workspace_member(workspace_id));
drop policy if exists "iuli_sync_state_select_member" on public.iuli_sync_state;
create policy "iuli_sync_state_select_member" on public.iuli_sync_state for select to authenticated
  using (public.is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------
-- Cron: sync-iuli-records a cada 15 min, defasado do farol-iuli-sync (que roda
-- em :00/:15/:30/:45) — as duas funções dividem a mesma trava, então não
-- podem rodar juntas.
-- ---------------------------------------------------------------------------
create or replace function public.trigger_iuli_records_sync()
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
    raise notice 'trigger_iuli_records_sync: faltando segredo no Vault — abortando.';
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
      url := v_function_base_url || '/functions/v1/sync-iuli-records',
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

select cron.unschedule('farol-iuli-records-sync')
where exists (select 1 from cron.job where jobname = 'farol-iuli-records-sync');

select cron.schedule(
  'farol-iuli-records-sync',
  '7,22,37,52 * * * *',
  $$ select public.trigger_iuli_records_sync(); $$
);
