import { useMemo } from "react";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { useHubspotOwners } from "@/lib/hubspotMeta";
import { delta, ownerDisplay } from "@/lib/commercial";
import { bucketLabel, bucketsBetween } from "@/lib/iuliData";
import { previousRange, resultPeriodText, useResultFilters } from "@/lib/resultFilters";
import { RESULT_SOURCES as S } from "@/lib/resultSources";
import { bucketRange, drillBase, type Drill } from "@/lib/detailData";
import { formatCount, formatMoney, formatPercent } from "@/lib/money";
import { useSalesDuplicates, useSalesOptions, useSalesSeries, useSalesSettings, useSalesSummary, type SalesSummaryRow } from "@/lib/salesData";
import { EmptyState, LoadingBlock, MultiSelect, OwnerSelect, Panel, WarnNote } from "@/components/commercial/CommercialUI";
import { ClickBarChart, ClickBarList, KpiTile, SplitBar } from "@/components/result/ResultCharts";
import { DetailTable } from "@/components/result/DetailTable";
import { DrillProvider, useDrill } from "@/components/result/DrillContext";
import { ResultPeriodBar, ResultShell } from "@/components/result/ResultUI";
import { MissingSales } from "@/components/result/MissingSales";
import { TONE } from "@/components/iuli/iuliTheme";

const PIPELINE_LABEL: Record<string, string> = { contratos: "Contratos", hubla_tmb: "Hubla & TMB" };
const neg = (n: number) => `${formatCount(n)} ${n === 1 ? "negócio" : "negócios"}`;
const sum = (rows: SalesSummaryRow[], pick: (r: SalesSummaryRow) => number) => rows.reduce((a, r) => a + pick(r), 0);

