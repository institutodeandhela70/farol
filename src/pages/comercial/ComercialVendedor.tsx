import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SOURCES } from "@/lib/commercialSources";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { useHubspotOwners, useHubspotPipelines } from "@/lib/hubspotMeta";
import {
  addMonths,
  closingBySeller,
  formatBRL,
  formatBRLShort,
  formatInt,
  formatPct,
  goalsByOwner,
  monthLabel,
  monthsBetween,
  NO_OWNER,
  periodLabel,
  sumBy,
  useClosing,
  useCommercialFilters,
  useGoals,
  useMeetingsByConductor,
  useMeetingsByScheduler,
  useOpenPipeline,
  useSalesPipelines,
  ownerDisplay,
  ownerOptions,
} from "@/lib/commercial";
import {
  AttributionToggle,
  CommercialShell,
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

export default function ComercialVendedor() {
  const { workspace } = useWorkspace();
  const owners = useHubspotOwners(workspace?.id);
  const { pipelineLabel, stageLabel } = useHubspotPipelines(workspace?.id);
  const { filters, setFilters } = useCommercialFilters();
  const { from, to } = filters;
  const chartFrom = addMonths(to, -5) < from ? addMonths(to, -5) : from;

  const pipelines = useSalesPipelines(workspace?.id);
  const closing = useClosing(workspace?.id, chartFrom, to, filters);
  const conductor = useMeetingsByConductor(workspace?.id, filters);
  const scheduler = useMeetingsByScheduler(workspace?.id, filters, "created");
  const open = useOpenPipeline(workspace?.id, filters);
  const goals = useGoals(workspace?.id, from, to);

  // Sem vendedor escolhido: abre no que mais vendeu no período.
  const topSeller = useMemo(() => {
    const inPeriod = (closing.data ?? []).filter((r) => r.month >= from && r.month <= to);
    return closingBySeller(inPeriod).find((s) => s.owner_id !== NO_OWNER)?.owner_id ?? null;
  }, [closing.data, from, to]);
  const seller = filters.owner ?? topSeller;

  const candidates = ownerOptions(owners, [
    ...(closing.data ?? []).map((r) => r.owner_id),
    ...(conductor.data ?? []).map((r) => r.owner_id),
    ...(scheduler.data ?? []).flatMap((r) => (r.scheduler_owner_id ? [r.scheduler_owner_id] : [])),
    ...(goals.data ?? []).map((g) => g.owner_id),
  ]);

  const mine = useMemo(() => {
    const closingRows = (closing.data ?? []).filter((r) => r.owner_id === seller);
    const inPeriod = closingRows.filter((r) => r.month >= from && r.month <= to);
    const won = sumBy(inPeriod, (r) => r.won_count);
    const lost = sumBy(inPeriod, (r) => r.lost_count);
    const amount = sumBy(inPeriod, (r) => r.won_amount);
    const conducted = (conductor.data ?? []).find((r) => r.owner_id === seller);
    const scheduled = (scheduler.data ?? []).find((r) => r.scheduler_owner_id === seller);
    const openRows = (open.data ?? []).filter((r) => r.owner_id === seller);
    const goal = seller ? goalsByOwner(goals.data ?? []).get(seller) : undefined;

    const stageMap = new Map<string, { key: string; pipeline: string; stage: string; count: number; amount: number; weighted: number }>();
    for (const r of openRows) {
      const key = `${r.pipeline_id}|${r.stage_id}`;
      const cur = stageMap.get(key) ?? { key, pipeline: pipelineLabel(r.pipeline_id) ?? r.pipeline_id, stage: stageLabel(r.stage_id) ?? r.stage_id, count: 0, amount: 0, weighted: 0 };
      cur.count += r.open_count;
      cur.amount += r.open_amount;
      cur.weighted += r.weighted_amount;
      stageMap.set(key, cur);
    }

    return {
      won, lost, amount, conducted, scheduled, goal,
      openCount: sumBy(openRows, (r) => r.open_count),
      openAmount: sumBy(openRows, (r) => r.open_amount),
      weighted: sumBy(openRows, (r) => r.weighted_amount),
      stages: [...stageMap.values()].sort((a, b) => a.pipeline.localeCompare(b.pipeline) || b.count - a.count),
      chart: monthsBetween(addMonths(to, -5), to).map((m) => ({
        month: m,
        label: monthLabel(m),
        valor: sumBy(closingRows.filter((r) => r.month === m), (r) => r.won_amount),
        inPeriod: m >= from && m <= to,
      })),
    };
  }, [seller, closing.data, conductor.data, scheduler.data, open.data, goals.data, from, to, pipelineLabel, stageLabel]);

  const loading = closing.isLoading || conductor.isLoading;
  const g = mine.goal;

  return (
    <CommercialShell
      title={seller ? ownerDisplay(owners, seller) : "Ficha do Vendedor"}
      description={`${periodLabel(from, to)} · ficha individual para 1:1`}
      filters={
        <FilterBar>
          <OwnerSelect value={seller} owners={candidates} onChange={(v) => setFilters({ owner: v })} allowAll={false} placeholder="Escolha um vendedor" />
          <PeriodSelect from={from} to={to} onChange={(f, t) => setFilters({ from: f, to: t })} />
          <PipelineSelect pipelines={pipelines.data ?? []} selected={filters.pipelines} onChange={(v) => setFilters({ pipelines: v })} />
          <AttributionToggle value={filters.attribution} onChange={(v) => setFilters({ attribution: v })} />
        </FilterBar>
      }
    >
      {!seller && !loading ? (
        <Panel>
          <EmptyState>Escolha um vendedor para ver a ficha.</EmptyState>
        </Panel>
      ) : (
        <>
          <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <KpiCard
              info={SOURCES.revenue(filters.attribution)}
              label="Receita fechada"
              value={formatBRLShort(mine.amount)}
              sub={g?.revenue ? `${formatPct(mine.amount / g.revenue)} da meta de ${formatBRLShort(g.revenue)}` : "sem meta cadastrada"}
              loading={loading}
            />
            <KpiCard
              info={SOURCES.wonDeals(filters.attribution)}
              label="Negócios ganhos"
              value={formatInt(mine.won)}
              sub={`${formatInt(mine.lost)} perdidos · conv. ${formatPct(mine.won + mine.lost ? mine.won / (mine.won + mine.lost) : null)}`}
              loading={loading}
            />
            <KpiCard
              info={SOURCES.sellerMeetings()}
              label="Reuniões conduzidas"
              value={formatInt(mine.conducted?.past_count ?? 0)}
              sub={g?.held ? `${formatPct((mine.conducted?.past_count ?? 0) / g.held)} da meta de ${formatInt(g.held)}` : `${formatInt(mine.conducted?.upcoming_count ?? 0)} ainda por vir`}
              loading={loading}
            />
            <KpiCard
              info={SOURCES.sellerScheduled()}
              label="Agendou (como SDR)"
              value={formatInt(mine.scheduled?.total_count ?? 0)}
              sub={g?.scheduled ? `${formatPct((mine.scheduled?.total_count ?? 0) / g.scheduled)} da meta de ${formatInt(g.scheduled)}` : `${formatInt(mine.scheduled?.for_others_count ?? 0)} para outros`}
              loading={scheduler.isLoading}
            />
            <div className="col-span-2 lg:col-span-1">
              <KpiCard info={SOURCES.weighted(filters.attribution)} label="Pipeline ponderado" value={formatBRLShort(mine.weighted)} sub={`${formatInt(mine.openCount)} negócios · ${formatBRLShort(mine.openAmount)} em aberto`} loading={open.isLoading} />
            </div>
          </section>

          {g && (g.revenue || g.held || g.scheduled) && (
            <Panel title="Metas do período" info={SOURCES.goals(filters.attribution)}>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {g.revenue ? <GoalItem label="Receita" done={formatBRLShort(mine.amount)} target={formatBRLShort(g.revenue)} ratio={mine.amount / g.revenue} /> : null}
                {g.held ? <GoalItem label="Reuniões conduzidas" done={formatInt(mine.conducted?.past_count ?? 0)} target={formatInt(g.held)} ratio={(mine.conducted?.past_count ?? 0) / g.held} /> : null}
                {g.scheduled ? <GoalItem label="Agendamentos" done={formatInt(mine.scheduled?.total_count ?? 0)} target={formatInt(g.scheduled)} ratio={(mine.scheduled?.total_count ?? 0) / g.scheduled} tone="blue" /> : null}
              </div>
            </Panel>
          )}

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
            <Panel title="Fechamento mensal" info={SOURCES.closingChart(filters.attribution)} className="xl:col-span-2">
              {closing.isLoading ? (
                <LoadingBlock className="h-56" />
              ) : (
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={mine.chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => formatBRLShort(v).replace("R$ ", "")} />
                      <Tooltip formatter={(v: number) => [formatBRL(v), "Valor ganho"]} cursor={{ fill: "hsl(var(--muted))" }} contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                      <Bar dataKey="valor" radius={[6, 6, 0, 0]} maxBarSize={48}>
                        {mine.chart.map((c) => (
                          <Cell key={c.month} fill={c.inPeriod ? "hsl(var(--primary))" : "hsl(var(--primary) / 0.35)"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Panel>

            <Panel title="Negócios em aberto por etapa" info={SOURCES.sellerStages(filters.attribution)} className="xl:col-span-3">
              {open.isLoading ? (
                <LoadingBlock />
              ) : mine.stages.length === 0 ? (
                <EmptyState>Nenhum negócio em aberto.</EmptyState>
              ) : (
                <div className="-mx-4 overflow-x-auto md:mx-0">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <tr className="border-b border-border">
                        <th className="px-4 py-2 font-medium md:pl-0">Pipeline · etapa</th>
                        <th className="px-3 py-2 text-right font-medium">Negócios</th>
                        <th className="px-3 py-2 text-right font-medium">Em aberto</th>
                        <th className="px-4 py-2 text-right font-medium md:pr-0">Ponderado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mine.stages.map((s) => (
                        <tr key={s.key} className="border-b border-border/60 last:border-0">
                          <td className="px-4 py-2.5 md:pl-0">
                            <span className="text-muted-foreground">{s.pipeline} · </span>
                            <span className="font-medium">{s.stage}</span>
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{formatInt(s.count)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{formatBRLShort(s.amount)}</td>
                          <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-primary md:pr-0">{formatBRLShort(s.weighted)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>

          <Panel title="Agenda do período" info={SOURCES.sellerAgenda()}>
            <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4 lg:grid-cols-7">
              {[
                ["Conduzidas (total)", mine.conducted?.total_count],
                ["Já aconteceram", mine.conducted?.past_count],
                ["Por vir", mine.conducted?.upcoming_count],
                ["Realizadas", mine.conducted?.completed_count],
                ["No-show", mine.conducted?.no_show_count],
                ["Canceladas", mine.conducted?.canceled_count],
                ["Sem registro", mine.conducted?.unrecorded_count],
              ].map(([label, v]) => (
                <div key={label as string} className="flex flex-col gap-0.5">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="text-xl font-semibold tabular-nums">{formatInt(Number(v ?? 0))}</span>
                </div>
              ))}
            </div>
          </Panel>
        </>
      )}
    </CommercialShell>
  );
}

function GoalItem({ label, done, target, ratio, tone = "primary" }: { label: string; done: string; target: string; ratio: number; tone?: "primary" | "blue" }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="font-semibold tabular-nums">{formatPct(ratio)}</span>
      </div>
      <ProgressBar ratio={ratio} tone={tone} />
      <span className="text-xs text-muted-foreground">
        {done} de {target}
      </span>
    </div>
  );
}
