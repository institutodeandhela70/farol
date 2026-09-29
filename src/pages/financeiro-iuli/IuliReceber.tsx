import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { addMonths, currentYM, formatBRL, formatBRLShort, formatInt, formatPct, monthLabel, monthsBetween } from "@/lib/commercial";
import { AGING_BUCKETS, formatDate, snap, useIuliSnapshots, type Receivable } from "@/lib/iuli";
import { IULI_SOURCES as S } from "@/lib/iuliSources";
import { EmptyState, KpiCard, Panel, ProgressBar, WarnNote } from "@/components/commercial/CommercialUI";
import { IuliShell, StackedMonthChart } from "@/components/iuli/IuliUI";
import { axisProps, TONE, tooltipStyle } from "@/components/iuli/iuliTheme";

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

export default function IuliReceber() {
  const { workspace } = useWorkspace();
  const { data: snaps } = useIuliSnapshots(workspace?.id);
  const ym = currentYM();

  const d = useMemo(() => {
    const ar = snap<Receivable>(snaps, "ar:overview");
    const aging = AGING_BUCKETS.map((b) => {
      const r = snap<Receivable>(snaps, `ar_aging:${b.key}`);
      return { ...b, short: AGING_SHORT[b.key], valor: r?.total_a_receber ?? 0, qtd: r?.quantidade ?? 0, loaded: !!r };
    });
    const monthly = monthsBetween(addMonths(ym, -12), addMonths(ym, 6)).map((m) => {
      const r = snap<Receivable>(snaps, `ar_month:${m}`);
      return { label: monthLabel(m), recebido: r?.total_recebidas ?? 0, aberto: r?.total_a_receber ?? 0 };
    });
    return { ar, aging, monthly };
  }, [snaps, ym]);

  const ar = d.ar;
  const upcoming = ar ? ar.total_a_receber - ar.total_vencidas : 0;
  const overdueRatio = ar && ar.total_a_receber ? ar.total_vencidas / ar.total_a_receber : null;
  const oldOverdue = d.aging.find((a) => a.key === "vencido_365_mais");
  const docs = ar?.cobertura_documental;
  const received = ar?.soma_valores_recebidas;

  return (
    <IuliShell title="Contas a Receber" description="Títulos de contas a receber da IULI · datas pelo vencimento">
      <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard info={S.receivablePending()} label="A receber (sem baixa)" value={formatBRLShort(ar?.total_a_receber ?? 0)} sub={`${formatInt(ar?.quantidade ?? 0)} títulos`} loading={!ar} />
        <KpiCard
          info={S.receivableOverdue()}
          label="Vencido sem baixa"
          value={formatBRLShort(ar?.total_vencidas ?? 0)}
          sub={`${formatInt(ar?.qtd_vencidas ?? 0)} títulos · ${formatPct(overdueRatio)}`}
          tone={overdueRatio !== null && overdueRatio > 0.3 ? "warn" : "default"}
          loading={!ar}
        />
        <KpiCard info={S.receivableUpcoming()} label="A vencer" value={formatBRLShort(upcoming)} sub={`${formatInt((ar?.quantidade ?? 0) - (ar?.qtd_vencidas ?? 0))} títulos`} loading={!ar} />
        <KpiCard info={S.received()} label="Recebido (histórico)" value={formatBRLShort(ar?.total_recebidas ?? 0)} sub={`${formatInt(ar?.qtd_recebidas ?? 0)} títulos baixados`} loading={!ar} />
        <div className="col-span-2 lg:col-span-1">
          <KpiCard
            info={S.interest()}
            label="Juros recebidos"
            value={formatBRLShort(received?.juros_acrescimos ?? 0)}
            sub={`descontos/parciais ${formatBRLShort(received?.descontos_pagamentos_parciais ?? 0)}`}
            loading={!ar}
          />
        </div>
      </section>

      {oldOverdue && ar && oldOverdue.valor / Math.max(1, ar.total_vencidas) > 0.5 && (
        <WarnNote>
          <strong>{formatBRLShort(oldOverdue.valor)}</strong> ({formatInt(oldOverdue.qtd)} títulos) venceram há mais de um ano e continuam sem baixa. Isso é{" "}
          {formatPct(oldOverdue.valor / ar.total_vencidas)} de todo o vencido, e quase certamente não é inadimplência recente: são baixas não registradas, negociações antigas ou títulos a cancelar na IULI.
        </WarnNote>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="Aging do que está sem baixa" info={S.aging()} className="xl:col-span-2">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d.aging} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="short" {...axisProps} interval={0} fontSize={11} />
                <YAxis {...axisProps} width={68} tickFormatter={(v: number) => formatBRLShort(v).replace("R$ ", "")} />
                <Tooltip
                  {...tooltipStyle}
                  formatter={(v: number, _n: string, item: { payload?: { qtd: number } }) => [`${formatBRL(v)} · ${formatInt(item.payload?.qtd ?? 0)} títulos`, "Sem baixa"]}
                  labelFormatter={(_l, payload) => String((payload?.[0]?.payload as { label?: string } | undefined)?.label ?? "")}
                />
                <Bar dataKey="valor" radius={[6, 6, 0, 0]} maxBarSize={56}>
                  {d.aging.map((b) => (
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
        </Panel>

        <Panel title="Cobertura documental" info={S.documents()}>
          {docs ? (
            <div className="flex flex-col gap-4">
              <DocRow label="Com nota fiscal" count={docs.com_nota_fiscal} total={docs.titulos} />
              <DocRow label="Com algum anexo" count={docs.com_anexo} total={docs.titulos} />
              <DocRow label="Com comprovante" count={docs.com_comprovante} total={docs.titulos} />
              <DocRow label="Com boleto anexado" count={docs.com_boleto} total={docs.titulos} />
              <p className="text-xs text-muted-foreground">Base: {formatInt(docs.titulos)} títulos sem baixa.</p>
            </div>
          ) : (
            <EmptyState>Ainda buscando na IULI.</EmptyState>
          )}
        </Panel>
      </div>

      <Panel
        title="Recebido × sem baixa por mês de vencimento"
        info={S.receivableMonthly()}
        action={<span className="text-sm text-muted-foreground">12 meses atrás · 6 à frente</span>}
      >
        <StackedMonthChart
          data={d.monthly}
          format={formatBRLShort}
          series={[
            { key: "recebido", label: "Recebido", color: TONE.primary },
            { key: "aberto", label: "Sem baixa", color: TONE.amber },
          ]}
        />
      </Panel>

      <Panel title="Títulos sem baixa mais antigos" info={S.oldestTitles()}>
        {ar?.itens?.length ? (
          <div className="-mx-4 overflow-x-auto md:mx-0">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-4 py-2 font-medium md:pl-0">Vencimento</th>
                  <th className="px-3 py-2 font-medium">Cliente</th>
                  <th className="px-3 py-2 font-medium">Descrição</th>
                  <th className="px-3 py-2 font-medium">NF</th>
                  <th className="px-4 py-2 text-right font-medium md:pr-0">Valor</th>
                </tr>
              </thead>
              <tbody>
                {ar.itens.map((t) => (
                  <tr key={t.id} className="border-b border-border/60 last:border-0">
                    <td className="whitespace-nowrap px-4 py-2.5 tabular-nums md:pl-0">{formatDate(t.due_date)}</td>
                    <td className="max-w-48 truncate px-3 py-2.5 font-medium">{t.empresa ?? "—"}</td>
                    <td className="max-w-80 truncate px-3 py-2.5 text-muted-foreground" title={t.description ?? ""}>{t.description ?? "—"}</td>
                    <td className="px-3 py-2.5">{t.tem_nf ? "Sim" : "—"}</td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums md:pr-0">{formatBRL(t.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState>Nenhum título sem baixa.</EmptyState>
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
