import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SOURCES, type DataSource } from "@/lib/commercialSources";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { useHubspotOwners, useHubspotPipelines } from "@/lib/hubspotMeta";
import {
  addMonths,
  currentYM,
  dayEndISO,
  dayStartISO,
  formatBRL,
  formatBRLShort,
  formatInt,
  formatPct,
  monthEndISO,
  monthLabel,
  monthStartISO,
  monthsBetween,
  NO_OWNER,
  sumBy,
  useCommercialFilters,
  useCustomers,
  useOpenPipeline,
  useSalesPipelines,
  type OpenPipelineRow,
  ownerDisplay,
  ownerOptions,
} from "@/lib/commercial";
import {
  AttributionToggle,
  CommercialShell,
  CustomerTable,
  EmptyState,
  FilterBar,
  KpiCard,
  LoadingBlock,
  OwnerSelect,
  Panel,
  PeriodSelect,
  PipelineSelect,
  ProgressBar,
} from "@/components/commercial/CommercialUI";

interface Agg {
  key: string;
  label: string;
  count: number;
  amount: number;
  weighted: number;
  withoutAmount: number;
  overdue: number;
}

function aggregate(rows: OpenPipelineRow[], keyOf: (r: OpenPipelineRow) => string, labelOf: (k: string) => string, nowYM: string): Agg[] {
  const map = new Map<string, Agg>();
  for (const r of rows) {
    const key = keyOf(r);
    const cur = map.get(key) ?? { key, label: labelOf(key), count: 0, amount: 0, weighted: 0, withoutAmount: 0, overdue: 0 };
    cur.count += r.open_count;
    cur.amount += r.open_amount;
    cur.weighted += r.weighted_amount;
    cur.withoutAmount += r.without_amount_count;
    if (r.close_month && r.close_month < nowYM) cur.overdue += r.open_count;
    map.set(key, cur);
  }
  return [...map.values()];
}

