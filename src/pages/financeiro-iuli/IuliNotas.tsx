import { useMemo } from "react";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { currentYM, formatBRL, formatInt, formatPct, monthLabel } from "@/lib/commercial";
import { companyHasTool, formatDateTime, groupSales, useIuliIntegration, INVOICE_STATUS, invoiceLabel, lastMonths, snap, useIuliSnapshots, type Invoices, type SalesStatus } from "@/lib/iuli";
import { IULI_SOURCES as S } from "@/lib/iuliSources";
import { EmptyState, KpiCard, Panel, ProgressBar } from "@/components/commercial/CommercialUI";
import { IuliShell, StackedMonthChart, StatusPill } from "@/components/iuli/IuliUI";
import { TONE } from "@/components/iuli/iuliTheme";

const count = (inv: Invoices | null, statuses: string[]) =>
  (inv?.por_status ?? []).filter((r) => statuses.includes(r.status)).reduce((a, r) => a + r.qtd, 0);

const BAD = ["negada", "cancelamento_negado"];
const CANCEL = ["cancelada", "solicitando_cancelamento"];

export default function IuliNotas() {
  const { workspace } = useWorkspace();
  const { data: snaps } = useIuliSnapshots(workspace?.id);
  const { data: company } = useIuliIntegration(workspace?.id);
  const ym = currentYM();

  const d = useMemo(() => {
    const all = snap<Invoices>(snaps, "invoices:all");
    const denied = snap<Invoices>(snaps, "invoices:denied");
    const months = lastMonths(13).map((m) => {
      const inv = snap<Invoices>(snaps, `invoices_month:${m}`);
      const sales = snap<SalesStatus>(snaps, `sales_status_month:${m}`);
      const total = (inv?.por_status ?? []).reduce((a, r) => a + r.qtd, 0);
      const autorizada = count(inv, ["autorizada"]);
      const negada = count(inv, BAD);
      const cancelada = count(inv, CANCEL);
      return {
        month: m,
        label: monthLabel(m),
        autorizada,
        negada,
        cancelada,
        outras: total - autorizada - negada - cancelada,
        vendas: sales ? groupSales(sales.por_status).efetiva.qtd : null,
      };
    });
    return { all, denied, months };
  }, [snaps]);

  const total = (d.all?.por_status ?? []).reduce((a, r) => a + r.qtd, 0);
  const autorizadas = count(d.all, ["autorizada"]);
  const negadas = count(d.all, BAD);
  const canceladas = count(d.all, CANCEL);
  const thisMonth = d.months.find((m) => m.month === ym);

  if (companyHasTool(company, "list_invoices") === false) {
    return (
      <IuliShell title="Notas Fiscais" description="Notas emitidas pela IULI · datas pela criação da nota">
        <EmptyState>
          O token da empresa {company?.label ?? "selecionada"} não libera a função de notas fiscais (list_invoices). Para ver esta tela, libere essa função no
          painel da IULI (Configurações → Integrações → MCP do Iuli) e rode o diagnóstico em Integrações.
        </EmptyState>
      </IuliShell>
    );
  }

  return (
    <IuliShell title="Notas Fiscais" description="Notas emitidas pela IULI · datas pela criação da nota">
      <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard info={S.invoicesStatus()} label="Autorizadas (histórico)" value={formatInt(autorizadas)} sub={`de ${formatInt(total)} emitidas`} loading={!d.all} />
        <KpiCard
          info={S.invoicesStatus()}
          label="Negadas"
          value={formatInt(negadas)}
          sub={`${formatPct(total ? negadas / total : null, 1)} das notas · emissão ou cancelamento`}
          tone={total && negadas / total > 0.05 ? "warn" : "default"}
          loading={!d.all}
        />
        <KpiCard info={S.invoicesStatus()} label="Canceladas" value={formatInt(canceladas)} sub="inclui pedidos de cancelamento" loading={!d.all} />
        <KpiCard
          info={S.invoiceCoverage()}
          label={`Notas em ${monthLabel(ym)}`}
          value={formatInt(thisMonth?.autorizada ?? 0)}
          sub={thisMonth?.vendas != null ? `para ${formatInt(thisMonth.vendas)} vendas efetivas` : "autorizadas no mês"}
        />
      </section>

      <Panel title="Notas por mês" info={S.invoicesMonthly()} action={<span className="text-sm text-muted-foreground">Últimos 13 meses · quantidade</span>}>
        <StackedMonthChart
          data={d.months}
          format={(v) => formatInt(v)}
          series={[
            { key: "autorizada", label: "Autorizadas", color: TONE.primary },
            { key: "cancelada", label: "Canceladas", color: TONE.muted },
            { key: "negada", label: "Negadas", color: TONE.red },
            { key: "outras", label: "Outras", color: TONE.amber },
          ]}
        />
      </Panel>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Panel title="Vendas efetivas × notas autorizadas" info={S.invoiceCoverage()} className="xl:col-span-2">
          <ul className="flex flex-col gap-3">
            {[...d.months].reverse().map((m) => {
              const ratio = m.vendas ? m.autorizada / m.vendas : null;
              return (
                <li key={m.month} className="flex flex-col gap-1.5">
                  <div className="flex justify-between gap-2 text-sm">
                    <span>{monthLabel(m.month, true)}</span>
                    <span className="tabular-nums">
                      {formatInt(m.autorizada)} notas / {m.vendas == null ? "—" : formatInt(m.vendas)} vendas
                    </span>
                  </div>
                  <ProgressBar ratio={ratio} />
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel title="Notas negadas — motivo" info={S.invoicesDenied()} className="xl:col-span-3">
          {d.denied?.itens?.length ? (
            <ul className="flex flex-col divide-y divide-border">
              {d.denied.itens.map((n) => (
                <li key={n.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="font-medium">
                      NF {n.numero ?? "s/nº"} · {formatBRL(n.valor)}
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
            <EmptyState>{d.denied ? "Nenhuma nota negada." : "Ainda buscando na IULI."}</EmptyState>
          )}
        </Panel>
      </div>
    </IuliShell>
  );
}