function Content() {
  const { workspace } = useWorkspace();
  const ws = workspace?.id;
  const owners = useHubspotOwners(ws);
  const drill = useDrill();
  const { filters, set } = useResultFilters();
  const prev = previousRange(filters.from, filters.to);

  const summary = useSalesSummary(ws, filters);
  const summaryPrev = useSalesSummary(ws, filters, prev);
  const series = useSalesSeries(ws, filters);
  const options = useSalesOptions(ws, filters);
  const duplicates = useSalesDuplicates(ws, filters);
  const settings = useSalesSettings(ws);

  const base = drillBase("vendas", filters);
  const open = (d: Partial<Drill> & Pick<Drill, "title">) => drill.open({ ...base, ...d });

  const k = useMemo(() => {
    const rows = summary.data ?? [];
    const counted = rows.filter((r) => r.grupo !== "fora_dos_6");
    const high = counted.filter((r) => r.grupo === "high");
    const demais = counted.filter((r) => r.grupo === "demais");
    const fora = rows.filter((r) => r.grupo === "fora_dos_6");
    const prevCounted = (summaryPrev.data ?? []).filter((r) => r.grupo !== "fora_dos_6");
    return {
      total: sum(counted, (r) => r.total),
      qtd: sum(counted, (r) => r.qtd),
      prevTotal: sum(prevCounted, (r) => r.total),
      prevQtd: sum(prevCounted, (r) => r.qtd),
      highTotal: sum(high, (r) => r.total),
      highQtd: sum(high, (r) => r.qtd),
      demaisTotal: sum(demais, (r) => r.total),
      demaisQtd: sum(demais, (r) => r.qtd),
      foraTotal: sum(fora, (r) => r.total),
      foraQtd: sum(fora, (r) => r.qtd),
      high,
      demais,
      fora,
      semProduto: demais.filter((r) => r.produto === "(sem produto)"),
    };
  }, [summary.data, summaryPrev.data]);

  const byProduct = (rows: SalesSummaryRow[]) => {
    const map = new Map<string, { total: number; qtd: number; contratos: number; hubla: number }>();
    for (const r of rows) {
      const cur = map.get(r.produto) ?? { total: 0, qtd: 0, contratos: 0, hubla: 0 };
      cur.total += r.total;
      cur.qtd += r.qtd;
      if (r.pipeline_kind === "contratos") cur.contratos += r.qtd;
      else cur.hubla += r.qtd;
      map.set(r.produto, cur);
    }
    return [...map.entries()].sort((a, b) => b[1].total - a[1].total);
  };
  const highProducts = useMemo(() => byProduct(k.high), [k.high]);
  const demaisProducts = useMemo(() => byProduct(k.demais).slice(0, 10), [k.demais]);
  const foraProducts = useMemo(() => byProduct(k.fora), [k.fora]);

  const chart = useMemo(() => {
    const map = new Map<string, { contratos: number; hubla_tmb: number }>();
    for (const r of series.data ?? []) {
      if (r.grupo === "fora_dos_6") continue;
      const cur = map.get(r.bucket) ?? { contratos: 0, hubla_tmb: 0 };
      cur[r.pipeline_kind] += r.total;
      map.set(r.bucket, cur);
    }
    return bucketsBetween(filters.from, filters.to, filters.grain).map((b) => ({ label: bucketLabel(b, filters.grain), bucket: b, ...(map.get(b) ?? { contratos: 0, hubla_tmb: 0 }) }));
  }, [series.data, filters.from, filters.to, filters.grain]);

  const dupTotal = (duplicates.data ?? []).reduce((a, d) => a + d.total, 0);
  const dupQtd = (duplicates.data ?? []).reduce((a, d) => a + d.qtd, 0);
  const ticket = k.qtd ? k.total / k.qtd : 0;
  const highTicket = k.highQtd ? k.highTotal / k.highQtd : 0;
  const prevTicket = k.prevQtd ? k.prevTotal / k.prevQtd : 0;
  const grainText = filters.grain === "day" ? "por dia" : filters.grain === "week" ? "por semana" : "por mês";
  const change = (a: number, b: number) => {
    const d = delta(a, b);
    return d === null ? "" : ` · ${d >= 0 ? "+" : "−"}${formatPercent(Math.abs(d), 0)} vs período anterior`;
  };

  const productOptions = (options.data?.produtos ?? []).map((p) => ({ value: p, label: p }));
  const ownerOptions = (options.data?.owners ?? [])
    .filter((o) => o !== "(sem proprietário)")
    .map((id) => ({ id, name: ownerDisplay(owners, id) }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const period = `${resultPeriodText(filters)}`;

  return (
    <ResultShell
      title="Vendas"
      filters={
        <>
          <ResultPeriodBar filters={filters} set={set} />
          <div className="flex-1" />
          <MultiSelect label="Produto" allLabel="Todos os produtos" options={productOptions} selected={filters.produto} onChange={(v) => set({ produto: v })} />
          <OwnerSelect value={filters.owner} owners={ownerOptions} onChange={(v) => set({ vendedor: v })} />
        </>
      }
      description={`${period} · negócios ganhos no HubSpot, pela data do ganho`}
    >
      <section aria-label="Indicadores" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile
          info={S.total()}
          label="Total vendido"
          value={formatMoney(k.total)}
          sub={`${neg(k.qtd)}${change(k.total, k.prevTotal)}`}
          loading={summary.isLoading}
          onClick={() => open({ title: "Total vendido", subtitle: period, grupos: ["high", "demais"] })}
        />
        <KpiTile
          info={S.high()}
          label="High ticket (os 6 + combo)"
          value={formatMoney(k.highTotal)}
          sub={`${neg(k.highQtd)} · ${formatPercent(k.total ? k.highTotal / k.total : null, 1)} do total`}
          loading={summary.isLoading}
          onClick={() => open({ title: "High ticket (os 6 + combo)", subtitle: period, grupos: ["high"] })}
        />
        <KpiTile
          info={S.demais()}
          label="Demais vendas (Hubla & TMB)"
          value={formatMoney(k.demaisTotal)}
          sub={`${neg(k.demaisQtd)} · ${formatPercent(k.total ? k.demaisTotal / k.total : null, 1)} do total`}
          loading={summary.isLoading}
          onClick={() => open({ title: "Demais vendas (Hubla & TMB)", subtitle: period, grupos: ["demais"] })}
        />
        <KpiTile
          info={S.ticket()}
          label="Ticket médio"
          value={formatMoney(ticket)}
          sub={`high ticket: ${formatMoney(highTicket)}${change(ticket, prevTicket)}`}
          loading={summary.isLoading}
          onClick={() => open({ title: "Ticket médio — negócios que formam a média", subtitle: period, grupos: ["high", "demais"] })}
        />
      </section>

      <Panel title="High ticket × Demais" info={S.split()}>
        {summary.isLoading ? (
          <LoadingBlock className="h-16" />
        ) : k.total > 0 ? (
          <SplitBar
            left={{ label: "High ticket", value: k.highTotal, display: formatMoney(k.highTotal), sub: `${neg(k.highQtd)} · os 6 + combo`, onClick: () => open({ title: "High ticket", subtitle: period, grupos: ["high"] }) }}
            right={{ label: "Demais", value: k.demaisTotal, display: formatMoney(k.demaisTotal), sub: `${neg(k.demaisQtd)} · Hubla & TMB`, onClick: () => open({ title: "Demais vendas", subtitle: period, grupos: ["demais"] }) }}
          />
        ) : (
          <EmptyState>Sem vendas no período.</EmptyState>
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel title="Vendas no período" info={S.series()} action={<span className="text-sm text-muted-foreground">Valor {grainText} · clique numa barra</span>}>
          {series.isLoading ? (
            <LoadingBlock className="h-72" />
          ) : (
            <ClickBarChart
              data={chart}
              series={[
                { key: "contratos", label: "Contratos", color: TONE.primary },
                { key: "hubla_tmb", label: "Hubla & TMB", color: TONE.amber },
              ]}
              onBarClick={(row, key) => {
                const range = bucketRange(String(row.bucket), filters.grain, filters);
                open({ title: `Vendas · ${PIPELINE_LABEL[key]} · ${row.label}`, subtitle: period, ...range, pipeline: key, grupos: ["high", "demais"] });
              }}
            />
          )}
        </Panel>

        <Panel title="Por produto (os 6 + combo)" info={S.products()}>
          {summary.isLoading ? (
            <LoadingBlock />
          ) : highProducts.length ? (
            <ClickBarList
              items={highProducts.map(([produto, v]) => ({
                key: produto,
                label: produto,
                value: v.total,
                sub: `${neg(v.qtd)} · Contratos ${formatCount(v.contratos)} · Hubla & TMB ${formatCount(v.hubla)}`,
              }))}
              onItemClick={(produto) => open({ title: `Vendas de ${produto}`, subtitle: period, produto: [produto], grupos: ["high"] })}
            />
          ) : (
            <EmptyState>Sem vendas dos 6 produtos no período.</EmptyState>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Demais vendas por produto" info={S.demaisProducts()}>
          {summary.isLoading ? (
            <LoadingBlock />
          ) : demaisProducts.length ? (
            <div className="flex flex-col gap-3">
              <ClickBarList
                tone="blue"
                items={demaisProducts.map(([produto, v]) => ({ key: produto, label: `${produto} · ${formatCount(v.qtd)}`, value: v.total }))}
                onItemClick={(produto) => open({ title: `Demais vendas · ${produto}`, subtitle: period, produto: [produto], grupos: ["demais"] })}
              />
              {k.semProduto.length > 0 && (
                <WarnNote>
                  {neg(sum(k.semProduto, (r) => r.qtd))} ({formatMoney(sum(k.semProduto, (r) => r.total))}) da Hubla &amp; TMB estão sem produto preenchido no HubSpot.
                </WarnNote>
              )}
            </div>
          ) : (
            <EmptyState>Sem demais vendas no período.</EmptyState>
          )}
        </Panel>

        <section
          aria-label="Produtos fora dos 6"
          className="flex min-w-0 flex-col gap-3 rounded-xl border border-dashed border-amber-400 bg-amber-50 p-4 dark:border-amber-500/50 dark:bg-amber-950/20 md:p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-amber-900 dark:text-amber-200">Produtos fora dos 6 na pipeline de Contratos</h2>
            <span className="rounded-full bg-amber-200 px-2.5 py-1 text-xs font-semibold text-amber-900 dark:bg-amber-900/60 dark:text-amber-200">FORA DA SOMA</span>
          </div>
          <p className="text-sm text-amber-900/90 dark:text-amber-200/90">Não deveriam estar nessa pipeline. Aparecem aqui só para você corrigir na origem e não entram em nenhum total da tela.</p>
          {summary.isLoading ? (
            <LoadingBlock className="h-24" />
          ) : foraProducts.length ? (
            <>
              <ul className="flex flex-col divide-y divide-amber-200 text-sm dark:divide-amber-900/60">
                {foraProducts.map(([produto, v]) => (
                  <li key={produto}>
                    <button
                      type="button"
                      className="flex w-full justify-between gap-3 rounded px-1 py-2 text-left hover:bg-amber-100 dark:hover:bg-amber-900/30"
                      onClick={() => open({ title: `Fora dos 6 · ${produto === "(sem produto)" ? "sem produto preenchido" : produto}`, subtitle: period, produto: [produto], grupos: ["fora_dos_6"] })}
                      title="Clique para ver as linhas"
                    >
                      <span>{produto === "(sem produto)" ? "Sem produto preenchido" : produto}</span>
                      <span className="font-medium tabular-nums">
                        {formatCount(v.qtd)} · {formatMoney(v.total)}
                      </span>
                    </button>
                  </li>
                ))}
                <li>
                  <button
                    type="button"
                    className="flex w-full justify-between gap-3 rounded px-1 py-2 text-left font-semibold hover:bg-amber-100 dark:hover:bg-amber-900/30"
                    onClick={() => open({ title: "Produtos fora dos 6 (todos)", subtitle: period, grupos: ["fora_dos_6"] })}
                  >
                    <span>Total fora</span>
                    <span className="tabular-nums">
                      {formatCount(k.foraQtd)} · {formatMoney(k.foraTotal)}
                    </span>
                  </button>
                </li>
              </ul>
            </>
          ) : (
            <p className="py-2 text-sm text-amber-900 dark:text-amber-200">Nenhum negócio fora dos 6 no período.</p>
          )}
        </section>
      </div>

      <Panel
        title="Pagamentos da Hubla & TMB de produtos dos 6 (fora das Vendas)"
        info={S.duplicates()}
        action={
          dupQtd ? (
            <button type="button" className="text-sm font-medium text-primary underline underline-offset-2" onClick={() => open({ title: "Pagamentos da Hubla & TMB dos 6 (fora das Vendas)", subtitle: period, onlyDuplicates: true, grupos: ["high", "demais", "fora_dos_6"] })}>
              {neg(dupQtd)} · {formatMoney(dupTotal)} · ver negócios
            </button>
          ) : undefined
        }
      >
        {duplicates.isLoading ? (
          <LoadingBlock className="h-16" />
        ) : dupQtd ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Na Hubla &amp; TMB o negócio nasce a cada pagamento (a data do ganho é o momento do pagamento, e cada parcela vira um negócio). Para os produtos dos 6, a venda e a data do ganho são as da pipeline de Contratos; por isso esses pagamentos não entram nas Vendas. Eles entram na Receita e no Caixa.
            </p>
            <ul className="flex flex-wrap gap-2 text-sm">
              {(duplicates.data ?? []).map((d) => (
                <li key={d.produto}>
                  <button
                    type="button"
                    className="rounded-full border border-border bg-muted px-3 py-1 hover:bg-accent"
                    onClick={() => open({ title: `Pagamentos da Hubla & TMB · ${d.produto}`, subtitle: period, onlyDuplicates: true, produto: [d.produto], grupos: ["high", "demais", "fora_dos_6"] })}
                  >
                    {d.produto}: {formatCount(d.qtd)} · {formatMoney(d.total)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <EmptyState>Nenhum pagamento da Hubla & TMB de produto dos 6 no período.</EmptyState>
        )}
      </Panel>

      <MissingSales filters={filters} />

      <Panel title="Base de dados" info={S.deals()} action={<span className="text-sm text-muted-foreground">Todos os negócios que formam os números acima</span>}>
        <DetailTable drill={{ ...base, title: "Base de dados de vendas", grupos: ["high", "demais"] }} />
      </Panel>
    </ResultShell>
  );
}

export default function ResultadoVendas() {
  return (
    <DrillProvider>
      <Content />
    </DrillProvider>
  );
}
