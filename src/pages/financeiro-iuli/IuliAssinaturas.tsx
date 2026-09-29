import { useMemo } from "react";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { delta, formatBRL, formatBRLShort, formatInt, formatPct } from "@/lib/commercial";
import { CYCLE_LABEL, formatDate, SUBSCRIPTION_STATUS_LABEL } from "@/lib/iuli";
import { bucketLabel, bucketsBetween, sumBy, useSubscriptionsAgg, useSubscriptionsList, type SubsAggRow } from "@/lib/iuliData";
import { periodText, previousRange, useIuliFilters } from "@/lib/iuliFilters";
import { IULI_SOURCES as S } from "@/lib/iuliSources";
import { BarList, EmptyState, KpiCard, LoadingBlock, Panel, WarnNote } from "@/components/commercial/CommercialUI";
import { IuliShell, StackedMonthChart } from "@/components/iuli/IuliUI";
import { TONE } from "@/components/iuli/iuliTheme";
import { ClearFilters, ClientFilter, CompanyFilter, OptionFilter, PeriodFilter } from "@/components/iuli/IuliFilterBar";

function groupBy(rows: SubsAggRow[] | undefined, key: (r: SubsAggRow) => string) {
  const map = new Map<string, { key: string; qtd: number; mensal: number }>();
  for (const r of rows ?? []) {
    const k = key(r);
    const cur = map.get(k) ?? { key: k, qtd: 0, mensal: 0 };
    cur.qtd += r.qtd;
    cur.mensal += r.mensal;
    map.set(k, cur);
  }
  return [...map.values()].sort((a, b) => b.mensal - a.mensal);
}

