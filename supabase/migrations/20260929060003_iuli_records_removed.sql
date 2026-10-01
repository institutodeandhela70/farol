-- IULI — registro que sumiu da IULI (apagado lá) não é apagado aqui: ganha
-- removed_at e sai das telas. Se reaparecer numa leitura seguinte, o upsert
-- zera removed_at. Assim um erro de paginação da IULI nunca faz o Farol perder
-- dado de vez.
--
-- Quem marca: sync-iuli-records, ao fim da releitura completa mensal e das
-- releituras pontuais (títulos que saíram da lista "sem baixa", meses que não
-- bateram com os totais da IULI).

alter table public.iuli_sales add column if not exists removed_at timestamptz;
alter table public.iuli_receivables add column if not exists removed_at timestamptz;
alter table public.iuli_invoices add column if not exists removed_at timestamptz;
alter table public.iuli_subscriptions add column if not exists removed_at timestamptz;

-- A varredura diária dos "sem baixa" precisa achar rápido os que eram pendentes.
create index if not exists iuli_receivables_pending_idx
  on public.iuli_receivables (integration_id, synced_at)
  where status <> 'recebida' and removed_at is null;

-- ---------------------------------------------------------------------------
-- Conferência: base local × totais oficiais da IULI (iuli_snapshots).
--
-- Vendas: quantidade e valor por mês de competência (a IULI fecha o mês em
-- UTC — conferido em 29/09/2026: com UTC os 13 meses batem centavo a centavo).
-- Títulos: recebido e sem baixa por mês de vencimento, e o total sem baixa.
--
-- Devolve só o que diverge; sync-iuli-records usa isso pra reler o pedaço
-- divergente e o dashboard pra avisar.
-- ---------------------------------------------------------------------------
create or replace function public.iuli_consistency(p_integration_id uuid)
returns table (scope text, period text, iuli_value numeric, local_value numeric, iuli_count integer, local_count integer)
language sql
stable
-- security invoker (padrão): o RLS de iuli_snapshots/iuli_* limita cada
-- usuário ao próprio workspace; a edge function chama com service role.
set search_path = public
as $$
  with sales_snap as (
    select substr(s.key, 20) as ym,
           (select coalesce(sum((e->>'qtd')::int), 0) from jsonb_array_elements(s.payload->'por_status') e) as qtd,
           (select coalesce(sum((e->>'total')::numeric), 0) from jsonb_array_elements(s.payload->'por_status') e) as total
    from iuli_snapshots s
    where s.integration_id = p_integration_id and s.key like 'sales_status_month:%' and s.payload is not null
  ),
  sales_local as (
    select to_char(competencia at time zone 'UTC', 'YYYY-MM') as ym, count(*)::int as qtd, coalesce(sum(valor_total), 0) as total
    from iuli_sales
    where integration_id = p_integration_id and removed_at is null
    group by 1
  ),
  ar_snap as (
    select substr(s.key, 10) as ym,
           coalesce((s.payload->>'total_recebidas')::numeric, 0) as recebido,
           coalesce((s.payload->>'total_a_receber')::numeric, 0) as aberto
    from iuli_snapshots s
    where s.integration_id = p_integration_id and s.key like 'ar_month:%' and s.payload is not null
  ),
  ar_local as (
    select to_char(due_date, 'YYYY-MM') as ym,
           coalesce(sum(valor_pago) filter (where status = 'recebida'), 0) as recebido,
           coalesce(sum(valor) filter (where status <> 'recebida'), 0) as aberto
    from iuli_receivables
    where integration_id = p_integration_id and removed_at is null
    group by 1
  ),
  overview as (
    select coalesce((payload->>'total_a_receber')::numeric, 0) as aberto, coalesce((payload->>'quantidade')::int, 0) as qtd
    from iuli_snapshots
    where integration_id = p_integration_id and key = 'ar:overview' and payload is not null
  )
  select 'sales', ss.ym, ss.total, coalesce(sl.total, 0), ss.qtd, coalesce(sl.qtd, 0)
  from sales_snap ss left join sales_local sl using (ym)
  where ss.qtd <> coalesce(sl.qtd, 0) or abs(ss.total - coalesce(sl.total, 0)) > 1
  union all
  select 'receivables_received', a.ym, a.recebido, coalesce(l.recebido, 0), null, null
  from ar_snap a left join ar_local l using (ym)
  where abs(a.recebido - coalesce(l.recebido, 0)) > 1
  union all
  select 'receivables_open', a.ym, a.aberto, coalesce(l.aberto, 0), null, null
  from ar_snap a left join ar_local l using (ym)
  where abs(a.aberto - coalesce(l.aberto, 0)) > 1
  union all
  select 'receivables_open_total', 'total', o.aberto,
         (select coalesce(sum(valor), 0) from iuli_receivables where integration_id = p_integration_id and removed_at is null and status <> 'recebida'),
         o.qtd,
         (select count(*)::int from iuli_receivables where integration_id = p_integration_id and removed_at is null and status <> 'recebida')
  from overview o
  where abs(o.aberto - (select coalesce(sum(valor), 0) from iuli_receivables where integration_id = p_integration_id and removed_at is null and status <> 'recebida')) > 1;
$$;

revoke all on function public.iuli_consistency(uuid) from public, anon;
grant execute on function public.iuli_consistency(uuid) to authenticated, service_role;
