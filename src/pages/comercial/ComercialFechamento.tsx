import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SOURCES } from "@/lib/commercialSources";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { useHubspotOwners } from "@/lib/hubspotMeta";
import { cn } from "@/lib/utils";
import {
  addMonths,
  dayLabelLong,
  formatBRL,
  formatBRLShort,
  formatInt,
  formatPct,
  monthEndISO,
  monthLabel,
  monthsBetween,
  monthStartISO,
  NO_OWNER,
  periodEndISO,
  periodLabel,
  periodStartISO,
  sumBy,
  useClosingRange,
  useCommercialFilters,
  useSalesPipelines,
  ownerDisplay,
} from "@/lib/commercial";
import {
  AttributionToggle,
  CommercialShell,
  EmptyState,
  FilterBar,
  Heatmap,
  LoadingBlock,
  Panel,
  PeriodSelect,
  PipelineSelect,
} from "@/components/commercial/CommercialUI";

type Metric = "amount" | "count";

export default function ComercialFechamento() {
  const { workspace } = useWorkspace();
  const owners = useHubspotOwners(workspace?.id);
  const navigate = useNavigate();
  const location = useLocation();
  const { filters, setFilters } = useCommercialFilters();
  const { fromDay, toDay } = filters;
  const dayMode = !!(fromDay && toDay);
  const periodDescription = dayMode ? `${dayLabelLong(fromDay!)} a ${dayLabelLong(toDay!)}` : periodLabel(filters.from, filters.to);
  const [metric, setMetric] = useState<Metric>("amount");

  // Um mês só não dá mapa de calor — mostra os 6 meses até ele.
  const from = filters.from === filters.to ? addMonths(filters.to, -5) : filters.from;
  const to = filters.to;
  const months = monthsBetween(from, to);

  const pipelines = useSalesPipelines(workspace?.id);
  // Usa o recorte exato (dia ou mês) pra puxar só os negócios do período escolhido;
  // o agrupamento em colunas continua por mês (o dado bruto já vem com o mês do fechamento).
  const closingStartISO = dayMode ? periodStartISO(filters) : monthStartISO(from);
  const closingEndISO = dayMode ? periodEndISO(filters) : monthEndISO(to);
  const closing = useClosingRange(workspace?.id, closingStartISO, closingEndISO, filters);

  const heatRows = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const r of closing.data ?? []) {
      const idx = months.indexOf(r.month);
      if (idx < 0) continue;
      const values = map.get(r.owner_id) ?? months.map(() => 0);
      values[idx] += metric === "amount" ? r.won_amount : r.won_count;
      map.set(r.owner_id, values);
    }
    return [...map.entries()]
      .map(([id, values]) => ({ id, name: ownerDisplay(owners, id), values, total: values.reduce((a, b) => a + b, 0), warn: id === NO_OWNER }))
      .filter((r) => r.total > 0)
      .sort((a, b) => Number(a.warn) - Number(b.warn) || b.total - a.total);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing.data, metric, owners, from, to]);

  const monthly = useMemo(
    () =>
      months.map((m) => {
        const rs = (closing.data ?? []).filter((r) => r.month === m);
        const won = sumBy(rs, (r) => r.won_count);
        const lost = sumBy(rs, (r) => r.lost_count);
        const amount = sumBy(rs, (r) => r.won_amount);
        return { month: m, label: monthLabel(m), won, lost, amount, conv: won + lost ? won / (won + lost) : null, ticket: won ? amount / won : null };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [closing.data, from, to],
  );

  const format = metric === "amount" ? (v: number) => formatBRLShort(v).replace("R$ ", "") : formatInt;

  const openSeller = (ownerId: string) => {
    const params = new URLSearchParams(location.search);
    params.set("vendedor", ownerId);
    navigate({ pathname: "/comercial/vendedor", search: `?${params.toString()}` });
  };

  return (
    <CommercialShell
      title="Fechamento Mensal"
      description={`${periodDescription} · negócios fechados pela data de fechamento`}
      filters={
        <FilterBar>
          <PeriodSelect from={filters.from} to={filters.to} fromDay={fromDay} toDay={toDay} onChange={(patch) => setFilters(patch)} allowDayPicker />
          <PipelineSelect pipelines={pipelines.data ?? []} selected={filters.pipelines} onChange={(v) => setFilters({ pipelines: v })} />
          <AttributionToggle value={filters.attribution} onChange={(v) => setFilters({ attribution: v })} />
        </FilterBar>
      }
    >
      <Panel
        title="Vendedor × mês"
        info={SOURCES.heatmap(filters.attribution)}
        action={
          <div role="group" aria-label="Métrica" className="flex rounded-md border border-input bg-background p-1">
            {(["amount", "count"] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={metric === m}
                onClick={() => setMetric(m)}
                className={cn("rounded px-3 py-1.5 text-sm font-medium", metric === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {m === "amount" ? "Valor ganho" : "Nº de ganhos"}
              </button>
            ))}
          </div>
        }
      >
        {closing.isLoading ? (
          <LoadingBlock className="h-72" />
        ) : heatRows.length === 0 ? (
          <EmptyState>Nenhum negócio ganho no período.</EmptyState>
        ) : (
          <>
            <Heatmap rows={heatRows} months={months} format={format} onRowClick={openSeller} />
            <p className="text-xs text-muted-foreground">
              {metric === "amount" ? "Valores em R$ (mil / mi)." : "Quantidade de negócios ganhos."} Clique no nome para abrir a ficha do vendedor.
            </p>
          </>
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Panel title="Evolução" info={SOURCES.closingMonthly(filters.attribution)} className="xl:col-span-3">
          {closing.isLoading ? (
            <LoadingBlock className="h-64" />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={monthly} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis yAxisId="v" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} width={64} tickFormatter={(v: number) => formatBRLShort(v).replace("R$ ", "")} />
                  <YAxis yAxisId="n" orientation="right" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} width={36} allowDecimals={false} />
                  <Tooltip
                    formatter={(v: number, name: string) => [name === "Valor ganho" ? formatBRL(v) : formatInt(v), name]}
                    cursor={{ fill: "hsl(var(--muted))" }}
                    contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar yAxisId="v" dataKey="amount" name="Valor ganho" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} maxBarSize={56} />
                  <Line yAxisId="n" dataKey="won" name="Ganhos" stroke="#0369a1" strokeWidth={2} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        <Panel title="Mês a mês" info={SOURCES.closingMonthly(filters.attribution)} className="xl:col-span-2">
          {closing.isLoading ? (
            <LoadingBlock />
          ) : (
            <div className="-mx-4 overflow-x-auto md:mx-0">
              <table className="w-full min-w-[440px] text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-4 py-2 font-medium md:pl-0">Mês</th>
                    <th className="px-3 py-2 text-right font-medium">Ganhos</th>
                    <th className="px-3 py-2 text-right font-medium">Valor</th>
                    <th className="px-3 py-2 text-right font-medium">Perdidos</th>
                    <th className="px-4 py-2 text-right font-medium md:pr-0">Conv.</th>
                  </tr>
                </thead>
                <tbody>
                  {[...monthly].reverse().map((m) => (
                    <tr key={m.month} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-2.5 font-medium md:pl-0">{monthLabel(m.month, true)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatInt(m.won)}</td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{formatBRLShort(m.amount)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatInt(m.lost)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums md:pr-0">{formatPct(m.conv, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </CommercialShell>
  );
}
