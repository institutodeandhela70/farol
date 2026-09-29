import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { addMonths, currentYM, delta, formatBRL, formatBRLShort, formatInt, formatPct, monthLabel } from "@/lib/commercial";
import {
  groupSales,
  invoiceLabel,
  INVOICE_STATUS,
  lastMonths,
  snap,
  useIuliSnapshots,
  type Invoices,
  type Receivable,
  type SalesStatus,
  type SalesSummary,
  type Subscriptions,
} from "@/lib/iuli";
import { IULI_SOURCES as S } from "@/lib/iuliSources";
import { BarList, EmptyState, KpiCard, Panel, WarnNote } from "@/components/commercial/CommercialUI";
import { GroupedMonthChart, IuliShell, StatusPill } from "@/components/iuli/IuliUI";
import { TONE } from "@/components/iuli/iuliTheme";

export default function IuliVisaoGeral() {
  const { workspace } = useWorkspace();
  const { data: snaps } = useIuliSnapshots(workspace?.id);
  const ym = currentYM();
  const prev = addMonths(ym, -1);

  const d = useMemo(() => {
    const statusNow = snap<SalesStatus>(snaps, `sales_status_month:${ym}`);
    const statusPrev = snap<SalesStatus>(snaps, `sales_status_month:${prev}`);
    const now = groupSales(statusNow?.por_status);
    const before = groupSales(statusPrev?.por_status);
    const summary = snap<SalesSummary>(snaps, `sales_month:${ym}`);
    const ar = snap<Receivable>(snaps, "ar:overview");
    const arNow = snap<Receivable>(snaps, `ar_month:${ym}`);
    const arPrev = snap<Receivable>(snaps, `ar_month:${prev}`);
    const invoices = snap<Invoices>(snaps, "invoices:all");
    const subs = snap<Subscriptions>(snaps, "subscriptions:all");

    const chart = lastMonths(6).map((m) => {
      const s = groupSales(snap<SalesStatus>(snaps, `sales_status_month:${m}`)?.por_status);
      const r = snap<Receivable>(snaps, `ar_month:${m}`);
      return { month: m, label: monthLabel(m), vendas: s.efetiva.total, recebido: r?.total_recebidas ?? 0 };
    });

    const invoiceTotal = (invoices?.por_status ?? []).reduce((a, r) => a + r.qtd, 0);
    const invoiceBad = (invoices?.por_status ?? []).filter((r) => INVOICE_STATUS[r.status]?.tone === "bad").reduce((a, r) => a + r.qtd, 0);
    const odd = subs?.por_status.find((s) => s.status === "1");

    return { statusNow, now, before, summary, ar, arNow, arPrev, invoices, invoiceTotal, invoiceBad, subs, odd, chart };
  }, [snaps, ym, prev]);

  const overdueRatio = d.ar && d.ar.total_a_receber ? d.ar.total_vencidas / d.ar.total_a_receber : null;
  const ticket = d.now.efetiva.qtd ? d.now.efetiva.total / d.now.efetiva.qtd : 0;
  const grossGap = d.summary ? d.summary.total_vendas - d.now.efetiva.total : 0;

  return (
    <IuliShell title="Visão Geral" description={`${monthLabel(ym, true)} · vendas por competência, recebimentos por vencimento`}>
      <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          info={S.effectiveSales()}
          label="Vendas efetivas no mês"
          value={formatBRLShort(d.now.efetiva.total)}
          change={delta(d.now.efetiva.total, d.before.efetiva.total)}
          sub={`vs ${monthLabel(prev)}`}
          loading={!d.statusNow}
        />
        <KpiCard
          info={S.salesCount()}
          label="Vendas efetivas"
          value={formatInt(d.now.efetiva.qtd)}
          change={delta(d.now.efetiva.qtd, d.before.efetiva.qtd)}
          sub={`ticket ${formatBRLShort(ticket)}`}
          loading={!d.statusNow}
        />
        <KpiCard
          info={S.received()}
          label="Recebido no mês"
          value={formatBRLShort(d.arNow?.total_recebidas ?? 0)}
          change={delta(d.arNow?.total_recebidas ?? 0, d.arPrev?.total_recebidas ?? 0)}
          sub="títulos que vencem no mês"
          loading={!d.arNow}
        />
        <KpiCard
          info={S.receivablePending()}
          label="A receber (sem baixa)"
          value={formatBRLShort(d.ar?.total_a_receber ?? 0)}
          sub={`${formatInt(d.ar?.quantidade ?? 0)} títulos`}
          loading={!d.ar}
        />
        <KpiCard
          info={S.receivableOverdue()}
          label="Vencido sem baixa"
          value={formatBRLShort(d.ar?.total_vencidas ?? 0)}
          sub={`${formatPct(overdueRatio)} do a receber`}
          tone={overdueRatio !== null && overdueRatio > 0.3 ? "warn" : "default"}
          loading={!d.ar}
        />
        <KpiCard
          info={S.subscriptionsTotal()}
          label="Assinaturas"
          value={formatInt(d.subs?.total_encontrado ?? 0)}
          sub={`MRR declarado ${formatBRLShort((d.subs?.por_status ?? []).reduce((a, s) => a + s.mrr, 0))}`}
          loading={!d.subs}
        />
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel
          title="Vendas × recebimentos"
          info={S.salesChart()}
          action={<span className="text-sm text-muted-foreground">Últimos 6 meses</span>}
          className="xl:col-span-2"
        >
          <GroupedMonthChart
            data={d.chart}
            series={[
              { key: "vendas", label: "Vendas efetivas", color: TONE.primary },
              { key: "recebido", label: "Recebido", color: TONE.blue },
            ]}
            format={formatBRLShort}
            tooltipFormat={formatBRL}
          />
        </Panel>

        <Panel title="Qualidade dos dados" info={S.dataQuality()}>
          <div className="flex flex-col gap-3">
            {overdueRatio !== null && overdueRatio > 0.3 && (
              <WarnNote>
                <strong>{formatBRLShort(d.ar!.total_vencidas)}</strong> ({formatPct(overdueRatio)} do a receber) estão vencidos sem baixa, a maior parte há mais de um ano. Provavelmente são baixas não registradas na IULI.{" "}
                <Link to="/iuli/receber" className="font-medium underline">Ver aging</Link>
              </WarnNote>
            )}
            {d.odd && d.subs && d.odd.qtd / Math.max(1, d.subs.total_encontrado) > 0.5 && (
              <WarnNote>
                <strong>{formatInt(d.odd.qtd)} de {formatInt(d.subs.total_encontrado)}</strong> assinaturas estão com status "1", nem ativa nem cancelada. O MRR declarado não é confiável.
              </WarnNote>
            )}
            {grossGap > 0 && (
              <WarnNote>
                O total de vendas da IULI no mês ({formatBRLShort(d.summary!.total_vendas)}) inclui <strong>{formatBRLShort(grossGap)}</strong> em vendas canceladas, reembolsadas ou só iniciadas. Aqui a gente usa só as efetivas.
              </WarnNote>
            )}
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel
          title="Produtos que mais venderam no mês"
          info={S.topProducts()}
          action={<Link to="/iuli/vendas" className="text-sm font-medium text-primary hover:underline">Ver vendas</Link>}
          className="xl:col-span-2"
        >
          {d.summary?.top_produtos.length ? (
            <BarList
              items={d.summary.top_produtos.slice(0, 6).map((p) => ({
                key: p.produto,
                label: `${p.produto} · ${formatInt(p.qty)}`,
                value: p.total,
                display: formatBRLShort(p.total),
              }))}
            />
          ) : (
            <EmptyState>Sem vendas no mês.</EmptyState>
          )}
        </Panel>

        <Panel
          title="Notas fiscais"
          info={S.invoicesStatus()}
          action={<Link to="/iuli/notas" className="text-sm font-medium text-primary hover:underline">Ver notas</Link>}
        >
          <div className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-muted-foreground">Emitidas no histórico</span>
              <span className="text-xl font-semibold tabular-nums">{formatInt(d.invoiceTotal)}</span>
            </div>
            <ul className="flex flex-col gap-2">
              {(d.invoices?.por_status ?? []).map((r) => (
                <li key={r.status} className="flex items-center justify-between gap-2 text-sm">
                  <StatusPill tone={INVOICE_STATUS[r.status]?.tone ?? "neutral"}>{invoiceLabel(r.status)}</StatusPill>
                  <span className="tabular-nums">{formatInt(r.qtd)}</span>
                </li>
              ))}
            </ul>
            {d.invoiceBad > 0 && (
              <p className="text-xs text-muted-foreground">
                {formatPct(d.invoiceBad / Math.max(1, d.invoiceTotal), 1)} das notas tiveram emissão ou cancelamento negado.
              </p>
            )}
          </div>
        </Panel>
      </div>
    </IuliShell>
  );
}
