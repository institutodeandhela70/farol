import { useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { delta, formatBRL, formatBRLShort, formatInt, formatPct } from "@/lib/commercial";
import { companyHasTool, INVOICE_STATUS, invoiceLabel, useIuliCompanies } from "@/lib/iuli";
import {
  bucketLabel,
  bucketsBetween,
  sumBy,
  useInvoicesAgg,
  useReceivablesFlow,
  useReceivablesPosition,
  useSalesAgg,
  useSalesTop,
  useSubscriptionsAgg,
  type SalesAggRow,
} from "@/lib/iuliData";
import { periodText, previousRange, useIuliFilters } from "@/lib/iuliFilters";
import { IULI_SOURCES as S } from "@/lib/iuliSources";
import { BarList, EmptyState, KpiCard, LoadingBlock, Panel, WarnNote } from "@/components/commercial/CommercialUI";
import { GroupedMonthChart, IuliShell, StatusPill } from "@/components/iuli/IuliUI";
import { TONE } from "@/components/iuli/iuliTheme";
import { CompanyFilter, IntercompanyToggle, PeriodFilter } from "@/components/iuli/IuliFilterBar";

export default function IuliVisaoGeral() {
  const { workspace } = useWorkspace();
  const ws = workspace?.id;
  const location = useLocation();
  const { filters, set } = useIuliFilters();
  const { data: companies = [] } = useIuliCompanies(ws);
  const prev = previousRange(filters.from, filters.to);
  const filtersNoIE = { ...filters, entreEmpresas: "incluir" as const };

  const sales = useSalesAgg(ws, filters);
  const salesPrev = useSalesAgg(ws, filters, { range: prev });
  const salesSeries = useSalesAgg(ws, filters, { grain: true });
  const flow = useReceivablesFlow(ws, filters);
  const flowPrev = useReceivablesFlow(ws, filters, { range: prev });
  const flowSeries = useReceivablesFlow(ws, filters, { grain: true });
  const position = useReceivablesPosition(ws, filters);
  const positionWithIE = useReceivablesPosition(ws, filtersNoIE);
  const products = useSalesTop(ws, filters, "produto", 6);
  const invoices = useInvoicesAgg(ws, filters);
  const subsNew = useSubscriptionsAgg(ws, filters, { period: true });
  const subsAll = useSubscriptionsAgg(ws, filters);

  const k = useMemo(() => {
    const eff = (rows: SalesAggRow[] | undefined) => ({
      qtd: sumBy(rows, (r) => r.qtd, (r) => r.grupo === "efetiva"),
      total: sumBy(rows, (r) => r.total, (r) => r.grupo === "efetiva"),
    });
    const pos = position.data ?? [];
    const vencido = sumBy(pos, (p) => p.total, (p) => p.faixa.startsWith("vencido"));
    const aberto = sumBy(pos, (p) => p.total);
    const velho = pos.find((p) => p.faixa === "vencido_365_mais")?.total ?? 0;
    const bruto = sumBy(sales.data, (r) => r.total);
    const subsTotal = sumBy(subsAll.data, (r) => r.qtd);
    return {
      now: eff(sales.data),
      before: eff(salesPrev.data),
      bruto,
      recebido: sumBy(flow.data, (r) => r.total, (r) => r.serie === "recebido"),
      recebidoPrev: sumBy(flowPrev.data, (r) => r.total, (r) => r.serie === "recebido"),
      aberto,
      vencido,
      velho,
      abertoEntreEmpresas: sumBy(positionWithIE.data, (p) => p.total) - aberto,
      novas: sumBy(subsNew.data, (r) => r.qtd),
      novasMensal: sumBy(subsNew.data, (r) => r.mensal),
      subsTotal,
      subsOdd: sumBy(subsAll.data, (r) => r.qtd, (r) => r.status === "1"),
      invoiceTotal: sumBy(invoices.data, (r) => r.qtd),
      invoiceBad: sumBy(invoices.data, (r) => r.qtd, (r) => INVOICE_STATUS[r.status]?.tone === "bad"),
    };
  }, [sales.data, salesPrev.data, flow.data, flowPrev.data, position.data, positionWithIE.data, subsNew.data, subsAll.data, invoices.data]);

  const chart = useMemo(() => {
    const v = new Map<string, number>();
    for (const r of salesSeries.data ?? []) if (r.bucket && r.grupo === "efetiva") v.set(r.bucket, (v.get(r.bucket) ?? 0) + r.total);
    const rec = new Map<string, number>();
    for (const r of flowSeries.data ?? []) if (r.bucket && r.serie === "recebido") rec.set(r.bucket, (rec.get(r.bucket) ?? 0) + r.total);
    return bucketsBetween(filters.from, filters.to, filters.grain).map((b) => ({ label: bucketLabel(b, filters.grain), vendas: v.get(b) ?? 0, recebido: rec.get(b) ?? 0 }));
  }, [salesSeries.data, flowSeries.data, filters.from, filters.to, filters.grain]);

  const byInvoiceStatus = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of invoices.data ?? []) map.set(r.status, (map.get(r.status) ?? 0) + r.qtd);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [invoices.data]);

  const unknown = products.data?.find((p) => p.nome === "(não identificado)");
  const overdueRatio = k.aberto ? k.vencido / k.aberto : null;
  const ticket = k.now.qtd ? k.now.total / k.now.qtd : 0;
  const inScope = filters.empresa === "todas" ? companies : companies.filter((c) => c.id === filters.empresa);
  const invoicesAvailable = inScope.some((c) => companyHasTool(c, "list_invoices") !== false);
  const link = (pathname: string) => ({ pathname, search: location.search });
  const grainText = filters.grain === "day" ? "por dia" : filters.grain === "week" ? "por semana" : "por mês";

  return (
    <IuliShell
      title="Visão Geral"
      description={`${periodText(filters.preset, filters.from, filters.to)} · vendas por competência, recebimentos pela data do pagamento`}
      scope={filters.empresa}
      filters={
        <>
          <PeriodFilter filters={filters} set={set} />
          <CompanyFilter filters={filters} set={set} />
          <IntercompanyToggle filters={filters} set={set} />
        </>
      }
    >
      <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard info={S.effectiveSales()} label="Vendas efetivas" value={formatBRLShort(k.now.total)} change={delta(k.now.total, k.before.total)} sub="vs período anterior" loading={sales.isLoading} />
        <KpiCard info={S.salesCount()} label="Vendas efetivas" value={formatInt(k.now.qtd)} change={delta(k.now.qtd, k.before.qtd)} sub={`ticket ${formatBRLShort(ticket)}`} loading={sales.isLoading} />
        <KpiCard info={S.receivedByPayment()} label="Recebido no período" value={formatBRLShort(k.recebido)} change={delta(k.recebido, k.recebidoPrev)} sub="pela data do pagamento" loading={flow.isLoading} />
        <KpiCard info={S.receivablePending()} label="A receber hoje" value={formatBRLShort(k.aberto)} sub="sem baixa, qualquer vencimento" loading={position.isLoading} />
        <KpiCard
          info={S.receivableOverdue()}
          label="Vencido sem baixa"
          value={formatBRLShort(k.vencido)}
          sub={`${formatPct(overdueRatio)} do a receber`}
          tone={overdueRatio !== null && overdueRatio > 0.3 ? "warn" : "default"}
          loading={position.isLoading}
        />
        <KpiCard info={S.subscriptionsByMonth()} label="Novas assinaturas" value={formatInt(k.novas)} sub={`${formatBRLShort(k.novasMensal)}/mês no período`} loading={subsNew.isLoading} />
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="Vendas × recebimentos" info={S.salesVsReceived()} action={<span className="text-sm text-muted-foreground">{grainText}</span>} className="xl:col-span-2">
          {salesSeries.isLoading || flowSeries.isLoading ? (
            <LoadingBlock className="h-64" />
          ) : (
            <GroupedMonthChart
              data={chart}
              format={formatBRLShort}
              tooltipFormat={formatBRL}
              series={[
                { key: "vendas", label: "Vendas efetivas", color: TONE.primary },
                { key: "recebido", label: "Recebido", color: TONE.blue },
              ]}
            />
          )}
        </Panel>

        <Panel title="Qualidade dos dados" info={S.dataQuality()}>
          <div className="flex flex-col gap-3">
            {k.velho > 0 && k.vencido > 0 && k.velho / k.vencido > 0.5 && (
              <WarnNote>
                <strong>{formatBRLShort(k.velho)}</strong> do vencido tem mais de um ano sem baixa — provavelmente baixas não registradas na IULI.{" "}
                <Link to={link("/iuli/receber")} className="font-medium underline">Ver aging</Link>
              </WarnNote>
            )}
            {k.subsTotal > 0 && k.subsOdd / k.subsTotal > 0.5 && (
              <WarnNote>
                <strong>{formatInt(k.subsOdd)} de {formatInt(k.subsTotal)}</strong> assinaturas estão com status "1" (nem ativa nem cancelada) — o MRR não é confiável.
              </WarnNote>
            )}
            {unknown && k.bruto > 0 && unknown.total / k.bruto > 0.3 && (
              <WarnNote>
                {formatPct(unknown.total / k.bruto)} do valor vendido no período está sem produto identificado (vendas que não vieram da Hubla nem da TMB).
              </WarnNote>
            )}
            {filters.empresa === "todas" && filters.entreEmpresas === "excluir" && k.abertoEntreEmpresas > 0 && (
              <p className="text-xs text-muted-foreground">
                Fora do consolidado: {formatBRLShort(k.abertoEntreEmpresas)} a receber entre as próprias empresas do grupo.
              </p>
            )}
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="Produtos que mais venderam" info={S.topProducts()} action={<Link to={link("/iuli/vendas")} className="text-sm font-medium text-primary hover:underline">Ver vendas</Link>} className="xl:col-span-2">
          {products.isLoading ? (
            <LoadingBlock />
          ) : products.data?.length ? (
            <BarList items={products.data.map((p) => ({ key: p.nome, label: `${p.nome} · ${formatInt(p.qtd)}`, value: p.total, display: formatBRLShort(p.total) }))} />
          ) : (
            <EmptyState>Sem vendas no período.</EmptyState>
          )}
        </Panel>

        <Panel title="Notas fiscais no período" info={S.invoicesStatus()} action={<Link to={link("/iuli/notas")} className="text-sm font-medium text-primary hover:underline">Ver notas</Link>}>
          {!invoicesAvailable ? (
            <EmptyState>O token desta empresa não libera notas fiscais.</EmptyState>
          ) : invoices.isLoading ? (
            <LoadingBlock />
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-muted-foreground">Emitidas</span>
                <span className="text-xl font-semibold tabular-nums">{formatInt(k.invoiceTotal)}</span>
              </div>
              <ul className="flex flex-col gap-2">
                {byInvoiceStatus.map(([status, qtd]) => (
                  <li key={status} className="flex items-center justify-between gap-2 text-sm">
                    <StatusPill tone={INVOICE_STATUS[status]?.tone ?? "neutral"}>{invoiceLabel(status)}</StatusPill>
                    <span className="tabular-nums">{formatInt(qtd)}</span>
                  </li>
                ))}
              </ul>
              {k.invoiceBad > 0 && <p className="text-xs text-muted-foreground">{formatPct(k.invoiceBad / Math.max(1, k.invoiceTotal), 1)} tiveram emissão ou cancelamento negado.</p>}
            </div>
          )}
        </Panel>
      </div>
    </IuliShell>
  );
}