export default function IuliAssinaturas() {
  const { workspace } = useWorkspace();
  const ws = workspace?.id;
  const { filters, set } = useIuliFilters();
  const prev = previousRange(filters.from, filters.to);

  // Base inteira (sem período) com os filtros — totais, produtos, composição.
  const all = useSubscriptionsAgg(ws, filters);
  // Sem nenhum filtro de assinatura — pra montar as opções dos filtros.
  const optionsBase = useSubscriptionsAgg(ws, { ...filters, cliente: null, produto: null, ciclo: null, assinaturaStatus: null });
  // Criadas no período (e no anterior), por bucket.
  const series = useSubscriptionsAgg(ws, filters, { period: true, grain: true });
  const prevPeriod = useSubscriptionsAgg(ws, { ...filters, ...prev }, { period: true });
  const recent = useSubscriptionsList(ws, filters, 20);

  const d = useMemo(() => {
    const total = sumBy(all.data, (r) => r.qtd);
    const mrr = sumBy(all.data, (r) => r.mensal);
    const odd = sumBy(all.data, (r) => r.qtd, (r) => r.status === "1");
    const novas = sumBy(series.data, (r) => r.qtd);
    const novasMensal = sumBy(series.data, (r) => r.mensal);
    const novasPrev = sumBy(prevPeriod.data, (r) => r.qtd);
    const map = new Map<string, { qtd: number; valor: number }>();
    for (const r of series.data ?? []) {
      if (!r.bucket) continue;
      const cur = map.get(r.bucket) ?? { qtd: 0, valor: 0 };
      cur.qtd += r.qtd;
      cur.valor += r.mensal;
      map.set(r.bucket, cur);
    }
    const chart = bucketsBetween(filters.from, filters.to, filters.grain).map((b) => ({ label: bucketLabel(b, filters.grain), ...(map.get(b) ?? { qtd: 0, valor: 0 }) }));
    return {
      total,
      mrr,
      odd,
      novas,
      novasMensal,
      novasPrev,
      chart,
      produtos: groupBy(all.data, (r) => r.produto),
      ciclos: groupBy(all.data, (r) => r.ciclo ?? "(vazio)"),
      status: groupBy(all.data, (r) => r.status ?? "(vazio)"),
      opts: {
        produto: groupBy(optionsBase.data, (r) => r.produto),
        ciclo: groupBy(optionsBase.data, (r) => r.ciclo ?? "(vazio)"),
        status: groupBy(optionsBase.data, (r) => r.status ?? "(vazio)"),
      },
    };
  }, [all.data, optionsBase.data, series.data, prevPeriod.data, filters.from, filters.to, filters.grain]);

  const grainText = filters.grain === "day" ? "por dia" : filters.grain === "week" ? "por semana" : "por mês";

  return (
    <IuliShell
      title="Assinaturas"
      description={`Base de assinaturas · novas: ${periodText(filters.preset, filters.from, filters.to)}`}
      scope={filters.empresa}
      filters={
        <>
          <PeriodFilter filters={filters} set={set} />
          <CompanyFilter filters={filters} set={set} />
          <ClientFilter filters={filters} set={set} />
          <OptionFilter label="Produto" allLabel="Todos os produtos" param="produto" value={filters.produto} set={set} options={d.opts.produto.map((o) => ({ value: o.key, label: o.key }))} />
          <OptionFilter label="Ciclo" allLabel="Todos os ciclos" param="ciclo" value={filters.ciclo} set={set} options={d.opts.ciclo.map((o) => ({ value: o.key, label: CYCLE_LABEL[o.key] ?? o.key }))} />
          <OptionFilter
            label="Status"
            allLabel="Todos os status"
            param="astatus"
            value={filters.assinaturaStatus}
            set={set}
            options={d.opts.status.map((o) => ({ value: o.key, label: SUBSCRIPTION_STATUS_LABEL[o.key] ?? o.key }))}
          />
          <ClearFilters filters={filters} set={set} />
        </>
      }
    >
      <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard info={S.subscriptionsTotal()} label="Assinaturas" value={formatInt(d.total)} sub={`${formatInt(d.produtos.length)} produtos`} loading={all.isLoading} />
        <KpiCard
          info={S.mrr()}
          label="MRR declarado"
          value={formatBRLShort(d.mrr)}
          sub="teto — status não confiável"
          tone={d.total && d.odd / d.total > 0.5 ? "warn" : "default"}
          loading={all.isLoading}
        />
        <KpiCard info={S.mrr()} label="Valor médio mensal" value={formatBRLShort(d.total ? d.mrr / d.total : 0)} sub="por assinatura" loading={all.isLoading} />
        <KpiCard
          info={S.subscriptionsByMonth()}
          label="Novas no período"
          value={formatInt(d.novas)}
          change={delta(d.novas, d.novasPrev)}
          sub={`${formatBRLShort(d.novasMensal)}/mês · vs período anterior`}
          loading={series.isLoading}
        />
      </section>

      {d.total > 0 && d.odd / d.total > 0.5 && (
        <WarnNote>
          <strong>{formatInt(d.odd)} de {formatInt(d.total)}</strong> assinaturas ({formatPct(d.odd / d.total)}) estão com status "1" na IULI — nem ACTIVE nem CANCELED. Enquanto isso não for
          corrigido lá, não dá pra separar ativa de encerrada: o MRR acima soma todas.
        </WarnNote>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Novas assinaturas" info={S.subscriptionsByMonth()} action={<span className="text-sm text-muted-foreground">Quantidade {grainText}</span>}>
          {series.isLoading ? <LoadingBlock className="h-64" /> : <StackedMonthChart data={d.chart} format={(v) => formatInt(v)} series={[{ key: "qtd", label: "Novas", color: TONE.blue }]} height="h-64" />}
        </Panel>
        <Panel title="Valor mensal das novas" info={S.subscriptionsByMonth()} action={<span className="text-sm text-muted-foreground">Valor mensalizado {grainText}</span>}>
          {series.isLoading ? <LoadingBlock className="h-64" /> : <StackedMonthChart data={d.chart} format={formatBRLShort} series={[{ key: "valor", label: "Valor mensal", color: TONE.primary }]} height="h-64" />}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="Por produto" info={S.subscriptionsByProduct()} className="xl:col-span-2">
          {all.isLoading ? (
            <LoadingBlock />
          ) : d.produtos.length ? (
            <BarList
              items={d.produtos.slice(0, 12).map((p) => ({ key: p.key, label: `${p.key} · ${formatInt(p.qtd)}`, value: p.mensal, display: `${formatBRLShort(p.mensal)}/mês` }))}
            />
          ) : (
            <EmptyState>Sem assinaturas com esses filtros.</EmptyState>
          )}
        </Panel>

        <Panel title="Composição" info={S.subscriptionsByCycle()}>
          <div className="flex flex-col gap-5">
            <GroupList title="Ciclo" groups={d.ciclos} label={(k) => CYCLE_LABEL[k] ?? k} />
            <GroupList title="Status" groups={d.status} label={(k) => SUBSCRIPTION_STATUS_LABEL[k] ?? k} />
          </div>
        </Panel>
      </div>

      <Panel
        title="Criadas no período"
        info={S.subscriptionsRecent()}
        action={<span className="text-sm text-muted-foreground">{recent.data ? `${formatInt(Math.min(20, recent.data.count))} de ${formatInt(recent.data.count)}` : ""}</span>}
      >
        {recent.isLoading ? (
          <LoadingBlock />
        ) : recent.data?.rows.length ? (
          <div className="-mx-4 overflow-x-auto md:mx-0">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-4 py-2 font-medium md:pl-0">Criada em</th>
                  <th className="px-3 py-2 font-medium">Cliente</th>
                  <th className="px-3 py-2 font-medium">Produto</th>
                  {filters.empresa === "todas" && <th className="px-3 py-2 font-medium">Empresa</th>}
                  <th className="px-3 py-2 font-medium">Ciclo</th>
                  <th className="px-4 py-2 text-right font-medium md:pr-0">Parcela</th>
                </tr>
              </thead>
              <tbody>
                {recent.data.rows.map((s) => (
                  <tr key={`${s.empresa}-${s.iuli_id}`} className="border-b border-border/60 last:border-0">
                    <td className="whitespace-nowrap px-4 py-2.5 tabular-nums md:pl-0">{formatDate(s.criada_em)}</td>
                    <td className="max-w-56 truncate px-3 py-2.5 font-medium">{s.cliente}</td>
                    <td className="max-w-64 truncate px-3 py-2.5 text-muted-foreground">{s.produto}</td>
                    {filters.empresa === "todas" && <td className="px-3 py-2.5 text-muted-foreground">{s.empresa}</td>}
                    <td className="px-3 py-2.5">{CYCLE_LABEL[s.ciclo ?? ""] ?? s.ciclo}</td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums md:pr-0">{formatBRL(s.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState>Nenhuma assinatura criada no período.</EmptyState>
        )}
      </Panel>
    </IuliShell>
  );
}

function GroupList({ title, groups, label }: { title: string; groups: { key: string; qtd: number; mensal: number }[]; label: (key: string) => string }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</span>
      <ul className="flex flex-col gap-1.5">
        {groups.map((g) => (
          <li key={g.key} className="flex justify-between gap-2 text-sm">
            <span className="truncate">{label(g.key)}</span>
            <span className="shrink-0 tabular-nums">
              {formatInt(g.qtd)} · <span className="font-semibold">{formatBRLShort(g.mensal)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
