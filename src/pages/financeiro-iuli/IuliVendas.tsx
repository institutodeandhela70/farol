import { useMemo } from "react";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { delta, formatBRL, formatBRLShort, formatInt, formatPct } from "@/lib/commercial";
import { SALE_GROUP_LABEL, SALE_STATUS, formatDate, saleGroupOf, type SaleGroup } from "@/lib/iuli";
import { bucketLabel, bucketsBetween, sumBy, useSalesAgg, useSalesList, useSalesOptions, useSalesTop, type SalesAggRow } from "@/lib/iuliData";
import { periodText, previousRange, useIuliFilters } from "@/lib/iuliFilters";
import { IULI_SOURCES as S, ORIGEM_LABEL } from "@/lib/iuliSources";
import { BarList, EmptyState, KpiCard, LoadingBlock, Panel, WarnNote } from "@/components/commercial/CommercialUI";
import { IuliShell, StackedMonthChart, StatusPill } from "@/components/iuli/IuliUI";
import { TONE } from "@/components/iuli/iuliTheme";
import { ClearFilters, ClientFilter, CompanyFilter, IntercompanyToggle, OptionFilter, PeriodFilter } from "@/components/iuli/IuliFilterBar";

const GROUP_TONE: Record<SaleGroup, "ok" | "warn" | "bad"> = { efetiva: "ok", aberta: "warn", perdida: "bad" };

