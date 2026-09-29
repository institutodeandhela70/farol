import { useMemo } from "react";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { delta, formatBRL, formatInt, formatPct } from "@/lib/commercial";
import { companyHasTool, formatDateTime, INVOICE_STATUS, invoiceLabel, useIuliCompanies } from "@/lib/iuli";
import { bucketLabel, bucketsBetween, sumBy, useInvoicesAgg, useInvoicesList, useSalesAgg, type InvoiceAggRow } from "@/lib/iuliData";
import { periodText, previousRange, useIuliFilters } from "@/lib/iuliFilters";
import { IULI_SOURCES as S } from "@/lib/iuliSources";
import { EmptyState, KpiCard, LoadingBlock, Panel, WarnNote } from "@/components/commercial/CommercialUI";
import { GroupedMonthChart, IuliShell, StackedMonthChart, StatusPill } from "@/components/iuli/IuliUI";
import { TONE } from "@/components/iuli/iuliTheme";
import { ClearFilters, CompanyFilter, OptionFilter, PeriodFilter } from "@/components/iuli/IuliFilterBar";

const BAD = ["negada", "cancelamento_negado"];
const CANCEL = ["cancelada", "solicitando_cancelamento"];

export default function IuliNotas() {
  const { workspace } = useWorkspace();
  const ws = workspace?.id;
  const { filters, set } = useIuliFilters();
  const { data: companies = [] } = useIuliCompanies(ws);
  const prev = previousRange(filters.from, filters.to);

  const inScope = filters.empresa === "todas" ? companies : companies.filter((c) => c.id === filters.empresa);
  const withoutTool = inScope.filter((c) => companyHasTool(c, "list_invoices") === false);

  const agg = useInvoicesAgg(ws, filters);
  const aggPrev = useInvoicesAgg(ws, filters, { range: prev });
  const series = useInvoicesAgg(ws, filters, { grain: true });
  // Vendas efetivas no mesmo recorte (sem filtros de venda) — pra comparar com notas autorizadas.
  const sales = useSalesAgg(ws, { ...filters, cliente: null, status: null, produto: null, origem: null }, { grain: true });
  const denied = useInvoicesList(ws, filters, BAD, 30);

  const k = useMemo(() => {
    const c = (rows: InvoiceAggRow[] | undefined, statuses?: string[]) => sumBy(rows, (r) => r.qtd, (r) => !statuses || statuses.includes(r.status));
    const byStatus = new Map<string, { qtd: number; total: number }>();
    for (const r of agg.data ?? []) {
      const cur = byStatus.get(r.status) ?? { qtd: 0, total: 0 };
      cur.qtd += r.qtd;
      cur.total += r.total;
      byStatus.set(r.status, cur);
    }
    return {
      total: c(agg.data),
      totalPrev: c(aggPrev.data),
      autorizadas: c(agg.data, ["autorizada"]),
      valorAutorizado: sumBy(agg.data, (r) => r.total, (r) => r.status === "autorizada"),
      negadas: c(agg.data, BAD),
      canceladas: c(agg.data, CANCEL),
      byStatus: [...byStatus.entries()].sort((a, b) => b[1].qtd - a[1].qtd),
    };
  }, [agg.data, aggPrev.data]);

  const chart = useMemo(() => {
    const map = new Map<string, { autorizada: number; negada: number; cancelada: number; outras: number }>();
    for (const r of series.data ?? []) {
      if (!r.bucket) continue;
      const cur = map.get(r.bucket) ?? { autorizada: 0, negada: 0, cancelada: 0, outras: 0 };
      if (r.status === "autorizada") cur.autorizada += r.qtd;
      else if (BAD.includes(r.status)) cur.negada += r.qtd;
      else if (CANCEL.includes(r.status)) cur.cancelada += r.qtd;
      else cur.outras += r.qtd;
      map.set(r.bucket, cur);
    }
    const salesMap = new Map<string, number>();
    for (const r of sales.data ?? []) if (r.bucket && r.grupo === "efetiva") salesMap.set(r.bucket, (salesMap.get(r.bucket) ?? 0) + r.qtd);
    return bucketsBetween(filters.from, filters.to, filters.grain).map((b) => {
      const v = map.get(b) ?? { autorizada: 0, negada: 0, cancelada: 0, outras: 0 };
      return { label: bucketLabel(b, filters.grain), ...v, vendas: salesMap.get(b) ?? 0 };
    });
  }, [series.data, sales.data, filters.from, filters.to, filters.grain]);

  const allWithout = inScope.length > 0 && withoutTool.length === inScope.length;
  const grainText = filters.grain === "day" ? "por dia" : filters.grain === "week" ? "por semana" : "por mês";

  return (
    <IuliShell
      title="Notas Fiscais"
      description={`${periodText(filters.preset, filters.from, filters.to)} · pela data de criação da nota`}
      scope={filters.empresa}
      filters={
        <>
          <PeriodFilter filters={filters} set={set} />
          <CompanyFilter filters={filters} set={set} />
          <OptionFilter
            label="Status da nota"
            allLabel="Todos os status"
            param="nstatus"
            value={filters.notaStatus}
            set={set}
            options={Object.keys(INVOICE_STATUS).map((value) => ({ value, label: invoiceLabel(value) }))}
          />
          <ClearFilters filters={filters} set={set} />
        </>
      }
    >
      {withoutTool.length > 0 && (
        <WarnNote>
          O token de {withoutTool.map((c) => c.label).join(" e ")} não libera notas fiscais (list_invoices)
          {allWithout ? "." : " — os números abaixo são só das outras empresas."} Pra incluir, libere essa função no painel da IULI (MCP do Iuli).
        </WarnNote>
      )}

      {!allWithout && (
        <>
          <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard info={S.invoicesStatus()} label="Notas emitidas" value={formatInt(k.total)} change={delta(k.total, k.totalPrev)} sub="vs período anterior" loading={agg.isLoading} />
            <KpiCard info={S.invoicesStatus()} label="Autorizadas" value={formatInt(k.autorizadas)} sub={formatBRL(k.valorAutorizado)} loading={agg.isLoading} />
            <KpiCard
              info={S.invoicesStatus()}
              label="Negadas"
              value={formatInt(k.negadas)}
              sub={`${formatPct(k.total ? k.negadas / k.total : null, 1)} · emissão ou cancelamento`}
              tone={k.total && k.negadas / k.total > 0.05 ? "warn" : "default"}
              loading={agg.isLoading}
            />
            <KpiCard info={S.invoicesStatus()} label="Canceladas" value={formatInt(k.canceladas)} sub="inclui pedidos de cancelamento" loading={agg.isLoading} />
          </section>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Panel title="Notas no período" info={S.invoicesMonthly()} action={<span className="text-sm text-muted-foreground">Quantidade {grainText}</span>}>
              {series.isLoading ? (
                <LoadingBlock className="h-72" />
              ) : (
                <StackedMonthChart
                  data={chart}
                  format={(v) => formatInt(v)}
                  series={[
                    { key: "autorizada", label: "Autorizadas", color: TONE.primary },
                    { key: "cancelada", label: "Canceladas", color: TONE.muted },
                    { key: "negada", label: "Negadas", color: TONE.red },
                    { key: "outras", label: "Outras", color: TONE.amber },
                  ]}
                />
              )}
            </Panel>
            <Panel title="Vendas efetivas × notas autorizadas" info={S.invoiceCoverage()} action={<span className="text-sm text-muted-foreground">Quantidade {grainText}</span>}>
              {series.isLoading || sales.isLoading ? (
                <LoadingBlock className="h-72" />
              ) : (
                <GroupedMonthChart
                  data={chart}
                  format={(v) => formatInt(v)}
                  height="h-72"
                  series={[
                    { key: "vendas", label: "Vendas efetivas", color: TONE.blue },
                    { key: "autorizada", label: "Notas autorizadas", color: TONE.primary },
                  ]}
                />
              )}
            </Panel>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
            <Panel title="Por status" info={S.invoicesStatus()} className="xl:col-span-2">
              {k.byStatus.length ? (
                <ul className="flex flex-col gap-2.5">
                  {k.byStatus.map(([status, v]) => (
                    <li key={status} className="flex items-center justify-between gap-2 text-sm">
                      <StatusPill tone={INVOICE_STATUS[status]?.tone ?? "neutral"}>{invoiceLabel(status)}</StatusPill>
                      <span className="tabular-nums">
                        {formatInt(v.qtd)} · <span className="font-semibold">{formatBRL(v.total)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState>Nenhuma nota no período.</EmptyState>
              )}
            </Panel>

            <Panel title="Notas negadas no período — motivo" info={S.invoicesDenied()} className="xl:col-span-3">
              {denied.isLoading ? (
                <LoadingBlock />
              ) : denied.data?.rows.length ? (
                <ul className="flex flex-col divide-y divide-border">
                  {denied.data.rows.map((n) => (
                    <li key={`${n.empresa}-${n.iuli_id}`} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span className="font-medium">
                          NF {n.numero ?? "s/nº"} · {formatBRL(n.valor)}
                          {filters.empresa === "todas" && <span className="ml-1.5 font-normal text-muted-foreground">· {n.empresa}</span>}
                        </span>
                        <div className="flex items-center gap-2">
                          <StatusPill tone={INVOICE_STATUS[n.status]?.tone ?? "neutral"}>{invoiceLabel(n.status)}</StatusPill>
                          <span className="text-xs text-muted-foreground">{formatDateTime(n.criada_em)}</span>
                        </div>
                      </div>
                      <p className="text-sm leading-relaxed text-muted-foreground">{n.detalhe_status?.trim() || "Sem mensagem de erro."}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState>Nenhuma nota negada no período.</EmptyState>
              )}
            </Panel>
          </div>
        </>
      )}
    </IuliShell>
  );
}
