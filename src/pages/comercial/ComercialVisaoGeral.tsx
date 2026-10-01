import { useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SOURCES } from "@/lib/commercialSources";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { useHubspotOwners } from "@/lib/hubspotMeta";
import {
  addDays,
  addMonths,
  closingBySeller,
  dayEndISO,
  dayLabel,
  dayLabelLong,
  dayStartISO,
  daysBetween,
  daysOfMonth,
  delta,
  formatBRL,
  formatBRLShort,
  formatInt,
  formatPct,
  goalsByOwner,
  monthEndISO,
  monthLabel,
  monthStartISO,
  monthsBetween,
  NO_OWNER,
  periodEndISO,
  periodLabel,
  periodStartISO,
  sumBy,
  useClosing,
  useClosingRange,
  useCommercialFilters,
  useCustomers,
  useDailyClosing,
  useGoals,
  useMeetingsByConductor,
  useMeetingsByScheduler,
  useOpenPipeline,
  useSalesPipelines,
  ownerDisplay,
  ownerOptions,
  ymOf,
  type CommercialFilters,
} from "@/lib/commercial";
import {
  AttributionToggle,
  BarList,
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
  WarnNote,
} from "@/components/commercial/CommercialUI";

export default function ComercialVisaoGeral() {
  const { workspace } = useWorkspace();
  const location = useLocation();
  const owners = useHubspotOwners(workspace?.id);
  const { filters, setFilters } = useCommercialFilters();
  const { from, to, fromDay, toDay, owner } = filters;
  const dayMode = !!(fromDay && toDay);

  const periodMonths = monthsBetween(from, to);
  const prevFrom = addMonths(from, -periodMonths.length);
  const prevTo = addMonths(from, -1);
  const chartFrom = addMonths(to, -5) < prevFrom ? addMonths(to, -5) : prevFrom;

  // Limites exatos do período atual/anterior — respeitam o recorte por dia quando ativo,
  // senão caem no mês inteiro (mesmo comportamento de sempre).
  const periodStart = periodStartISO(filters);
  const periodEnd = periodEndISO(filters);
  const prevFilters: CommercialFilters = dayMode
    ? (() => {
        const len = daysBetween(fromDay!, toDay!).length;
        const prevToDay = addDays(fromDay!, -1);
        const prevFromDay = addDays(prevToDay, -(len - 1));
        return { ...filters, from: ymOf(prevFromDay), to: ymOf(prevToDay), fromDay: prevFromDay, toDay: prevToDay };
      })()
    : { ...filters, from: prevFrom, to: prevTo, fromDay: null, toDay: null };
  const prevStart = periodStartISO(prevFilters);
  const prevEnd = periodEndISO(prevFilters);

  const pipelines = useSalesPipelines(workspace?.id);
  const closing = useClosing(workspace?.id, chartFrom, to, filters);
  const currentRange = useClosingRange(workspace?.id, periodStart, periodEnd, filters);
  const prevRange = useClosingRange(workspace?.id, prevStart, prevEnd, filters);
  const conductor = useMeetingsByConductor(workspace?.id, filters);
  const prevConductor = useMeetingsByConductor(workspace?.id, prevFilters);
  const scheduler = useMeetingsByScheduler(workspace?.id, filters, "created");
  const open = useOpenPipeline(workspace?.id, filters);
  const goals = useGoals(workspace?.id, from, to);
  const dailyStartISO = dayMode ? dayStartISO(fromDay!) : monthStartISO(to);
  const dailyEndISO = dayMode ? dayEndISO(toDay!) : monthEndISO(to);
  const daily = useDailyClosing(workspace?.id, dailyStartISO, dailyEndISO, filters);
  const customers = useCustomers(workspace?.id, periodStart, periodEnd, filters);

  const byOwner = <T extends { owner_id: string }>(rows: T[]) => (owner ? rows.filter((r) => r.owner_id === owner) : rows);
  const customerRows = byOwner(customers.data ?? []);

  const data = useMemo(() => {
    const currentRows = byOwner(currentRange.data ?? []);
    const prevRows = byOwner(prevRange.data ?? []);
    const wonAmount = sumBy(currentRows, (r) => r.won_amount);
    const wonCount = sumBy(currentRows, (r) => r.won_count);
    const lostCount = sumBy(currentRows, (r) => r.lost_count);

    const conductorRows = byOwner(conductor.data ?? []);
    const prevConductorRows = byOwner(prevConductor.data ?? []);
    const meetingsNow = sumBy(conductorRows, (r) => r.total_count);
    const meetingsPrev = sumBy(prevConductorRows, (r) => r.total_count);
    const past = sumBy(conductorRows, (r) => r.past_count);
    const unrecorded = sumBy(conductorRows, (r) => r.unrecorded_count);
    const upcoming = sumBy(conductorRows, (r) => r.upcoming_count);

    const openRows = byOwner(open.data ?? []);
    const openAmount = sumBy(openRows, (r) => r.open_amount);
    const weighted = sumBy(openRows, (r) => r.weighted_amount);
    const openCount = sumBy(openRows, (r) => r.open_count);
    const withoutAmount = sumBy(openRows, (r) => r.without_amount_count);

    const closingRows = byOwner(closing.data ?? []);
    const chart = monthsBetween(addMonths(to, -5), to).map((m) => ({
      month: m,
      label: monthLabel(m),
      valor: sumBy(closingRows.filter((r) => r.month === m), (r) => r.won_amount),
      inPeriod: m >= from && m <= to,
    }));

    const sellers = closingBySeller(currentRows);
    const noOwnerWon = sellers.find((s) => s.owner_id === NO_OWNER);

    return {
      wonAmount, wonCount, lostCount,
      wonAmountPrev: sumBy(prevRows, (r) => r.won_amount),
      wonCountPrev: sumBy(prevRows, (r) => r.won_count),
      meetingsNow, meetingsPrev, past, unrecorded, upcoming,
      openAmount, weighted, openCount, withoutAmount,
      chart, sellers, noOwnerWon,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRange.data, prevRange.data, conductor.data, prevConductor.data, open.data, closing.data, from, to, owner]);

  const dailyChart = useMemo(() => {
    const rows = byOwner(daily.data ?? []);
    const days = dayMode ? daysBetween(fromDay!, toDay!) : daysOfMonth(to);
    return days.map((d) => ({
      day: d,
      label: dayLabel(d),
      valor: sumBy(rows.filter((r) => r.day === d), (r) => r.won_amount),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daily.data, dayMode, fromDay, toDay, to, owner]);

  const goalMap = useMemo(() => goalsByOwner(goals.data ?? []), [goals.data]);
  const conductorByOwner = useMemo(() => new Map((conductor.data ?? []).map((r) => [r.owner_id, r])), [conductor.data]);
  const schedulerByOwner = useMemo(
    () => new Map((scheduler.data ?? []).filter((r) => r.scheduler_owner_id).map((r) => [r.scheduler_owner_id!, r])),
    [scheduler.data],
  );

  const goalRows = useMemo(() => {
    const out: { id: string; name: string; role: string; ratio: number; detail: string; tone: "primary" | "blue" }[] = [];
    for (const [ownerId, g] of goalMap) {
      if (owner && ownerId !== owner) continue;
      const name = ownerDisplay(owners, ownerId);
      if (g.revenue) {
        const done = data.sellers.find((s) => s.owner_id === ownerId)?.won_amount ?? 0;
        out.push({ id: `${ownerId}-rev`, name, role: "Closer", ratio: done / g.revenue, detail: `${formatBRLShort(done)} de ${formatBRLShort(g.revenue)}`, tone: "primary" });
      }
      if (g.scheduled) {
        const done = schedulerByOwner.get(ownerId)?.total_count ?? 0;
        out.push({ id: `${ownerId}-sch`, name, role: "SDR", ratio: done / g.scheduled, detail: `${formatInt(done)} de ${formatInt(g.scheduled)} agendamentos`, tone: "blue" });
      }
    }
    return out.sort((a, b) => b.ratio - a.ratio);
  }, [goalMap, owner, owners, data.sellers, schedulerByOwner]);

  const ranking = data.sellers.filter((s) => s.owner_id !== NO_OWNER).slice(0, 10);
  const loadingPeriod = currentRange.isLoading;
  const loadingChart = closing.isLoading;
  const unrecordedRatio = data.past ? data.unrecorded / data.past : null;
  const multiMonth = periodMonths.length > 1;
  const prevLabel = dayMode || multiMonth ? "vs período anterior" : `vs ${monthLabel(prevTo)}`;
  const periodDescription = dayMode ? `${dayLabelLong(fromDay!)} a ${dayLabelLong(toDay!)}` : periodLabel(from, to);

  const sdrItems = (scheduler.data ?? [])
    .filter((r) => r.scheduler_user_id !== "(desconhecido)" && r.for_others_count > 0)
    .slice(0, 6)
    .map((r) => ({
      key: r.scheduler_user_id,
      label: r.scheduler_owner_id ? ownerDisplay(owners, r.scheduler_owner_id) : `Usuário ${r.scheduler_user_id}`,
      value: r.total_count,
      display: formatInt(r.total_count),
    }));
  const closerItems = (conductor.data ?? [])
    .filter((r) => r.owner_id !== NO_OWNER)
    .slice(0, 6)
    .map((r) => ({ key: r.owner_id, label: ownerDisplay(owners, r.owner_id), value: r.total_count, display: formatInt(r.total_count) }));

  const sellerLink = (ownerId: string) => {
    const params = new URLSearchParams(location.search);
    params.set("vendedor", ownerId);
    return { pathname: "/comercial/vendedor", search: `?${params.toString()}` };
  };

  return (
    <CommercialShell
      title="Visão Geral"
      description={`${periodDescription} · ${filters.attribution === "closer" ? "venda atribuída ao closer" : "venda atribuída ao dono do negócio"}`}
      filters={
        <FilterBar>
          <PeriodSelect from={from} to={to} fromDay={fromDay} toDay={toDay} onChange={(patch) => setFilters(patch)} allowDayPicker />
          <OwnerSelect value={owner} owners={ownerOptions(owners, data.sellers.map((s) => s.owner_id).concat((conductor.data ?? []).map((c) => c.owner_id)))} onChange={(v) => setFilters({ owner: v })} />
          <PipelineSelect pipelines={pipelines.data ?? []} selected={filters.pipelines} onChange={(v) => setFilters({ pipelines: v })} />
          <AttributionToggle value={filters.attribution} onChange={(v) => setFilters({ attribution: v })} />
        </FilterBar>
      }
    >
      <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard info={SOURCES.revenue(filters.attribution)} label="Receita fechada" value={formatBRLShort(data.wonAmount)} change={delta(data.wonAmount, data.wonAmountPrev)} sub={prevLabel} loading={loadingPeriod} />
        <KpiCard
          info={SOURCES.wonDeals(filters.attribution)}
          label="Negócios ganhos"
          value={formatInt(data.wonCount)}
          change={delta(data.wonCount, data.wonCountPrev)}
          sub={`${formatInt(data.lostCount)} perdidos · conv. ${formatPct(data.wonCount + data.lostCount ? data.wonCount / (data.wonCount + data.lostCount) : null)}`}
          loading={loadingPeriod}
        />
        <KpiCard
          info={SOURCES.meetings()}
          label="Reuniões"
          value={formatInt(data.meetingsNow)}
          change={delta(data.meetingsNow, data.meetingsPrev)}
          sub={`${formatInt(data.upcoming)} ainda por vir`}
          loading={conductor.isLoading || prevConductor.isLoading}
        />
        <KpiCard
          info={SOURCES.unrecorded()}
          label="Reuniões sem registro"
          value={formatPct(unrecordedRatio)}
          sub={`${formatInt(data.unrecorded)} de ${formatInt(data.past)} sem resultado`}
          tone={unrecordedRatio !== null && unrecordedRatio > 0.2 ? "warn" : "default"}
          loading={conductor.isLoading}
        />
        <div className="col-span-2 lg:col-span-1">
          <KpiCard info={SOURCES.weighted(filters.attribution)} label="Previsão ponderada" value={formatBRLShort(data.weighted)} sub={`de ${formatBRLShort(data.openAmount)} em aberto`} loading={open.isLoading} />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="Fechamento mensal" info={SOURCES.closingChart(filters.attribution)} action={<span className="text-sm text-muted-foreground">Valor ganho · últimos 6 meses</span>} className="xl:col-span-2">
          {loadingChart ? (
            <LoadingBlock className="h-64" />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} width={64} tickFormatter={(v: number) => formatBRLShort(v).replace("R$ ", "")} />
                  <Tooltip
                    formatter={(v: number) => [formatBRL(v), "Valor ganho"]}
                    cursor={{ fill: "hsl(var(--muted))" }}
                    contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                  />
                  <Bar dataKey="valor" radius={[6, 6, 0, 0]} maxBarSize={64}>
                    {data.chart.map((c) => (
                      <Cell key={c.month} fill={c.inPeriod ? "hsl(var(--primary))" : "hsl(var(--primary) / 0.35)"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        <Panel title="Metas do período" info={SOURCES.goals(filters.attribution)} action={<Link to="/comercial/metas" className="text-sm font-medium text-primary hover:underline">Editar metas</Link>}>
          {goals.isLoading ? (
            <LoadingBlock />
          ) : goalRows.length === 0 ? (
            <EmptyState>Nenhuma meta cadastrada para o período.</EmptyState>
          ) : (
            <ul className="flex flex-col gap-4">
              {goalRows.map((g) => (
                <li key={g.id} className="flex flex-col gap-1.5">
                  <div className="flex justify-between gap-2 text-sm">
                    <span className="truncate font-medium">
                      {g.name} <span className="font-normal text-muted-foreground">· {g.role}</span>
                    </span>
                    <span className="font-semibold tabular-nums">{formatPct(g.ratio)}</span>
                  </div>
                  <ProgressBar ratio={g.ratio} tone={g.tone} />
                  <span className="text-xs text-muted-foreground">{g.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel
        title="Fechamento diário"
        info={SOURCES.closingChart(filters.attribution)}
        action={
          <span className="text-sm text-muted-foreground">
            Valor ganho por dia · {dayMode ? `${dayLabelLong(fromDay!)} a ${dayLabelLong(toDay!)}` : monthLabel(to, true)}
          </span>
        }
      >
        {daily.isLoading ? (
          <LoadingBlock className="h-56" />
        ) : (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyChart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} interval={2} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} width={64} tickFormatter={(v: number) => formatBRLShort(v).replace("R$ ", "")} />
                <Tooltip
                  formatter={(v: number) => [formatBRL(v), "Valor ganho"]}
                  labelFormatter={(label: string) => `Dia ${label}`}
                  cursor={{ fill: "hsl(var(--muted))" }}
                  contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                />
                <Bar dataKey="valor" radius={[4, 4, 0, 0]} maxBarSize={28} fill="hsl(var(--primary))" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>

      <Panel
        title="Visão por cliente"
        info={SOURCES.closingChart(filters.attribution)}
        action={<span className="text-sm text-muted-foreground">Quanto cada cliente pagou e o que comprou, no período</span>}
      >
        <CustomerTable rows={customerRows} loading={customers.isLoading} ownerName={(id) => ownerDisplay(owners, id)} />
      </Panel>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="Agenda · SDR → Closer" info={SOURCES.sdrCloser()} action={<Link to={{ pathname: "/comercial/agenda", search: location.search }} className="text-sm font-medium text-primary hover:underline">Ver agenda</Link>} className="xl:col-span-2">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div className="flex flex-col gap-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Agendou para outros (SDR)</span>
              {scheduler.isLoading ? <LoadingBlock className="h-40" /> : sdrItems.length ? <BarList items={sdrItems} tone="blue" /> : <EmptyState>Sem agendamentos no período.</EmptyState>}
            </div>
            <div className="flex flex-col gap-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Conduziu (Closer)</span>
              {conductor.isLoading ? <LoadingBlock className="h-40" /> : closerItems.length ? <BarList items={closerItems} /> : <EmptyState>Sem reuniões no período.</EmptyState>}
            </div>
          </div>
        </Panel>

        <Panel title="Qualidade dos dados" info={SOURCES.dataQuality(filters.attribution)}>
          <div className="flex flex-col gap-3">
            {unrecordedRatio !== null && unrecordedRatio > 0.2 && (
              <WarnNote>
                <strong>{formatInt(data.unrecorded)} de {formatInt(data.past)}</strong> reuniões que já aconteceram estão sem resultado registrado na HubSpot — não dá para medir comparecimento.
              </WarnNote>
            )}
            {data.openCount > 0 && data.withoutAmount / data.openCount > 0.3 && (
              <WarnNote>
                <strong>{formatInt(data.withoutAmount)} de {formatInt(data.openCount)}</strong> negócios em aberto estão sem valor — a previsão fica subestimada.
              </WarnNote>
            )}
            {!owner && data.noOwnerWon && data.noOwnerWon.won_count > 0 && (
              <WarnNote>
                <strong>{formatInt(data.noOwnerWon.won_count)} ganhos ({formatBRLShort(data.noOwnerWon.won_amount)})</strong> estão sem {filters.attribution === "closer" ? "closer" : "dono"} atribuído.
              </WarnNote>
            )}
            <p className="text-xs text-muted-foreground">Dados da HubSpot, sincronizados diariamente às 06:00.</p>
          </div>
        </Panel>
      </div>

      <Panel title="Ranking de vendedores" info={SOURCES.ranking(filters.attribution)}>
        {loadingPeriod ? (
          <LoadingBlock />
        ) : ranking.length === 0 ? (
          <EmptyState>Nenhum negócio fechado no período.</EmptyState>
        ) : (
          <div className="-mx-4 overflow-x-auto md:mx-0">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-4 py-2 font-medium md:pl-0">Vendedor</th>
                  <th className="px-3 py-2 text-right font-medium">Reuniões</th>
                  <th className="px-3 py-2 text-right font-medium">Ganhos</th>
                  <th className="px-3 py-2 text-right font-medium">Valor</th>
                  <th className="px-3 py-2 text-right font-medium">Ticket médio</th>
                  <th className="px-3 py-2 text-right font-medium">Conversão</th>
                  <th className="px-4 py-2 font-medium md:pr-0">Meta de receita</th>
                </tr>
              </thead>
              <tbody>
                {ranking.map((s) => {
                  const goal = goalMap.get(s.owner_id)?.revenue ?? null;
                  const ratio = goal ? s.won_amount / goal : null;
                  return (
                    <tr key={s.owner_id} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-3 font-medium md:pl-0">
                        <Link to={sellerLink(s.owner_id)} className="hover:text-primary hover:underline">
                          {ownerDisplay(owners, s.owner_id)}
                        </Link>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatInt(conductorByOwner.get(s.owner_id)?.total_count ?? 0)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatInt(s.won_count)}</td>
                      <td className="px-3 py-3 text-right font-semibold tabular-nums">{formatBRLShort(s.won_amount)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{s.won_count ? formatBRLShort(s.won_amount / s.won_count) : "—"}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatPct(s.won_count + s.lost_count ? s.won_count / (s.won_count + s.lost_count) : null, 1)}</td>
                      <td className="px-4 py-3 md:pr-0">
                        {ratio === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <div className="w-24"><ProgressBar ratio={ratio} /></div>
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
      </Panel>
    </CommercialShell>
  );
}