export default function ComercialPipeline() {
  const { workspace } = useWorkspace();
  const owners = useHubspotOwners(workspace?.id);
  const { pipelines: pipelineMeta, pipelineLabel } = useHubspotPipelines(workspace?.id);
  const { filters, setFilters } = useCommercialFilters();
  const { from, to, fromDay, toDay } = filters;
  const dayMode = !!(fromDay && toDay);
  const customerStartISO = dayMode ? dayStartISO(fromDay!) : monthStartISO(from);
  const customerEndISO = dayMode ? dayEndISO(toDay!) : monthEndISO(to);
  const sales = useSalesPipelines(workspace?.id);
  const open = useOpenPipeline(workspace?.id, filters);
  const customers = useCustomers(workspace?.id, customerStartISO, customerEndISO, filters);
  const customerRows = (customers.data ?? []).filter((r) => !filters.owner || r.owner_id === filters.owner);
  const nowYM = currentYM();

  const rows = useMemo(() => (open.data ?? []).filter((r) => !filters.owner || r.owner_id === filters.owner), [open.data, filters.owner]);

  const byPipeline = useMemo(
    () => aggregate(rows, (r) => r.pipeline_id, (k) => pipelineLabel(k) ?? k, nowYM).sort((a, b) => b.weighted - a.weighted || b.count - a.count),
    [rows, pipelineLabel, nowYM],
  );

  const [funnelPipeline, setFunnelPipeline] = useState<string | null>(null);
  const selectedPipeline = funnelPipeline && byPipeline.some((p) => p.key === funnelPipeline) ? funnelPipeline : byPipeline[0]?.key ?? null;

  const funnel = useMemo(() => {
    if (!selectedPipeline) return [];
    const stages = pipelineMeta.find((p) => p.id === selectedPipeline)?.stages ?? [];
    const agg = aggregate(rows.filter((r) => r.pipeline_id === selectedPipeline), (r) => r.stage_id, (k) => k, nowYM);
    const byStage = new Map(agg.map((a) => [a.key, a]));
    const ordered = stages.filter((s) => byStage.has(s.id)).map((s) => ({ ...byStage.get(s.id)!, label: s.label }));
    const unknown = agg.filter((a) => !stages.some((s) => s.id === a.key));
    return [...ordered, ...unknown];
  }, [selectedPipeline, pipelineMeta, rows, nowYM]);

  const bySeller = useMemo(
    () => aggregate(rows, (r) => r.owner_id, (k) => ownerDisplay(owners, k), nowYM).sort((a, b) => b.weighted - a.weighted || b.count - a.count),
    [rows, owners, nowYM],
  );

  const forecast = useMemo(() => {
    const months = monthsBetween(nowYM, addMonths(nowYM, 5));
    const bucket = (label: string, filter: (r: OpenPipelineRow) => boolean) => {
      const rs = rows.filter(filter);
      return { label, Ponderado: sumBy(rs, (r) => r.weighted_amount), "Em aberto": sumBy(rs, (r) => r.open_amount), negocios: sumBy(rs, (r) => r.open_count) };
    };
    return [
      bucket("Vencidas", (r) => !!r.close_month && r.close_month < nowYM),
      ...months.map((m) => bucket(monthLabel(m), (r) => r.close_month === m)),
      bucket("Depois", (r) => !!r.close_month && r.close_month > months[months.length - 1]),
      bucket("Sem data", (r) => !r.close_month),
    ];
  }, [rows, nowYM]);

  const total = {
    count: sumBy(rows, (r) => r.open_count),
    amount: sumBy(rows, (r) => r.open_amount),
    weighted: sumBy(rows, (r) => r.weighted_amount),
    withoutAmount: sumBy(rows, (r) => r.without_amount_count),
  };
  const overdue = rows.filter((r) => r.close_month && r.close_month < nowYM);
  const nextMonth = rows.filter((r) => r.close_month === nowYM);
  const maxFunnel = Math.max(1, ...funnel.map((f) => f.count));

  return (
    <CommercialShell
      title="Pipeline & Previsão"
      description="Negócios em aberto hoje · previsão ponderada = valor × probabilidade da etapa"
      filters={
        <FilterBar>
          <OwnerSelect value={filters.owner} owners={ownerOptions(owners, (open.data ?? []).map((r) => r.owner_id))} onChange={(v) => setFilters({ owner: v })} />
          <PipelineSelect pipelines={sales.data ?? []} selected={filters.pipelines} onChange={(v) => setFilters({ pipelines: v })} />
          <AttributionToggle value={filters.attribution} onChange={(v) => setFilters({ attribution: v })} />
          <PeriodSelect from={from} to={to} fromDay={fromDay} toDay={toDay} onChange={(patch) => setFilters(patch)} allowDayPicker />
        </FilterBar>
      }
    >
      <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard info={SOURCES.openCount(filters.attribution)} label="Negócios em aberto" value={formatInt(total.count)} loading={open.isLoading} />
        <KpiCard info={SOURCES.openAmount(filters.attribution)} label="Valor em aberto" value={formatBRLShort(total.amount)} loading={open.isLoading} />
        <KpiCard info={SOURCES.weighted(filters.attribution)} label="Previsão ponderada" value={formatBRLShort(total.weighted)} sub={`${formatBRLShort(sumBy(nextMonth, (r) => r.weighted_amount))} previstos para ${monthLabel(nowYM)}`} loading={open.isLoading} />
        <KpiCard
          info={SOURCES.withoutAmount()}
          label="Sem valor preenchido"
          value={formatPct(total.count ? total.withoutAmount / total.count : null)}
          sub={`${formatInt(total.withoutAmount)} negócios`}
          tone={total.count && total.withoutAmount / total.count > 0.3 ? "warn" : "default"}
          loading={open.isLoading}
        />
        <div className="col-span-2 lg:col-span-1">
          <KpiCard
            info={SOURCES.overdue()}
            label="Previsão vencida"
            value={formatInt(sumBy(overdue, (r) => r.open_count))}
            sub={`${formatBRLShort(sumBy(overdue, (r) => r.open_amount))} com data já passada`}
            tone={overdue.length ? "warn" : "default"}
            loading={open.isLoading}
          />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Panel
          title="Funil por etapa"
          info={SOURCES.funnel(filters.attribution)}
          className="xl:col-span-2"
          action={
            <select
              aria-label="Pipeline do funil"
              value={selectedPipeline ?? ""}
              onChange={(e) => setFunnelPipeline(e.target.value)}
              className="h-9 max-w-[14rem] rounded-md border border-input bg-background px-2 text-sm"
            >
              {byPipeline.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          }
        >
          {open.isLoading ? (
            <LoadingBlock />
          ) : funnel.length === 0 ? (
            <EmptyState>Nenhum negócio em aberto.</EmptyState>
          ) : (
            <ul className="flex flex-col gap-3">
              {funnel.map((f) => (
                <li key={f.key} className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="truncate font-medium">{f.label}</span>
                    <span className="whitespace-nowrap tabular-nums text-muted-foreground">
                      <strong className="text-foreground">{formatInt(f.count)}</strong> · {formatBRLShort(f.amount)}
                    </span>
                  </div>
                  <ProgressBar ratio={f.count / maxFunnel} />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Previsão por mês de fechamento" info={SOURCES.forecastByMonth(filters.attribution)} className="xl:col-span-3" action={<span className="text-sm text-muted-foreground">pela data prevista de fechamento</span>}>
          {open.isLoading ? (
            <LoadingBlock className="h-64" />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={forecast} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} interval={0} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} width={64} tickFormatter={(v: number) => formatBRLShort(v).replace("R$ ", "")} />
                  <Tooltip
                    formatter={(v: number, name: string) => [formatBRL(v), name]}
                    cursor={{ fill: "hsl(var(--muted))" }}
                    contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Em aberto" fill="hsl(var(--primary) / 0.3)" radius={[4, 4, 0, 0]} maxBarSize={40} />
                  <Bar dataKey="Ponderado" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <AggTable info={SOURCES.openTable(filters.attribution)} title="Por pipeline" firstCol="Pipeline" rows={byPipeline} loading={open.isLoading} />
        <AggTable info={SOURCES.openTable(filters.attribution)} title="Por vendedor" firstCol="Vendedor" rows={bySeller} loading={open.isLoading} warnKey={NO_OWNER} />
      </div>

      <Panel
        title="Visão por cliente"
        info={SOURCES.openTable(filters.attribution)}
        action={
          <span className="text-sm text-muted-foreground">
            Negócios ganhos no período do filtro "Período" acima · não conta o pipeline em aberto
          </span>
        }
      >
        <CustomerTable rows={customerRows} loading={customers.isLoading} ownerName={(id) => ownerDisplay(owners, id)} />
      </Panel>
    </CommercialShell>
  );
}

function AggTable({ title, info, firstCol, rows, loading, warnKey }: { title: string; info: DataSource; firstCol: string; rows: Agg[]; loading: boolean; warnKey?: string }) {
  return (
    <Panel title={title} info={info}>
      {loading ? (
        <LoadingBlock />
      ) : rows.length === 0 ? (
        <EmptyState>Nenhum negócio em aberto.</EmptyState>
      ) : (
        <div className="-mx-4 overflow-x-auto md:mx-0">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-4 py-2 font-medium md:pl-0">{firstCol}</th>
                <th className="px-3 py-2 text-right font-medium">Negócios</th>
                <th className="px-3 py-2 text-right font-medium">Em aberto</th>
                <th className="px-3 py-2 text-right font-medium">Ponderado</th>
                <th className="px-3 py-2 text-right font-medium">Sem valor</th>
                <th className="px-4 py-2 text-right font-medium md:pr-0">Vencidos</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 15).map((r) => (
                <tr key={r.key} className="border-b border-border/60 last:border-0">
                  <td className={`px-4 py-2.5 font-medium md:pl-0 ${r.key === warnKey ? "text-amber-700 dark:text-amber-400" : ""}`}>{r.label}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatInt(r.count)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatBRLShort(r.amount)}</td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-primary">{formatBRLShort(r.weighted)}</td>
                  <td className={`px-3 py-2.5 text-right tabular-nums ${r.count && r.withoutAmount / r.count > 0.5 ? "text-amber-700 dark:text-amber-400" : ""}`}>{formatInt(r.withoutAmount)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums md:pr-0">{formatInt(r.overdue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
