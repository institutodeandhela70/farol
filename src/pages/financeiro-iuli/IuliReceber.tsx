import { useMemo } from "react";
import { usePersistentState } from "@/lib/iuliPersist";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { delta, formatBRL, formatBRLShort, formatInt, formatPct } from "@/lib/commercial";
import { AGING_BUCKETS, formatDate } from "@/lib/iuli";
import { bucketLabel, bucketsBetween, sumBy, useReceivablesFlow, useReceivablesList, useReceivablesPosition, type FlowRow } from "@/lib/iuliData";
import { periodText, previousRange, useIuliFilters } from "@/lib/iuliFilters";
import { IULI_SOURCES as S } from "@/lib/iuliSources";
import { EmptyState, KpiCard, LoadingBlock, Panel, ProgressBar, WarnNote } from "@/components/commercial/CommercialUI";
import { IuliShell, StackedMonthChart, StatusPill } from "@/components/iuli/IuliUI";
import { axisProps, TONE, tooltipStyle } from "@/components/iuli/iuliTheme";
import { ClearFilters, ClientFilter, CompanyFilter, IntercompanyToggle, OptionFilter, PeriodFilter } from "@/components/iuli/IuliFilterBar";

const AGING_SHORT: Record<string, string> = {
  vencido_365_mais: "+1 ano",
  vencido_181_365: "181–365d",
  vencido_91_180: "91–180d",
  vencido_31_90: "31–90d",
  vencido_1_30: "1–30d",
  a_vencer_0_30: "0–30d",
  a_vencer_31_90: "31–90d",
  a_vencer_91_180: "91–180d",
  a_vencer_180_mais: "+180d",
};

const SITUACAO: Record<string, { label: string; tone: "ok" | "warn" | "bad" }> = {
  recebido: { label: "Recebido", tone: "ok" },
  a_vencer: { label: "A vencer", tone: "warn" },
  vencido: { label: "Vencido", tone: "bad" },
};

