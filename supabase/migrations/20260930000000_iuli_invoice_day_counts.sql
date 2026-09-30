-- IULI — notas fiscais em dias de emissão em lote.
--
-- list_invoices não pagina e devolve no máximo 100 notas por consulta; o
-- filtro de data só aceita o dia inteiro (a hora é ignorada). Em dias de lote
-- (ex: 255 notas em 18s em 21/10/2025) só dá pra baixar 100 notas. Mas a mesma
-- resposta traz por_status — a contagem EXATA por status daquele dia.
--
-- Então, nesses dias, sync-iuli-records guarda a contagem exata aqui e busca
-- à parte as notas não autorizadas (negadas, canceladas…), que são as que
-- importam item a item (motivo da rejeição). As telas contam as notas por esta
-- tabela nos dias de lote e pelos itens nos demais (iuli_invoices_daily_v).

create table if not exists public.iuli_invoice_day_counts (
  integration_id uuid not null references public.integrations(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  dia date not null,
  status text not null,
  qtd integer not null,
  synced_at timestamptz not null default now(),
  primary key (integration_id, dia, status)
);

alter table public.iuli_invoice_day_counts enable row level security;
drop policy if exists "iuli_invoice_day_counts_select_member" on public.iuli_invoice_day_counts;
create policy "iuli_invoice_day_counts_select_member" on public.iuli_invoice_day_counts for select to authenticated
  using (public.is_workspace_member(workspace_id));

-- Notas por dia × status: contagem exata nos dias de lote, itens nos demais.
create or replace view public.iuli_invoices_daily_v with (security_invoker = true) as
select c.integration_id, c.workspace_id, c.dia, c.status, c.qtd::bigint as qtd, null::numeric as total
from public.iuli_invoice_day_counts c
union all
select v.integration_id, v.workspace_id, v.dia, v.status, count(*), sum(v.valor)
from public.iuli_invoices_v v
where not exists (
  select 1 from public.iuli_invoice_day_counts c where c.integration_id = v.integration_id and c.dia = v.dia
)
group by v.integration_id, v.workspace_id, v.dia, v.status;

grant select on public.iuli_invoices_daily_v to authenticated;

-- Agregação das notas passa a usar a visão diária (contagem exata).
-- total = soma do valor das notas baixadas; nos dias de lote o valor das
-- autorizadas não vem (só a contagem), então total é parcial.
create or replace function public.iuli_invoices_agg(
  p_workspace_id uuid,
  p_integration_ids uuid[] default null,
  p_from date default null,
  p_to date default null,
  p_grain text default 'none',
  p_status text[] default null
)
returns table (bucket date, status text, qtd bigint, total numeric)
language sql
stable
set search_path = public
as $$
  select public.iuli_bucket(v.dia, p_grain), v.status, sum(v.qtd)::bigint, coalesce(sum(v.total), 0)
  from public.iuli_invoices_daily_v v
  where v.workspace_id = p_workspace_id
    and (p_integration_ids is null or v.integration_id = any(p_integration_ids))
    and (p_from is null or v.dia >= p_from)
    and (p_to is null or v.dia <= p_to)
    and (p_status is null or v.status = any(p_status))
  group by 1, 2;
$$;

-- Conferência passa a incluir as notas (quantidade por mês de criação).
create or replace function public.iuli_consistency(p_integration_id uuid)
returns table (scope text, period text, iuli_value numeric, local_value numeric, iuli_count integer, local_count integer)
language sql
stable
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
  ),
  inv_snap as (
    select substr(s.key, 16) as ym,
           (select coalesce(sum((e->>'qtd')::int), 0) from jsonb_array_elements(s.payload->'por_status') e) as qtd
    from iuli_snapshots s
    where s.integration_id = p_integration_id and s.key like 'invoices_month:%' and s.payload is not null
  ),
  inv_local as (
    select to_char(dia, 'YYYY-MM') as ym, sum(qtd)::int as qtd
    from iuli_invoices_daily_v
    where integration_id = p_integration_id
    group by 1
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
  where abs(o.aberto - (select coalesce(sum(valor), 0) from iuli_receivables where integration_id = p_integration_id and removed_at is null and status <> 'recebida')) > 1
  union all
  select 'invoices', i.ym, i.qtd, coalesce(l.qtd, 0), i.qtd, coalesce(l.qtd, 0)
  from inv_snap i left join inv_local l using (ym)
  where i.qtd <> coalesce(l.qtd, 0);
$$;

grant execute on function public.iuli_invoices_agg(uuid, uuid[], date, date, text, text[]) to authenticated;
grant execute on function public.iuli_consistency(uuid) to authenticated, service_role;
