import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SOURCES } from "@/lib/commercialSources";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { useHubspotOwners } from "@/lib/hubspotMeta";
import { cn } from "@/lib/utils";
import {
  addMonths,
  formatInt,
  formatPct,
  goalsByOwner,
  monthLabel,
  monthsBetween,
  NO_OWNER,
  periodLabel,
  sumBy,
  useCommercialFilters,
  useGoals,
  useMeetingsByConductor,
  useMeetingsByScheduler,
  useMeetingsMonthly,
  useMeetingTypes,
  type DateBasis,
  type MeetingOutcomeCounts,
  ownerDisplay,
  ownerOptions,
} from "@/lib/commercial";
import {
  CommercialShell,
  EmptyState,
  FilterBar,
  KpiCard,
  LoadingBlock,
  MultiSelect,
  OwnerSelect,
  Panel,
  PeriodSelect,
  ProgressBar,
  WarnNote,
} from "@/components/commercial/CommercialUI";

type Tab = "sdr" | "closer";

interface PersonRow extends MeetingOutcomeCounts {
  id: string;
  name: string;
  forOthers?: number;
  goal: number | null;
}

export default function ComercialAgenda() {
  const { workspace } = useWorkspace();
  const owners = useHubspotOwners(workspace?.id);
  const { filters, setFilters } = useCommercialFilters();
  const { from, to, owner } = filters;
  const [tab, setTab] = useState<Tab>("sdr");
  const [basis, setBasis] = useState<DateBasis>("created");

  const chartFrom = addMonths(to, -5) < from ? addMonths(to, -5) : from;
  const types = useMeetingTypes(workspace?.id);
  const monthly = useMeetingsMonthly(workspace?.id, chartFrom, to, filters.activityTypes);
  const conductor = useMeetingsByConductor(workspace?.id, filters);
  const scheduler = useMeetingsByScheduler(workspace?.id, filters, basis);
  const goals = useGoals(workspace?.id, from, to);
  const goalMap = useMemo(() => goalsByOwner(goals.data ?? []), [goals.data]);

  const conductorRows = useMemo(
    () => (conductor.data ?? []).filter((r) => !owner || r.owner_id === owner),
    [conductor.data, owner],
  );

  const totals = useMemo(() => {
    const t = (k: keyof MeetingOutcomeCounts) => sumBy(conductorRows, (r) => r[k]);
    return {
      total: t("total_count"), past: t("past_count"), upcoming: t("upcoming_count"), completed: t("completed_count"),
      noShow: t("no_show_count"), canceled: t("canceled_count"), rescheduled: t("rescheduled_count"), unrecorded: t("unrecorded_count"),
    };
  }, [conductorRows]);

  const chart = useMemo(
    () =>
      monthsBetween(addMonths(to, -5), to).map((m) => {
        const r = (monthly.data ?? []).find((x) => x.month === m);
        const past = r?.past_count ?? 0;
        const unrecorded = r?.unrecorded_count ?? 0;
        return { label: monthLabel(m), "Com resultado": past - unrecorded, "Sem registro": unrecorded, Futuras: (r?.total_count ?? 0) - past };
      }),
    [monthly.data, to],
  );

  const people: PersonRow[] = useMemo(() => {
    if (tab === "closer") {
      return conductorRows
        .filter((r) => r.owner_id !== NO_OWNER)
        .map((r) => ({ ...r, id: r.owner_id, name: ownerDisplay(owners, r.owner_id), goal: goalMap.get(r.owner_id)?.held ?? null }));
    }
    return (scheduler.data ?? [])
      .filter((r) => !owner || r.scheduler_owner_id === owner)
      .map((r) => ({
        ...r,
        id: r.scheduler_user_id,
        name: r.scheduler_owner_id ? ownerDisplay(owners, r.scheduler_owner_id) : r.scheduler_user_id === "(desconhecido)" ? "Desconhecido" : `Usuário ${r.scheduler_user_id}`,
        forOthers: r.for_others_count,
        goal: r.scheduler_owner_id ? goalMap.get(r.scheduler_owner_id)?.scheduled ?? null : null,
      }));
  }, [tab, conductorRows, scheduler.data, owner, owners, goalMap]);

  const loadingPeople = tab === "closer" ? conductor.isLoading : scheduler.isLoading;
  const unrecordedRatio = totals.past ? totals.unrecorded / totals.past : null;

  return (
    <CommercialShell
      title="Agenda & Produtividade"
      description={`${periodLabel(from, to)} · quem agendou (SDR) e quem conduziu (Closer)`}
      filters={
        <FilterBar>
          <PeriodSelect from={from} to={to} onChange={(f, t) => setFilters({ from: f, to: t })} />
          <OwnerSelect
            value={owner}
            owners={ownerOptions(owners, [
              ...(conductor.data ?? []).map((r) => r.owner_id),
              ...(scheduler.data ?? []).flatMap((r) => (r.scheduler_owner_id ? [r.scheduler_owner_id] : [])),
            ])}
            onChange={(v) => setFilters({ owner: v })}
            placeholder="Todas as pessoas"
          />
          <MultiSelect
            label="Tipo de reunião"
            allLabel="Todos os tipos"
            options={types.data ?? []}
            selected={filters.activityTypes}
            onChange={(v) => setFilters({ activityTypes: v })}
          />
        </FilterBar>
      }
    >
      <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard info={SOURCES.agendaTotal()} label="Reuniões no período" value={formatInt(totals.total)} sub={`${formatInt(totals.upcoming)} ainda por vir`} loading={conductor.isLoading} />
        <KpiCard info={SOURCES.agendaTotal()} label="Já aconteceram" value={formatInt(totals.past)} loading={conductor.isLoading} />
        <KpiCard info={SOURCES.agendaOutcome("COMPLETED (realizada)")} label="Realizadas" value={formatInt(totals.completed)} sub="marcadas como realizada" loading={conductor.isLoading} />
        <KpiCard info={SOURCES.agendaOutcome("NO_SHOW (não compareceu) ou CANCELED (cancelada)")} label="No-show + canceladas" value={formatInt(totals.noShow + totals.canceled)} sub={`${formatInt(totals.noShow)} no-show`} loading={conductor.isLoading} />
        <KpiCard info={SOURCES.agendaOutcome("RESCHEDULED (reagendada)")} label="Reagendadas" value={formatInt(totals.rescheduled)} loading={conductor.isLoading} />
        <KpiCard
          info={SOURCES.unrecorded()}
          label="Sem registro"
          value={formatPct(unrecordedRatio)}
          sub={`${formatInt(totals.unrecorded)} sem resultado`}
          tone={unrecordedRatio !== null && unrecordedRatio > 0.2 ? "warn" : "default"}
          loading={conductor.isLoading}
        />
      </section>

      {unrecordedRatio !== null && unrecordedRatio > 0.2 && (
        <WarnNote>
          Para os números de <strong>realizadas, no-show e canceladas</strong> ficarem confiáveis, o time precisa marcar o
          <strong> resultado da reunião</strong> na HubSpot depois que ela acontece. Hoje {formatPct(unrecordedRatio)} das reuniões
          passadas continuam como “agendada”.
        </WarnNote>
      )}

      <Panel title="Evolução mensal" info={SOURCES.agendaMonthly()} action={<span className="text-sm text-muted-foreground">Reuniões pela data em que acontecem</span>}>
        {monthly.isLoading ? (
          <LoadingBlock className="h-64" />
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip cursor={{ fill: "hsl(var(--muted))" }} contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Com resultado" stackId="a" fill="hsl(var(--primary))" maxBarSize={64} />
                <Bar dataKey="Sem registro" stackId="a" fill="#f59e0b" maxBarSize={64} />
                <Bar dataKey="Futuras" stackId="a" fill="hsl(var(--primary) / 0.3)" radius={[6, 6, 0, 0]} maxBarSize={64} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>

      <Panel
        title={tab === "sdr" ? "Por quem agendou" : "Por quem conduziu"}
        info={tab === "sdr" ? SOURCES.agendaSdr(basis) : SOURCES.agendaCloser()}
        action={
          <div className="flex flex-wrap gap-2">
            <div role="tablist" aria-label="Visão" className="flex rounded-md border border-input bg-background p-1">
              {(["sdr", "closer"] as const).map((t) => (
                <button
                  key={t}
                  role="tab"
                  type="button"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                  className={cn("rounded px-3 py-1.5 text-sm font-medium", tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
                >
                  {t === "sdr" ? "Agendou (SDR)" : "Conduziu (Closer)"}
                </button>
              ))}
            </div>
            {tab === "sdr" && (
              <select
                aria-label="Contar reuniões por"
                value={basis}
                onChange={(e) => setBasis(e.target.value as DateBasis)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="created">Agendadas no período</option>
                <option value="meeting">Acontecem no período</option>
              </select>
            )}
          </div>
        }
      >
        {loadingPeople ? (
          <LoadingBlock />
        ) : people.length === 0 ? (
          <EmptyState>Nenhuma reunião no período.</EmptyState>
        ) : (
          <div className="-mx-4 overflow-x-auto md:mx-0">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-4 py-2 font-medium md:pl-0">{tab === "sdr" ? "Quem agendou" : "Quem conduziu"}</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                  {tab === "sdr" && <th className="px-3 py-2 text-right font-medium">Para outros</th>}
                  <th className="px-3 py-2 text-right font-medium">Aconteceram</th>
                  <th className="px-3 py-2 text-right font-medium">Por vir</th>
                  <th className="px-3 py-2 text-right font-medium">Realizadas</th>
                  <th className="px-3 py-2 text-right font-medium">No-show</th>
                  <th className="px-3 py-2 text-right font-medium">Reagend.</th>
                  <th className="px-3 py-2 text-right font-medium">Cancel.</th>
                  <th className="px-3 py-2 text-right font-medium">Sem registro</th>
                  <th className="px-4 py-2 font-medium md:pr-0">Meta</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => {
                  const done = tab === "sdr" ? p.total_count : p.past_count;
                  const ratio = p.goal ? done / p.goal : null;
                  return (
                    <tr key={p.id} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-3 font-medium md:pl-0">{p.name}</td>
                      <td className="px-3 py-3 text-right font-semibold tabular-nums">{formatInt(p.total_count)}</td>
                      {tab === "sdr" && <td className="px-3 py-3 text-right tabular-nums">{formatInt(p.forOthers ?? 0)}</td>}
                      <td className="px-3 py-3 text-right tabular-nums">{formatInt(p.past_count)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatInt(p.upcoming_count)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatInt(p.completed_count)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatInt(p.no_show_count)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatInt(p.rescheduled_count)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatInt(p.canceled_count)}</td>
                      <td className={cn("px-3 py-3 text-right tabular-nums", p.past_count && p.unrecorded_count / p.past_count > 0.2 && "text-amber-700 dark:text-amber-400")}>
                        {formatPct(p.past_count ? p.unrecorded_count / p.past_count : null)}
                      </td>
                      <td className="px-4 py-3 md:pr-0">
                        {ratio === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <div className="w-20"><ProgressBar ratio={ratio} tone={tab === "sdr" ? "blue" : "primary"} /></div>
                            <span className="tabular-nums">{formatPct(ratio)}</span>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {tab === "sdr"
            ? "“Para outros” = reuniões que a pessoa criou para outro vendedor conduzir. Meta de SDR = agendamentos no período."
            : "Meta de closer = reuniões conduzidas que já aconteceram no período."}
        </p>
      </Panel>
    </CommercialShell>
  );
}
