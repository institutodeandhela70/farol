import { useMemo } from "react";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { addMonths, currentYM, delta, formatBRL, formatBRLShort, formatInt, formatPct, monthLabel } from "@/lib/commercial";
import {
  CYCLE_LABEL,
  formatDate,
  lastMonths,
  snap,
  SUBSCRIPTION_STATUS_LABEL,
  useIuliSnapshots,
  type SubscriptionGroup,
  type Subscriptions,
} from "@/lib/iuli";
import { IULI_SOURCES as S } from "@/lib/iuliSources";
import { BarList, EmptyState, KpiCard, Panel, WarnNote } from "@/components/commercial/CommercialUI";
import { IuliShell, StackedMonthChart } from "@/components/iuli/IuliUI";
import { TONE } from "@/components/iuli/iuliTheme";

export default function IuliAssinaturas() {
  const { workspace } = useWorkspace();
  const { data: snaps } = useIuliSnapshots(workspace?.id);
  const subs = snap<Subscriptions>(snaps, "subscriptions:all");
  const ym = currentYM();

  const d = useMemo(() => {
    const byMonth = new Map((subs?.por_mes_criacao ?? []).map((g) => [g.key, g]));
    const chart = lastMonths(13).map((m) => ({
      label: monthLabel(m),
      qtd: byMonth.get(m)?.qtd ?? 0,
      valor: byMonth.get(m)?.valor_mensalizado ?? 0,
    }));
    const mrr = (subs?.por_status ?? []).reduce((a, s) => a + s.mrr, 0);
    const odd = subs?.por_status.find((s) => s.status === "1");
    return { byMonth, chart, mrr, odd };
  }, [subs]);

  const now = d.byMonth.get(ym);
  const before = d.byMonth.get(addMonths(ym, -1));
  const total = subs?.total_encontrado ?? 0;

  return (
    <IuliShell title="Assinaturas" description="Assinaturas e recorrências cadastradas na IULI">
      <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard info={S.subscriptionsTotal()} label="Assinaturas" value={formatInt(total)} sub={`${formatInt(subs?.por_produto.length ?? 0)} produtos`} loading={!subs} />
        <KpiCard
          info={S.mrr()}
          label="MRR declarado"
          value={formatBRLShort(d.mrr)}
          sub="teto — status não confiável"
          tone={d.odd && d.odd.qtd / Math.max(1, total) > 0.5 ? "warn" : "default"}
          loading={!subs}
        />
        <KpiCard info={S.mrr()} label="Valor médio mensal" value={formatBRLShort(total ? d.mrr / total : 0)} sub="por assinatura" loading={!subs} />
        <KpiCard
          info={S.subscriptionsByMonth()}
          label={`Novas em ${monthLabel(ym)}`}
          value={formatInt(now?.qtd ?? 0)}
          change={delta(now?.qtd ?? 0, before?.qtd ?? 0)}
          sub={`${formatBRLShort(now?.valor_mensalizado ?? 0)}/mês`}
          loading={!subs}
        />
      </section>

      {d.odd && total > 0 && d.odd.qtd / total > 0.5 && (
        <WarnNote>
          <strong>{formatInt(d.odd.qtd)} de {formatInt(total)}</strong> assinaturas ({formatPct(d.odd.qtd / total)}) estão com status "1" na IULI, nem ACTIVE nem CANCELED. Enquanto isso não for corrigido lá, não dá pra separar ativa de encerrada: o MRR acima soma todas.
        </WarnNote>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Novas assinaturas por mês" info={S.subscriptionsByMonth()} action={<span className="text-sm text-muted-foreground">Quantidade</span>}>
          <StackedMonthChart data={d.chart} format={(v) => formatInt(v)} series={[{ key: "qtd", label: "Novas assinaturas", color: TONE.blue }]} height="h-64" />
        </Panel>
        <Panel title="Valor mensal das novas" info={S.subscriptionsByMonth()} action={<span className="text-sm text-muted-foreground">Valor mensalizado</span>}>
          <StackedMonthChart data={d.chart} format={formatBRLShort} series={[{ key: "valor", label: "Valor mensal", color: TONE.primary }]} height="h-64" />
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="Por produto" info={S.subscriptionsByProduct()} className="xl:col-span-2">
          {subs?.por_produto.length ? (
            <BarList
              items={subs.por_produto.slice(0, 12).map((p) => ({
                key: p.key,
                label: `${p.key} · ${formatInt(p.qtd)}`,
                value: p.valor_mensalizado,
                display: `${formatBRLShort(p.valor_mensalizado)}/mês`,
              }))}
            />
          ) : (
            <EmptyState>Sem assinaturas.</EmptyState>
          )}
        </Panel>

        <Panel title="Composição" info={S.subscriptionsByCycle()}>
          <div className="flex flex-col gap-5">
            <GroupList title="Ciclo" groups={subs?.por_ciclo} label={(k) => CYCLE_LABEL[k] ?? k} />
            <GroupList title="Status" groups={subs?.por_status_item} label={(k) => SUBSCRIPTION_STATUS_LABEL[k] ?? k} />
            <GroupList title="Forma de pagamento" groups={subs?.por_forma_pagamento} label={(k) => `Código ${k}`} />
            <GroupList title="Origem" groups={subs?.por_origem} label={(k) => `Código ${k}`} />
            <p className="text-xs text-muted-foreground">Forma de pagamento e origem vêm como códigos numéricos da IULI, sem descrição no MCP.</p>
          </div>
        </Panel>
      </div>

      <Panel title="Assinaturas mais recentes" info={S.subscriptionsRecent()}>
        {subs?.recentes.length ? (
          <div className="-mx-4 overflow-x-auto md:mx-0">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-4 py-2 font-medium md:pl-0">Criada em</th>
                  <th className="px-3 py-2 font-medium">Cliente</th>
                  <th className="px-3 py-2 font-medium">Produto</th>
                  <th className="px-3 py-2 font-medium">Ciclo</th>
                  <th className="px-4 py-2 text-right font-medium md:pr-0">Parcela</th>
                </tr>
              </thead>
              <tbody>
                {subs.recentes.map((s) => (
                  <tr key={s.id} className="border-b border-border/60 last:border-0">
                    <td className="whitespace-nowrap px-4 py-2.5 tabular-nums md:pl-0">{formatDate(s.criada_em)}</td>
                    <td className="max-w-56 truncate px-3 py-2.5 font-medium">{s.cliente}</td>
                    <td className="max-w-64 truncate px-3 py-2.5 text-muted-foreground">{s.produto}</td>
                    <td className="px-3 py-2.5">{CYCLE_LABEL[s.ciclo] ?? s.ciclo}</td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums md:pr-0">{formatBRL(s.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState>Sem assinaturas.</EmptyState>
        )}
      </Panel>
    </IuliShell>
  );
}

function GroupList({ title, groups, label }: { title: string; groups: SubscriptionGroup[] | undefined; label: (key: string) => string }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</span>
      <ul className="flex flex-col gap-1.5">
        {(groups ?? []).map((g) => (
          <li key={g.key} className="flex justify-between gap-2 text-sm">
            <span className="truncate">{label(g.key)}</span>
            <span className="shrink-0 tabular-nums">
              {formatInt(g.qtd)} · <span className="font-semibold">{formatBRLShort(g.valor_mensalizado)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