export default function IuliReceber() {
  const { workspace } = useWorkspace();
  const ws = workspace?.id;
  const { filters, set } = useIuliFilters();
  const prev = previousRange(filters.from, filters.to);
  const [order, setOrder] = usePersistentState<"due_date" | "valor">("receber:ordem", "valor");

  const flow = useReceivablesFlow(ws, filters);
  const flowPrev = useReceivablesFlow(ws, filters, { range: prev });
  const flowSeries = useReceivablesFlow(ws, filters, { grain: true });
  const position = useReceivablesPosition(ws, filters);
  const list = useReceivablesList(ws, filters, order, 50);

  const k = useMemo(() => {
    const t = (rows: FlowRow[] | undefined, serie: string) => ({
      qtd: sumBy(rows, (r) => r.qtd, (r) => r.serie === serie),
      total: sumBy(rows, (r) => r.total, (r) => r.serie === serie),
    });
    const pos = position.data ?? [];
    const overdue = pos.filter((p) => p.faixa.startsWith("vencido"));
    const upcoming = pos.filter((p) => p.faixa.startsWith("a_vencer"));
    return {
      recebido: t(flow.data, "recebido"),
      recebidoPrev: t(flowPrev.data, "recebido"),
      venceRecebido: t(flow.data, "vence_recebido"),
      venceAberto: t(flow.data, "vence_aberto"),
      abertoTotal: sumBy(pos, (p) => p.total),
      abertoQtd: sumBy(pos, (p) => p.qtd),
      vencido: sumBy(overdue, (p) => p.total),
      vencidoQtd: sumBy(overdue, (p) => p.qtd),
      aVencer: sumBy(upcoming, (p) => p.total),
      comNf: sumBy(pos, (p) => p.com_nf),
      comAnexo: sumBy(pos, (p) => p.com_anexo),
      velho: pos.find((p) => p.faixa === "vencido_365_mais"),
    };
  }, [flow.data, flowPrev.data, position.data]);

  const aging = AGING_BUCKETS.map((b) => {
    const p = position.data?.find((x) => x.faixa === b.key);
    return { ...b, short: AGING_SHORT[b.key], valor: p?.total ?? 0, qtd: p?.qtd ?? 0 };
  });

  const chart = useMemo(() => {
    const map = new Map<string, { pago: number; aberto: number; recebido: number }>();
    for (const r of flowSeries.data ?? []) {
      if (!r.bucket) continue;
      const cur = map.get(r.bucket) ?? { pago: 0, aberto: 0, recebido: 0 };
      if (r.serie === "vence_recebido") cur.pago += r.total;
      else if (r.serie === "vence_aberto") cur.aberto += r.total;
      else cur.recebido += r.total;
      map.set(r.bucket, cur);
    }
    return bucketsBetween(filters.from, filters.to, filters.grain).map((b) => ({ label: bucketLabel(b, filters.grain), ...(map.get(b) ?? { pago: 0, aberto: 0, recebido: 0 }) }));
  }, [flowSeries.data, filters.from, filters.to, filters.grain]);

  const venceTotal = k.venceRecebido.total + k.venceAberto.total;
  const overdueRatio = k.abertoTotal ? k.vencido / k.abertoTotal : null;
  const grainText = filters.grain === "day" ? "por dia" : filters.grain === "week" ? "por semana" : "por mês";

  return (
    <IuliShell
      title="Contas a Receber"
      description={`${periodText(filters.preset, filters.from, filters.to)} · vencimentos e recebimentos do período; posição de hoje`}
      scope={filters.empresa}
      filters={
        <>
          <PeriodFilter filters={filters} set={set} />
          <CompanyFilter filters={filters} set={set} />
          <ClientFilter filters={filters} set={set} />
          <OptionFilter
            label="Situação"
            allLabel="Todas as situações"
            param="situacao"
            value={filters.situacao}
            set={set}
            options={Object.entries(SITUACAO).map(([value, s]) => ({ value, label: s.label }))}
          />
          <select
            aria-label="Nota fiscal"
            value={filters.nf ?? ""}
            onChange={(e) => set({ nf: e.target.value || null })}
            className="h-10 rounded-md border border-input bg-card px-3 text-sm font-medium"
          >
            <option value="">Com ou sem nota</option>
            <option value="com">Com nota fiscal</option>
            <option value="sem">Sem nota fiscal</option>
          </select>
          <IntercompanyToggle filters={filters} set={set} />
          <ClearFilters filters={filters} set={set} />
        </>
      }
    >
      <section aria-label="Indicadores do período" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <KpiCard
          info={S.receivedByPayment()}
          label="Recebido no período"
          value={formatBRLShort(k.recebido.total)}
          change={delta(k.recebido.total, k.recebidoPrev.total)}
          sub={`${formatInt(k.recebido.qtd)} títulos · vs período anterior`}
          loading={flow.isLoading}
        />
        <KpiCard
          info={S.dueInPeriod()}
          label="Venceu/vence no período"
          value={formatBRLShort(venceTotal)}
          sub={`${formatPct(venceTotal ? k.venceRecebido.total / venceTotal : null)} já recebido`}
          loading={flow.isLoading}
        />
        <div className="col-span-2 lg:col-span-1">
          <KpiCard
            info={S.dueOpenInPeriod()}
            label="Sem baixa do período"
            value={formatBRLShort(k.venceAberto.total)}
            sub={`${formatInt(k.venceAberto.qtd)} títulos que vencem no período`}
            tone={venceTotal && k.venceAberto.total / venceTotal > 0.3 ? "warn" : "default"}
            loading={flow.isLoading}
          />
        </div>
      </section>

      <section aria-label="Posição de hoje" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <KpiCard info={S.receivablePending()} label="A receber hoje (sem baixa)" value={formatBRLShort(k.abertoTotal)} sub={`${formatInt(k.abertoQtd)} títulos · qualquer vencimento`} loading={position.isLoading} />
        <KpiCard
          info={S.receivableOverdue()}
          label="Vencido sem baixa"
          value={formatBRLShort(k.vencido)}
          sub={`${formatInt(k.vencidoQtd)} títulos · ${formatPct(overdueRatio)}`}
          tone={overdueRatio !== null && overdueRatio > 0.3 ? "warn" : "default"}
          loading={position.isLoading}
        />
        <div className="col-span-2 lg:col-span-1">
          <KpiCard info={S.receivableUpcoming()} label="A vencer" value={formatBRLShort(k.aVencer)} sub="posição de hoje" loading={position.isLoading} />
        </div>
      </section>

      {k.velho && k.vencido > 0 && k.velho.total / k.vencido > 0.5 && (
        <WarnNote>
          <strong>{formatBRLShort(k.velho.total)}</strong> ({formatInt(k.velho.qtd)} títulos) venceram há mais de um ano e continuam sem baixa — {formatPct(k.velho.total / k.vencido)} de todo o vencido.
          Quase certamente não é inadimplência recente: são baixas não registradas, negociações antigas ou títulos a cancelar na IULI.
        </WarnNote>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Vencimentos do período" info={S.dueChart()} action={<span className="text-sm text-muted-foreground">Pela data de vencimento, {grainText}</span>}>
          {flowSeries.isLoading ? (
            <LoadingBlock className="h-72" />
          ) : (
            <StackedMonthChart
              data={chart}
              format={formatBRLShort}
              series={[
                { key: "pago", label: "Já recebido", color: TONE.primary },
                { key: "aberto", label: "Sem baixa", color: TONE.amber },
              ]}
            />
          )}
        </Panel>
        <Panel title="Recebimentos do período" info={S.receivedByPayment()} action={<span className="text-sm text-muted-foreground">Pela data do pagamento, {grainText}</span>}>
          {flowSeries.isLoading ? (
            <LoadingBlock className="h-72" />
          ) : (
            <StackedMonthChart data={chart} format={formatBRLShort} series={[{ key: "recebido", label: "Recebido", color: TONE.blue }]} />
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="Aging — idade do que está sem baixa hoje" info={S.aging()} className="xl:col-span-2">
          {position.isLoading ? (
            <LoadingBlock className="h-72" />
          ) : (
            <>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={aging} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="short" {...axisProps} interval={0} fontSize={11} />
                    <YAxis {...axisProps} width={68} tickFormatter={(v: number) => formatBRLShort(v).replace("R$ ", "")} />
                    <Tooltip
                      {...tooltipStyle}
                      formatter={(v: number, _n: string, item: { payload?: { qtd: number } }) => [`${formatBRL(v)} · ${formatInt(item.payload?.qtd ?? 0)} títulos`, "Sem baixa"]}
                      labelFormatter={(_l, payload) => String((payload?.[0]?.payload as { label?: string } | undefined)?.label ?? "")}
                    />
                    <Bar dataKey="valor" radius={[6, 6, 0, 0]} maxBarSize={56}>
                      {aging.map((b) => (
                        <Cell key={b.key} fill={b.overdue ? (b.key === "vencido_1_30" || b.key === "vencido_31_90" ? TONE.amber : TONE.red) : TONE.primary} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span><span className="mr-1.5 inline-block size-2.5 rounded-full" style={{ background: TONE.red }} />Vencido há mais de 90 dias</span>
                <span><span className="mr-1.5 inline-block size-2.5 rounded-full" style={{ background: TONE.amber }} />Vencido até 90 dias</span>
                <span><span className="mr-1.5 inline-block size-2.5 rounded-full" style={{ background: TONE.primary }} />A vencer</span>
              </div>
            </>
          )}
        </Panel>

        <Panel title="Cobertura documental" info={S.documents()}>
          {position.isLoading ? (
            <LoadingBlock />
          ) : k.abertoQtd ? (
            <div className="flex flex-col gap-4">
              <DocRow label="Com nota fiscal" count={k.comNf} total={k.abertoQtd} />
              <DocRow label="Com algum anexo" count={k.comAnexo} total={k.abertoQtd} />
              <p className="text-xs text-muted-foreground">Base: {formatInt(k.abertoQtd)} títulos sem baixa hoje.</p>
            </div>
          ) : (
            <EmptyState>Nenhum título sem baixa.</EmptyState>
          )}
        </Panel>
      </div>

      <Panel
        title="Títulos que vencem no período"
        info={S.receivablesList()}
        action={
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{list.data ? `${formatInt(Math.min(50, list.data.count))} de ${formatInt(list.data.count)}` : ""}</span>
            <select aria-label="Ordenar" value={order} onChange={(e) => setOrder(e.target.value as "due_date" | "valor")} className="h-9 rounded-md border border-input bg-card px-2 text-sm">
              <option value="valor">Maior valor</option>
              <option value="due_date">Vencimento</option>
            </select>
          </div>
        }
      >
        {list.isLoading ? (
          <LoadingBlock />
        ) : list.data?.rows.length ? (
          <div className="-mx-4 overflow-x-auto md:mx-0">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-4 py-2 font-medium md:pl-0">Vencimento</th>
                  <th className="px-3 py-2 font-medium">Cliente</th>
                  <th className="px-3 py-2 font-medium">Descrição</th>
                  {filters.empresa === "todas" && <th className="px-3 py-2 font-medium">Empresa</th>}
                  <th className="px-3 py-2 font-medium">Situação</th>
                  <th className="px-3 py-2 font-medium">NF</th>
                  <th className="px-4 py-2 text-right font-medium md:pr-0">Valor</th>
                </tr>
              </thead>
              <tbody>
                {list.data.rows.map((t) => (
                  <tr key={`${t.empresa}-${t.iuli_id}`} className="border-b border-border/60 last:border-0">
                    <td className="whitespace-nowrap px-4 py-2.5 tabular-nums md:pl-0">{formatDate(t.due_date)}</td>
                    <td className="max-w-48 truncate px-3 py-2.5 font-medium">
                      {t.cliente ?? "—"}
                      {t.entre_empresas && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(entre empresas)</span>}
                    </td>
                    <td className="max-w-72 truncate px-3 py-2.5 text-muted-foreground" title={t.description ?? ""}>{t.description ?? "—"}</td>
                    {filters.empresa === "todas" && <td className="px-3 py-2.5 text-muted-foreground">{t.empresa}</td>}
                    <td className="px-3 py-2.5">
                      <StatusPill tone={SITUACAO[t.situacao].tone}>
                        {SITUACAO[t.situacao].label}
                        {t.situacao === "recebido" && t.pagamento ? ` ${formatDate(t.pagamento)}` : ""}
                      </StatusPill>
                    </td>
                    <td className="px-3 py-2.5">{t.tem_nf ? "Sim" : "—"}</td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums md:pr-0">{formatBRL(t.situacao === "recebido" ? (t.valor_pago ?? t.valor) : t.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState>Nenhum título com esses filtros.</EmptyState>
        )}
      </Panel>
    </IuliShell>
  );
}

function DocRow({ label, count, total }: { label: string; count: number; total: number }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between gap-2 text-sm">
        <span>{label}</span>
        <span className="font-semibold tabular-nums">
          {formatInt(count)} <span className="font-normal text-muted-foreground">· {formatPct(total ? count / total : null, 1)}</span>
        </span>
      </div>
      <ProgressBar ratio={total ? count / total : 0} />
    </div>
  );
}