export default function IuliVendas() {
  const { workspace } = useWorkspace();
  const ws = workspace?.id;
  const { filters, set } = useIuliFilters();
  const prev = previousRange(filters.from, filters.to);

  const agg = useSalesAgg(ws, filters);
  const aggPrev = useSalesAgg(ws, filters, { range: prev });
  const series = useSalesAgg(ws, filters, { grain: true });
  const options = useSalesOptions(ws, filters);
  const topProducts = useSalesTop(ws, filters, "produto", 12);
  const topClients = useSalesTop(ws, filters, "cliente", 12);
  const byOrigin = useSalesTop(ws, filters, "origem", 10);
  const byCompany = useSalesTop(ws, filters, "empresa", 10);
  const list = useSalesList(ws, filters, 50);

  const k = useMemo(() => {
    const g = (rows: SalesAggRow[] | undefined, grupo: SaleGroup) => ({
      qtd: sumBy(rows, (r) => r.qtd, (r) => r.grupo === grupo),
      total: sumBy(rows, (r) => r.total, (r) => r.grupo === grupo),
    });
    const now = { efetiva: g(agg.data, "efetiva"), aberta: g(agg.data, "aberta"), perdida: g(agg.data, "perdida") };
    const before = { efetiva: g(aggPrev.data, "efetiva") };
    const bruto = sumBy(agg.data, (r) => r.total);
    const liquido = sumBy(agg.data, (r) => r.liquido, (r) => r.grupo === "efetiva");
    const byStatus = new Map<string, { qtd: number; total: number }>();
    for (const r of agg.data ?? []) {
      const cur = byStatus.get(r.status) ?? { qtd: 0, total: 0 };
      cur.qtd += r.qtd;
      cur.total += r.total;
      byStatus.set(r.status, cur);
    }
    return { now, before, bruto, liquido, byStatus: [...byStatus.entries()].sort((a, b) => b[1].total - a[1].total) };
  }, [agg.data, aggPrev.data]);

  const chart = useMemo(() => {
    const map = new Map<string, Record<SaleGroup, number>>();
    for (const r of series.data ?? []) {
      if (!r.bucket) continue;
      const cur = map.get(r.bucket) ?? { efetiva: 0, aberta: 0, perdida: 0 };
      cur[r.grupo] += r.total;
      map.set(r.bucket, cur);
    }
    return bucketsBetween(filters.from, filters.to, filters.grain).map((b) => ({ label: bucketLabel(b, filters.grain), ...(map.get(b) ?? { efetiva: 0, aberta: 0, perdida: 0 }) }));
  }, [series.data, filters.from, filters.to, filters.grain]);

  const ticket = k.now.efetiva.qtd ? k.now.efetiva.total / k.now.efetiva.qtd : 0;
  const ticketPrev = k.before.efetiva.qtd ? k.before.efetiva.total / k.before.efetiva.qtd : 0;
  const unknownProduct = topProducts.data?.find((p) => p.nome === "(não identificado)");
  const productTotal = sumBy(topProducts.data, (p) => p.total);
  const grainText = filters.grain === "day" ? "por dia" : filters.grain === "week" ? "por semana" : "por mês";

  return (
    <IuliShell
      title="Vendas"
      description={`${periodText(filters.preset, filters.from, filters.to)} · por competência da venda`}
      scope={filters.empresa}
      filters={
        <>
          <PeriodFilter filters={filters} set={set} />
          <CompanyFilter filters={filters} set={set} />
          <ClientFilter filters={filters} set={set} />
          <OptionFilter
            label="Status"
            allLabel="Todos os status"
            param="status"
            value={filters.status}
            set={set}
            options={(options.data?.status ?? []).map((o) => ({ value: o.value, label: SALE_STATUS[o.value]?.label ?? o.value }))}
          />
          <OptionFilter
            label="Produto"
            allLabel="Todos os produtos"
            param="produto"
            value={filters.produto}
            set={set}
            options={(options.data?.produto ?? []).map((o) => ({ value: o.value, label: o.value }))}
          />
          <OptionFilter
            label="Origem"
            allLabel="Todas as origens"
            param="origem"
            value={filters.origem}
            set={set}
            options={(options.data?.origem ?? []).map((o) => ({ value: o.value, label: ORIGEM_LABEL[o.value] ?? o.value }))}
          />
          <IntercompanyToggle filters={filters} set={set} />
          <ClearFilters filters={filters} set={set} />
        </>
      }
    >
      <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard
          info={S.effectiveSales()}
          label="Vendas efetivas"
          value={formatBRLShort(k.now.efetiva.total)}
          change={delta(k.now.efetiva.total, k.before.efetiva.total)}
          sub="vs período anterior"
          loading={agg.isLoading}
        />
        <KpiCard
          info={S.salesCount()}
          label="Quantidade · ticket"
          value={formatInt(k.now.efetiva.qtd)}
          change={delta(ticket, ticketPrev)}
          sub={`ticket ${formatBRLShort(ticket)}`}
          loading={agg.isLoading}
        />
        <KpiCard info={S.netSales()} label="Líquido das efetivas" value={formatBRLShort(k.liquido)} sub={`${formatPct(k.now.efetiva.total ? k.liquido / k.now.efetiva.total : null)} do bruto efetivo`} loading={agg.isLoading} />
        <KpiCard info={S.openSales()} label="Em aberto" value={formatBRLShort(k.now.aberta.total)} sub={`${formatInt(k.now.aberta.qtd)} não pagas`} loading={agg.isLoading} />
        <div className="col-span-2 lg:col-span-1">
          <KpiCard
            info={S.lostSales()}
            label="Perdidas"
            value={formatBRLShort(k.now.perdida.total)}
            sub={`${formatPct(k.bruto ? k.now.perdida.total / k.bruto : null, 1)} do total · ${formatInt(k.now.perdida.qtd)} vendas`}
            tone={k.bruto && k.now.perdida.total / k.bruto > 0.1 ? "warn" : "default"}
            loading={agg.isLoading}
          />
        </div>
      </section>

      <Panel title="Vendas no período" info={S.salesChart()} action={<span className="text-sm text-muted-foreground">Valor {grainText}</span>}>
        {series.isLoading ? (
          <LoadingBlock className="h-72" />
        ) : (
          <StackedMonthChart
            data={chart}
            format={formatBRLShort}
            series={[
              { key: "efetiva", label: SALE_GROUP_LABEL.efetiva, color: TONE.primary },
              { key: "aberta", label: SALE_GROUP_LABEL.aberta, color: TONE.amber },
              { key: "perdida", label: SALE_GROUP_LABEL.perdida, color: TONE.red },
            ]}
          />
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Produtos que mais venderam" info={S.topProducts()}>
          {topProducts.isLoading ? (
            <LoadingBlock />
          ) : topProducts.data?.length ? (
            <div className="flex flex-col gap-3">
              <BarList
                items={topProducts.data.map((p) => ({ key: p.nome, label: `${p.nome} · ${formatInt(p.qtd)}`, value: p.total, display: formatBRLShort(p.total) }))}
              />
              {unknownProduct && productTotal > 0 && unknownProduct.total / productTotal > 0.3 && (
                <p className="text-xs text-muted-foreground">
                  {formatPct(unknownProduct.total / productTotal)} do valor está sem produto identificado: são vendas que não vieram da Hubla nem da TMB (importações, lançamentos diretos e outras plataformas).
                </p>
              )}
            </div>
          ) : (
            <EmptyState>Sem vendas com esses filtros.</EmptyState>
          )}
        </Panel>

        <Panel title="Clientes que mais compraram" info={S.topClients()}>
          {topClients.isLoading ? (
            <LoadingBlock />
          ) : topClients.data?.length ? (
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
                  {topClients.data.map((c) => (
                    <tr key={c.nome} className="border-b border-border/60 last:border-0">
                      <td className="max-w-64 px-4 py-2.5 md:pl-0">
                        <button type="button" className="max-w-full truncate text-left font-medium hover:text-primary hover:underline" onClick={() => set({ cliente: c.nome })}>
                          {c.nome}
                        </button>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatInt(c.qtd)}</td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums md:pr-0">{formatBRL(c.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState>Sem vendas com esses filtros.</EmptyState>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="Vendas por status" info={S.salesStatus()} className="xl:col-span-2">
          {k.byStatus.length ? (
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
                  {k.byStatus.map(([status, v]) => {
                    const grupo = saleGroupOf(status);
                    return (
                      <tr key={status} className="border-b border-border/60 last:border-0">
                        <td className="px-4 py-2.5 font-medium md:pl-0">{SALE_STATUS[status]?.label ?? status}</td>
                        <td className="px-3 py-2.5">
                          <StatusPill tone={GROUP_TONE[grupo]}>{SALE_GROUP_LABEL[grupo]}</StatusPill>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{formatInt(v.qtd)}</td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{formatBRL(v.total)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums md:pr-0">{formatPct(k.bruto ? v.total / k.bruto : null, 1)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState>Sem vendas com esses filtros.</EmptyState>
          )}
        </Panel>

        <Panel title={filters.empresa === "todas" ? "Por origem e empresa" : "Por origem"} info={S.salesOrigin()}>
          <div className="flex flex-col gap-5">
            {byOrigin.data?.length ? (
              <BarList tone="blue" items={byOrigin.data.map((o) => ({ key: o.nome, label: `${ORIGEM_LABEL[o.nome] ?? o.nome} · ${formatInt(o.qtd)}`, value: o.total, display: formatBRLShort(o.total) }))} />
            ) : (
              <EmptyState>Sem vendas.</EmptyState>
            )}
            {filters.empresa === "todas" && (byCompany.data?.length ?? 0) > 1 && (
              <BarList items={byCompany.data!.map((c) => ({ key: c.nome, label: `${c.nome} · ${formatInt(c.qtd)}`, value: c.total, display: formatBRLShort(c.total) }))} />
            )}
          </div>
        </Panel>
      </div>

      <Panel
        title="Maiores vendas do período"
        info={S.salesList()}
        action={<span className="text-sm text-muted-foreground">{list.data ? `${formatInt(Math.min(50, list.data.count))} de ${formatInt(list.data.count)}` : ""}</span>}
      >
        {list.isLoading ? (
          <LoadingBlock />
        ) : list.data?.rows.length ? (
          <div className="-mx-4 overflow-x-auto md:mx-0">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-4 py-2 font-medium md:pl-0">Data</th>
                  <th className="px-3 py-2 font-medium">Cliente</th>
                  <th className="px-3 py-2 font-medium">Produto</th>
                  <th className="px-3 py-2 font-medium">Origem</th>
                  {filters.empresa === "todas" && <th className="px-3 py-2 font-medium">Empresa</th>}
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 text-right font-medium md:pr-0">Valor</th>
                </tr>
              </thead>
              <tbody>
                {list.data.rows.map((v) => (
                  <tr key={`${v.empresa}-${v.iuli_id}`} className="border-b border-border/60 last:border-0">
                    <td className="whitespace-nowrap px-4 py-2.5 tabular-nums md:pl-0">{formatDate(v.dia)}</td>
                    <td className="max-w-48 truncate px-3 py-2.5 font-medium">{v.cliente ?? "—"}</td>
                    <td className="max-w-56 truncate px-3 py-2.5 text-muted-foreground">{v.produto ?? "—"}</td>
                    <td className="px-3 py-2.5">{ORIGEM_LABEL[v.origem] ?? v.origem}</td>
                    {filters.empresa === "todas" && <td className="px-3 py-2.5 text-muted-foreground">{v.empresa}</td>}
                    <td className="px-3 py-2.5">
                      <StatusPill tone={GROUP_TONE[saleGroupOf(v.status)]}>{SALE_STATUS[v.status]?.label ?? v.status}</StatusPill>
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums md:pr-0">{formatBRL(v.valor_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState>Sem vendas com esses filtros.</EmptyState>
        )}
      </Panel>

      {filters.empresa === "todas" && filters.entreEmpresas === "incluir" && (
        <WarnNote>As operações entre as empresas do grupo estão incluídas: no consolidado, parte do valor pode estar contada nas duas empresas.</WarnNote>
      )}
    </IuliShell>
  );
}
