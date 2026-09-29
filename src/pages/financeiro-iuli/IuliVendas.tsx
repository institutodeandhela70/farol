import { useMemo, useState } from "react";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { addMonths, currentYM, delta, formatBRL, formatBRLShort, formatInt, formatPct, monthLabel, monthsBetween } from "@/lib/commercial";
import {
  groupSales,
  lastMonths,
  mergeStatus,
  SALE_GROUP_LABEL,
  SALE_STATUS,
  saleGroupOf,
  snap,
  useIuliSnapshots,
  type SaleGroup,
  type SalesStatus,
  type SalesSummary,
} from "@/lib/iuli";
import { IULI_SOURCES as S } from "@/lib/iuliSources";
import { BarList, EmptyState, KpiCard, Panel } from "@/components/commercial/CommercialUI";
import { IuliShell, PeriodPicker, StackedMonthChart, StatusPill } from "@/components/iuli/IuliUI";
import { TONE } from "@/components/iuli/iuliTheme";

const GROUP_TONE: Record<SaleGroup, "ok" | "warn" | "bad"> = { efetiva: "ok", aberta: "warn", perdida: "bad" };

export default function IuliVendas() {
  const { workspace } = useWorkspace();
  const { data: snaps } = useIuliSnapshots(workspace?.id);
  const ym = currentYM();
  const [period, setPeriod] = useState(`m:${ym}`);

  const options = [
    ...lastMonths(13).reverse().map((m) => ({ value: `m:${m}`, label: monthLabel(m, true) })),
    { value: "12m", label: "Últimos 12 meses" },
    { value: "ytd", label: `Ano de ${ym.slice(0, 4)}` },
  ];

  const d = useMemo(() => {
    let months: string[];
    let summaryKey: string;
    let prevMonths: string[] | null = null;
    if (period === "12m") {
      months = lastMonths(12);
      summaryKey = "sales_summary:12m";
    } else if (period === "ytd") {
      months = monthsBetween(`${ym.slice(0, 4)}-01`, ym);
      summaryKey = "sales_summary:ytd";
    } else {
      const m = period.slice(2);
      months = [m];
      summaryKey = `sales_month:${m}`;
      prevMonths = [addMonths(m, -1)];
    }

    const statusOf = (ms: string[]) => mergeStatus(ms.map((m) => snap<SalesStatus>(snaps, `sales_status_month:${m}`)?.por_status));
    const missing = months.filter((m) => !snaps?.get(`sales_status_month:${m}`)?.fetched_at);
    const status = statusOf(months);
    const groups = groupSales(status);
    const prev = prevMonths ? groupSales(statusOf(prevMonths)) : null;
    const summary = snap<SalesSummary>(snaps, summaryKey);

    const chart = lastMonths(13).map((m) => {
      const g = groupSales(snap<SalesStatus>(snaps, `sales_status_month:${m}`)?.por_status);
      return { label: monthLabel(m), efetiva: g.efetiva.total, aberta: g.aberta.total, perdida: g.perdida.total };
    });

    const history = snap<SalesStatus>(snaps, "sales_status:all");
    return { status, groups, prev, summary, chart, history, missing, months };
  }, [snaps, period, ym]);

  const ticket = d.groups.efetiva.qtd ? d.groups.efetiva.total / d.groups.efetiva.qtd : 0;
  const prevTicket = d.prev?.efetiva.qtd ? d.prev.efetiva.total / d.prev.efetiva.qtd : 0;
  const totalAll = d.groups.efetiva.total + d.groups.aberta.total + d.groups.perdida.total;
  const periodLabelText = options.find((o) => o.value === period)?.label ?? "";
  const vsText = d.prev ? `vs ${monthLabel(addMonths(period.slice(2), -1))}` : undefined;
  const historyGroups = groupSales(d.history?.por_status);

  return (
    <IuliShell
      title="Vendas"
      description={`${periodLabelText} · por competência da venda`}
      filters={<PeriodPicker value={period} options={options} onChange={setPeriod} />}
    >
      {d.missing.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Ainda buscando {d.missing.length} mês(es) deste período na IULI. Os totais abaixo vão completar sozinhos.
        </p>
      )}

      <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard info={S.effectiveSales()} label="Vendas efetivas" value={formatBRLShort(d.groups.efetiva.total)} change={d.prev ? delta(d.groups.efetiva.total, d.prev.efetiva.total) : undefined} sub={vsText} />
        <KpiCard
          info={S.salesCount()}
          label="Quantidade · ticket"
          value={formatInt(d.groups.efetiva.qtd)}
          change={d.prev ? delta(ticket, prevTicket) : undefined}
          sub={`ticket ${formatBRLShort(ticket)}`}
        />
        <KpiCard info={S.openSales()} label="Em aberto" value={formatBRLShort(d.groups.aberta.total)} sub={`${formatInt(d.groups.aberta.qtd)} vendas não pagas`} />
        <KpiCard
          info={S.lostSales()}
          label="Perdidas"
          value={formatBRLShort(d.groups.perdida.total)}
          sub={`${formatPct(totalAll ? d.groups.perdida.total / totalAll : null, 1)} do total · ${formatInt(d.groups.perdida.qtd)} vendas`}
          tone={totalAll && d.groups.perdida.total / totalAll > 0.1 ? "warn" : "default"}
        />
        <div className="col-span-2 lg:col-span-1">
          <KpiCard info={S.grossSales()} label="Total bruto (IULI)" value={formatBRLShort(d.summary?.total_vendas ?? totalAll)} sub={`${formatInt(d.summary?.quantidade ?? 0)} vendas, todos os status`} />
        </div>
      </section>

      <Panel title="Vendas por mês" info={S.salesChart()} action={<span className="text-sm text-muted-foreground">Últimos 13 meses · valor</span>}>
        <StackedMonthChart
          data={d.chart}
          format={formatBRLShort}
          series={[
            { key: "efetiva", label: SALE_GROUP_LABEL.efetiva, color: TONE.primary },
            { key: "aberta", label: SALE_GROUP_LABEL.aberta, color: TONE.amber },
            { key: "perdida", label: SALE_GROUP_LABEL.perdida, color: TONE.red },
          ]}
        />
      </Panel>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Produtos que mais venderam" info={S.topProducts()}>
          {d.summary?.top_produtos.length ? (
            <BarList
              items={d.summary.top_produtos.map((p) => ({
                key: p.produto,
                label: `${p.produto} · ${formatInt(p.qty)}`,
                value: p.total,
                display: formatBRLShort(p.total),
              }))}
            />
          ) : (
            <EmptyState>{d.summary ? "Sem vendas no período." : "Ainda buscando na IULI."}</EmptyState>
          )}
        </Panel>

        <Panel title="Clientes que mais compraram" info={S.topClients()}>
          {d.summary?.top_clientes.length ? (
            <div className="-mx-4 overflow-x-auto md:mx-0">
              <table className="w-full min-w-[420px] text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-4 py-2 font-medium md:pl-0">Cliente</th>
                    <th className="px-3 py-2 text-right font-medium">Vendas</th>
                    <th className="px-4 py-2 text-right font-medium md:pr-0">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {d.summary.top_clientes.map((c) => (
                    <tr key={c.client_id} className="border-b border-border/60 last:border-0">
                      <td className="max-w-64 truncate px-4 py-2.5 font-medium md:pl-0">{c.cliente}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatInt(c.qty)}</td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums md:pr-0">{formatBRL(c.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState>{d.summary ? "Sem vendas no período." : "Ainda buscando na IULI."}</EmptyState>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="Vendas por status no período" info={S.salesStatus()} className="xl:col-span-2">
          {d.status.length ? (
            <StatusTable rows={d.status} />
          ) : (
            <EmptyState>Sem vendas no período.</EmptyState>
          )}
        </Panel>

        <Panel title="Histórico completo" info={S.salesHistory()}>
          <div className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-muted-foreground">Vendas registradas</span>
              <span className="text-xl font-semibold tabular-nums">{formatInt(d.history?.total_encontrado ?? 0)}</span>
            </div>
            {(["efetiva", "aberta", "perdida"] as SaleGroup[]).map((g) => (
              <div key={g} className="flex items-center justify-between gap-2 text-sm">
                <StatusPill tone={GROUP_TONE[g]}>{SALE_GROUP_LABEL[g]}</StatusPill>
                <span className="tabular-nums">
                  {formatInt(historyGroups[g].qtd)} · <span className="font-semibold">{formatBRLShort(historyGroups[g].total)}</span>
                </span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </IuliShell>
  );
}

function StatusTable({ rows }: { rows: { status: string; qtd: number; total?: number }[] }) {
  const total = rows.reduce((a, r) => a + (r.total ?? 0), 0);
  return (
    <div className="-mx-4 overflow-x-auto md:mx-0">
      <table className="w-full min-w-[480px] text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr className="border-b border-border">
            <th className="px-4 py-2 font-medium md:pl-0">Status</th>
            <th className="px-3 py-2 font-medium">Grupo</th>
            <th className="px-3 py-2 text-right font-medium">Vendas</th>
            <th className="px-3 py-2 text-right font-medium">Valor</th>
            <th className="px-4 py-2 text-right font-medium md:pr-0">% do valor</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const g = saleGroupOf(r.status);
            return (
              <tr key={r.status} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-2.5 font-medium md:pl-0">{SALE_STATUS[r.status]?.label ?? r.status}</td>
                <td className="px-3 py-2.5">
                  <StatusPill tone={GROUP_TONE[g]}>{SALE_GROUP_LABEL[g]}</StatusPill>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{formatInt(r.qtd)}</td>
                <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{formatBRL(r.total ?? 0)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums md:pr-0">{formatPct(total ? (r.total ?? 0) / total : null, 1)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
