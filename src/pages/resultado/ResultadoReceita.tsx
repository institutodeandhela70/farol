import { Fragment, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { bucketLabel, bucketsBetween } from "@/lib/iuliData";
import { addMonthsYM, monthLabelYM, resultPeriodText, useResultFilters } from "@/lib/resultFilters";
import { RESULT_SOURCES as S } from "@/lib/resultSources";
import { TREATMENT_SHORT, type Treatment } from "@/lib/categoryMap";
import { bucketRange, drillBase, monthRange, type Drill } from "@/lib/detailData";
import { formatCount, formatMoney, formatPercent, formatAxis } from "@/lib/money";
import { refreshRevenueLinks, safraRange, useRevenueOut, useRevenueProducts, useRevenueSafra, useRevenueSeries, useRevenueSummary, type RevenueOrigin } from "@/lib/receitaData";
import { EmptyState, LoadingBlock, MultiSelect, Panel, WarnNote } from "@/components/commercial/CommercialUI";
import { ClickBarChart, ClickBarList, KpiTile, SplitBar } from "@/components/result/ResultCharts";
import { DetailTable } from "@/components/result/DetailTable";
import { DrillProvider, useDrill } from "@/components/result/DrillContext";
import { ResultCompanyFilter, ResultPeriodBar, ResultShell } from "@/components/result/ResultUI";
import { TONE } from "@/components/iuli/iuliTheme";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const ORIGIN_LABEL: Record<RevenueOrigin, string> = { mes: "Venda do mês", outros: "Venda de outros meses", sem_negocio: "Sem negócio vinculado" };
const OUT_ORDER = ["a_classificar", "sem_categoria", "fora_outros_produtos", "nao_operacional", "revisar"];
const OUT_LABEL: Record<string, string> = { ...TREATMENT_SHORT, sem_categoria: "Sem categoria carregada" };

const dayBR = (iso: string) => iso.split("-").reverse().join("/");
const titulos = (n: number) => `${formatCount(n)} ${n === 1 ? "título" : "títulos"}`;

/** Título do quadro: "Setembro/2026 por competência", "Últimos 7 dias por competência"… */
function competenciaTitle(f: { preset: string; month: string | null; from: string; to: string }) {
  const monthName = (ym: string) => {
    const t = monthLabelYM(ym).replace(" de ", "/");
    return t.charAt(0).toUpperCase() + t.slice(1);
  };
  if (f.preset === "mes" && f.month) return `${monthName(f.month)} por competência`;
  if (f.preset === "mes_atual") return `${monthName(f.from.slice(0, 7))} (mês atual) por competência`;
  if (f.preset === "7d") return "Últimos 7 dias por competência";
  return `${dayBR(f.from)} a ${dayBR(f.to)} por competência`;
}

function Content() {
  const { workspace, role } = useWorkspace();
  const ws = workspace?.id;
  const canEdit = role === "owner" || role === "admin";
  const queryClient = useQueryClient();
  const drill = useDrill();
  const { filters, set } = useResultFilters();

  const summary = useRevenueSummary(ws, filters);
  const series = useRevenueSeries(ws, filters);
  const safra = useRevenueSafra(ws, filters);
  const out = useRevenueOut(ws, filters);
  const products = useRevenueProducts(ws, filters);

  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const base = drillBase("receita", filters);
  const open = (d: Partial<Drill> & Pick<Drill, "title">) => drill.open({ ...base, tratamento: "soma", ...d });
  const period = resultPeriodText(filters);

  const k = useMemo(() => {
    const rows = summary.data ?? [];
    const by = (o: RevenueOrigin) => ({
      total: rows.filter((r) => r.origem === o).reduce((a, r) => a + r.total, 0),
      qtd: rows.filter((r) => r.origem === o).reduce((a, r) => a + r.qtd, 0),
    });
    const mes = by("mes");
    const outros = by("outros");
    const sem = by("sem_negocio");
    const produtos = new Map<string, { total: number; mes: number; outros: number; sem: number; qtd: number }>();
    for (const r of rows) {
      const cur = produtos.get(r.produto) ?? { total: 0, mes: 0, outros: 0, sem: 0, qtd: 0 };
      cur.total += r.total;
      cur.qtd += r.qtd;
      if (r.origem === "mes") cur.mes += r.total;
      else if (r.origem === "outros") cur.outros += r.total;
      else cur.sem += r.total;
      produtos.set(r.produto, cur);
    }
    const bySit = (st: string) => ({ total: rows.filter((r) => r.situacao === st).reduce((a, r) => a + r.total, 0), qtd: rows.filter((r) => r.situacao === st).reduce((a, r) => a + r.qtd, 0) });
    return { recebido: bySit("recebido"), areceber: bySit("a_receber"), mes, outros, sem, total: mes.total + outros.total + sem.total, qtd: mes.qtd + outros.qtd + sem.qtd, produtos: [...produtos.entries()].sort((a, b) => b[1].total - a[1].total) };
  }, [summary.data]);

  const chart = useMemo(() => {
    const map = new Map<string, Record<RevenueOrigin, number>>();
    for (const r of series.data ?? []) {
      const cur = map.get(r.bucket) ?? { mes: 0, outros: 0, sem_negocio: 0 };
      cur[r.origem] += r.total;
      map.set(r.bucket, cur);
    }
    return bucketsBetween(filters.from, filters.to, filters.grain).map((b) => ({ label: bucketLabel(b, filters.grain), bucket: b, ...(map.get(b) ?? { mes: 0, outros: 0, sem_negocio: 0 }) }));
  }, [series.data, filters.from, filters.to, filters.grain]);

  const matrix = useMemo(() => {
    const rows = safra.data ?? [];
    const range = safraRange(filters);
    const entradas: string[] = [];
    for (let ym = range.from.slice(0, 7); ym <= range.to.slice(0, 7); ym = addMonthsYM(ym, 1)) entradas.push(ym);
    const vendaSet = new Set<string>();
    const cell = new Map<string, number>();
    const sem = new Map<string, number>();
    const rowTotal = new Map<string, number>();
    for (const r of rows) {
      const e = r.mes_entrada.slice(0, 7);
      rowTotal.set(e, (rowTotal.get(e) ?? 0) + r.total);
      if (r.mes_venda) {
        const v = r.mes_venda.slice(0, 7);
        vendaSet.add(v);
        cell.set(`${e}|${v}`, (cell.get(`${e}|${v}`) ?? 0) + r.total);
      } else sem.set(e, (sem.get(e) ?? 0) + r.total);
    }
    const vendas = [...vendaSet].sort().slice(-14);
    const hidden = vendaSet.size - vendas.length;
    const max = Math.max(1, ...cell.values(), ...sem.values());
    return { entradas: entradas.reverse(), vendas, cell, sem, rowTotal, max, hidden };
  }, [safra.data, filters]);

  const outGroups = useMemo(() => {
    const map = new Map<string, { total: number; qtd: number; cats: { categoria: string; total: number }[] }>();
    for (const r of out.data ?? []) {
      const cur = map.get(r.tratamento) ?? { total: 0, qtd: 0, cats: [] };
      cur.total += r.total;
      cur.qtd += r.qtd;
      cur.cats.push({ categoria: r.categoria, total: r.total });
      map.set(r.tratamento, cur);
    }
    for (const g of map.values()) g.cats.sort((a, b) => b.total - a.total);
    return [...map.entries()].sort((a, b) => OUT_ORDER.indexOf(a[0]) - OUT_ORDER.indexOf(b[0]));
  }, [out.data]);

  const outTotal = outGroups.reduce((a, [, g]) => a + g.total, 0);
  const toClassify = outGroups.find(([t]) => t === "a_classificar")?.[1];
  const noCategory = outGroups.find(([t]) => t === "sem_categoria")?.[1];
  const linked = k.mes.total + k.outros.total;

  const refresh = async () => {
    if (!ws) return;
    setRefreshing(true);
    setMessage(null);
    try {
      const count = await refreshRevenueLinks(ws);
      await queryClient.invalidateQueries({ queryKey: ["revenue"] });
      await queryClient.invalidateQueries({ queryKey: ["detail"] });
      setMessage(`Vínculos atualizados (${formatCount(count)} lançamentos revisados).`);
    } catch (err) {
      setMessage(`Não foi possível atualizar: ${(err as Error).message}`);
    } finally {
      setRefreshing(false);
    }
  };

  const countOf = (o: RevenueOrigin) => (o === "mes" ? k.mes.qtd : o === "outros" ? k.outros.qtd : k.sem.qtd);

  return (
    <ResultShell
      title="Receita"
      description={`${period} · receita faturada na IULI (data de competência: a venda que já está na IULI, tenha o dinheiro entrado ou não), de receita de produto`}
      filters={
        <>
          <ResultPeriodBar filters={filters} set={set} />
          <div className="flex-1" />
          <ResultCompanyFilter filters={filters} set={set} />
          <MultiSelect label="Produto" allLabel="Todos os produtos" options={(products.data ?? []).map((p) => ({ value: p, label: p }))} selected={filters.produto} onChange={(v) => set({ produto: v })} />
        </>
      }
    >
      {toClassify && toClassify.total > 0 && (
        <WarnNote>
          <b>Precisa categorizar:</b> {formatCount(toClassify.qtd)} lançamentos ({formatMoney(toClassify.total)}) com competência no período estão em &quot;a classificar&quot; na IULI e ficam fora da Receita até receberem a categoria do produto.
        </WarnNote>
      )}

      <Panel title={competenciaTitle(filters)} info={S.revTotal()} action={<span className="text-sm text-muted-foreground">Clique numa linha para ver os registros</span>}>
        {summary.isLoading ? (
          <LoadingBlock className="h-32" />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium"><span className="sr-only">Linha</span></th>
                  <th className="px-4 py-2.5 font-medium">Títulos</th>
                  <th className="px-4 py-2.5 text-right font-medium">Valor</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { key: "total", label: "Receita faturada", qtd: k.qtd, valor: k.total, bold: true, drill: { title: "Receita faturada", subtitle: period } },
                  { key: "recebido", label: "Já recebido (com baixa)", qtd: k.recebido.qtd, valor: k.recebido.total, bold: false, drill: { title: "Já recebido (com baixa)", subtitle: period, situacoes: ["recebido"] } },
                  { key: "areceber", label: "A receber (sem baixa)", qtd: k.areceber.qtd, valor: k.areceber.total, bold: true, drill: { title: "A receber (sem baixa)", subtitle: period, situacoes: ["a_receber"] } },
                ].map((row) => (
                  <tr
                    key={row.key}
                    role="button"
                    tabIndex={0}
                    title="Clique para ver os registros"
                    onClick={() => open(row.drill)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        open(row.drill);
                      }
                    }}
                    className="cursor-pointer border-t border-border hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                  >
                    <td className={cn("px-4 py-3", row.bold && "font-semibold")}>{row.label}</td>
                    <td className="px-4 py-3 tabular-nums">{formatCount(row.qtd)}</td>
                    <td className={cn("px-4 py-3 text-right tabular-nums", row.bold && "font-semibold")}>{formatMoney(row.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <section aria-label="Indicadores" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <KpiTile info={S.revTotal()} label="Receita faturada no período" value={formatMoney(k.total)} sub={`${titulos(k.qtd)} · por data de competência`} loading={summary.isLoading} onClick={() => open({ title: "Receita do período", subtitle: period })} />
        <KpiTile
          info={S.revTotal()}
          label="Já recebido (com baixa)"
          value={formatMoney(k.recebido.total)}
          sub={`${titulos(k.recebido.qtd)} · ${formatPercent(k.total ? k.recebido.total / k.total : null)} da receita`}
          loading={summary.isLoading}
          onClick={() => open({ title: "Receita já recebida (com baixa)", subtitle: period, situacoes: ["recebido"] })}
        />
        <KpiTile
          info={S.revTotal()}
          label="A receber (sem baixa)"
          value={formatMoney(k.areceber.total)}
          sub={`${titulos(k.areceber.qtd)} · ${formatPercent(k.total ? k.areceber.total / k.total : null)} da receita · o dinheiro entra no vencimento`}
          loading={summary.isLoading}
          onClick={() => open({ title: "Receita a receber (sem baixa)", subtitle: period, situacoes: ["a_receber"] })}
        />
        <KpiTile
          info={S.revMes()}
          label="De vendas do mês"
          value={formatMoney(k.mes.total)}
          sub={`${titulos(k.mes.qtd)} · ${formatPercent(k.total ? k.mes.total / k.total : null)} da receita`}
          loading={summary.isLoading}
          onClick={() => open({ title: "Receita de vendas do mês", subtitle: period, origem: "mes" })}
        />
        <KpiTile
          info={S.revOutros()}
          label="De vendas de outros meses"
          value={formatMoney(k.outros.total)}
          sub={`${titulos(k.outros.qtd)} · ${formatPercent(k.total ? k.outros.total / k.total : null)} da receita`}
          loading={summary.isLoading}
          onClick={() => open({ title: "Receita de vendas de outros meses", subtitle: period, origem: "outros" })}
        />
        <KpiTile
          info={S.revSem()}
          label="Sem negócio vinculado"
          value={formatMoney(k.sem.total)}
          sub={`${titulos(k.sem.qtd)} · ${formatPercent(k.total ? k.sem.total / k.total : null)} da receita`}
          tone={k.total && k.sem.total / k.total > 0.25 ? "warn" : "default"}
          loading={summary.isLoading}
          onClick={() => open({ title: "Receita sem negócio vinculado", subtitle: period, origem: "sem_negocio" })}
        />
      </section>

      <Panel title="Venda do mês × Venda de outros meses" info={S.revTotal()}>
        {summary.isLoading ? (
          <LoadingBlock className="h-16" />
        ) : linked > 0 ? (
          <div className="flex flex-col gap-2">
            <SplitBar
              left={{ label: "Vendas do mês", value: k.mes.total, display: formatMoney(k.mes.total), sub: `${titulos(k.mes.qtd)} · negócio ganho no mesmo mês da competência`, onClick: () => open({ title: "Receita de vendas do mês", subtitle: period, origem: "mes" }) }}
              right={{ label: "Vendas de outros meses", value: k.outros.total, display: formatMoney(k.outros.total), sub: `${titulos(k.outros.qtd)} · negócio ganho em outro mês`, onClick: () => open({ title: "Receita de vendas de outros meses", subtitle: period, origem: "outros" }) }}
            />
            {k.sem.total > 0 && <p className="text-sm text-muted-foreground">A barra considera só o que tem negócio vinculado ({formatMoney(linked)}); {formatMoney(k.sem.total)} ficam sem negócio e contam na receita total.</p>}
          </div>
        ) : (
          <EmptyState>Sem receita de produto no período.</EmptyState>
        )}
      </Panel>

      <Panel title="Já recebido × a receber" info={S.revTotal()}>
        {summary.isLoading ? (
          <LoadingBlock className="h-16" />
        ) : k.total > 0 ? (
          <SplitBar
            left={{ label: "Já recebido", value: k.recebido.total, display: formatMoney(k.recebido.total), sub: `${titulos(k.recebido.qtd)} · com baixa na IULI`, onClick: () => open({ title: "Receita já recebida", subtitle: period, situacoes: ["recebido"] }) }}
            right={{ label: "A receber", value: k.areceber.total, display: formatMoney(k.areceber.total), sub: `${titulos(k.areceber.qtd)} · vendido e faturado, o dinheiro entra no vencimento`, onClick: () => open({ title: "Receita a receber", subtitle: period, situacoes: ["a_receber"] }) }}
          />
        ) : (
          <EmptyState>Sem receita de produto no período.</EmptyState>
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel title="Receita no período" info={S.revSeries()} action={<span className="text-sm text-muted-foreground">Valor {filters.grain === "day" ? "por dia" : filters.grain === "week" ? "por semana" : "por mês"} de competência · clique numa barra</span>}>
          {series.isLoading ? (
            <LoadingBlock className="h-72" />
          ) : (
            <ClickBarChart
              data={chart}
              series={[
                { key: "mes", label: "Venda do mês", color: TONE.primary },
                { key: "outros", label: "Venda de outros meses", color: TONE.blue },
                { key: "sem_negocio", label: "Sem negócio vinculado", color: TONE.amber },
              ]}
              onBarClick={(row, key) => {
                const range = bucketRange(String(row.bucket), filters.grain, filters);
                open({ title: `Receita · ${ORIGIN_LABEL[key as RevenueOrigin]} · ${row.label}`, subtitle: period, ...range, origem: key });
              }}
            />
          )}
        </Panel>

        <Panel title="Receita por produto" info={S.revProducts()}>
          {summary.isLoading ? (
            <LoadingBlock />
          ) : k.produtos.length ? (
            <ClickBarList
              items={k.produtos.slice(0, 10).map(([produto, v]) => ({
                key: produto,
                label: produto,
                value: v.total,
                sub: `do mês ${formatMoney(v.mes)} · outros meses ${formatMoney(v.outros)} · sem negócio ${formatMoney(v.sem)}`,
                segments: [
                  { value: v.mes, className: "bg-primary" },
                  { value: v.outros, className: "bg-sky-500" },
                  { value: v.sem, className: "bg-amber-500" },
                ],
              }))}
              onItemClick={(produto) => open({ title: `Receita de ${produto}`, subtitle: period, produto: [produto] })}
            />
          ) : (
            <EmptyState>Sem receita de produto no período.</EmptyState>
          )}
        </Panel>
      </div>

      <Panel title="Safra: de que mês são as vendas faturadas em cada mês" info={S.revSafra()} action={<span className="text-sm text-muted-foreground">Linha = mês da competência · coluna = mês da venda no HubSpot · clique numa célula</span>}>
        {safra.isLoading ? (
          <LoadingBlock />
        ) : matrix.vendas.length || matrix.sem.size ? (
          <div className="flex flex-col gap-2">
            <div className="-mx-4 overflow-x-auto md:mx-0">
              <table className="w-full min-w-[720px] border-separate border-spacing-1 text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1 text-left font-medium">Competência</th>
                    {matrix.vendas.map((v) => (
                      <th key={v} className="px-2 py-1 text-right font-medium">
                        {monthLabelYM(v, true)}
                      </th>
                    ))}
                    <th className="px-2 py-1 text-right font-medium">Sem negócio</th>
                    <th className="px-2 py-1 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {matrix.entradas.map((e) => {
                    const cellBtn = (value: number, bg: string | undefined, onClick: () => void, ring = false) => (
                      <td className="p-0">
                        {value ? (
                          <button
                            type="button"
                            onClick={onClick}
                            title={`${formatMoney(value)} · clique para ver as linhas`}
                            className={cn("w-full rounded px-2 py-1.5 text-right tabular-nums hover:ring-2 hover:ring-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", ring && "ring-1 ring-primary")}
                            style={bg ? { backgroundColor: bg } : undefined}
                          >
                            {formatAxis(value)}
                          </button>
                        ) : (
                          <span className="block px-2 py-1.5" />
                        )}
                      </td>
                    );
                    return (
                      <tr key={e}>
                        <th className="whitespace-nowrap px-2 py-1 text-left font-medium">{monthLabelYM(e, true)}</th>
                        {matrix.vendas.map((v) => {
                          const value = matrix.cell.get(`${e}|${v}`) ?? 0;
                          const bg = value ? `hsl(var(--primary) / ${Math.max(0.1, (value / matrix.max) * 0.75).toFixed(2)})` : undefined;
                          return (
                            <Fragment key={v}>
                              {cellBtn(value, bg, () => open({ title: `Receita de ${monthLabelYM(e)} · venda de ${monthLabelYM(v)}`, subtitle: "Safra", ...monthRange(e), mesVenda: `${v}-01` }), e === v)}
                            </Fragment>
                          );
                        })}
                        {cellBtn(
                          matrix.sem.get(e) ?? 0,
                          matrix.sem.get(e) ? `hsl(38 92% 50% / ${Math.max(0.1, ((matrix.sem.get(e) ?? 0) / matrix.max) * 0.75).toFixed(2)})` : undefined,
                          () => open({ title: `Receita de ${monthLabelYM(e)} · sem negócio vinculado`, subtitle: "Safra", ...monthRange(e), origem: "sem_negocio" }),
                        )}
                        <td className="p-0">
                          <button type="button" className="w-full rounded px-2 py-1.5 text-right font-semibold tabular-nums hover:bg-accent" title={`${formatMoney(matrix.rowTotal.get(e) ?? 0)} · clique para ver as linhas`} onClick={() => open({ title: `Receita de ${monthLabelYM(e)}`, subtitle: "Safra", ...monthRange(e) })}>
                            {formatAxis(matrix.rowTotal.get(e) ?? 0)}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              Valores abreviados (mil / mi); o valor exato aparece ao passar o mouse e no detalhamento. A borda destaca competência e venda no mesmo mês.
              {matrix.hidden > 0 ? ` Mostrando os 14 meses de venda mais recentes (${matrix.hidden} mais antigos ocultos).` : ""} Usa os 6 meses até {dayBR(filters.to)}.
            </p>
          </div>
        ) : (
          <EmptyState>Sem receita de produto nos meses da matriz.</EmptyState>
        )}
      </Panel>

      <Panel
        title="Conciliação: lançamentos sem negócio vinculado"
        info={S.revSem()}
        action={
          canEdit ? (
            <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
              {refreshing ? "Atualizando…" : "Atualizar vínculos"}
            </Button>
          ) : undefined
        }
      >
        {message && <p role="status" className="text-sm font-medium text-primary">{message}</p>}
        {summary.isLoading ? (
          <LoadingBlock className="h-16" />
        ) : countOf("sem_negocio") ? (
          <div className="flex flex-col gap-2">
            <button type="button" className="self-start text-left text-sm font-medium text-primary underline underline-offset-2" onClick={() => open({ title: "Receita sem negócio vinculado", subtitle: period, origem: "sem_negocio" })}>
              {titulos(k.sem.qtd)} · {formatMoney(k.sem.total)} — ver os lançamentos
            </button>
            <p className="text-sm text-muted-foreground">
              Causas comuns: comprador pessoa jurídica (o negócio está no nome de outra pessoa), nome diferente entre IULI e HubSpot, ou venda fora das pipelines Contratos e Hubla &amp; TMB. Elas continuam contando na receita.
            </p>
          </div>
        ) : (
          <EmptyState>Todos os lançamentos do período têm negócio vinculado.</EmptyState>
        )}
      </Panel>

      <section
        aria-label="Fora da soma"
        className="flex min-w-0 flex-col gap-3 rounded-xl border border-dashed border-amber-400 bg-amber-50 p-4 dark:border-amber-500/50 dark:bg-amber-950/20 md:p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-amber-900 dark:text-amber-200">Faturado no período, mas fora da soma</h2>
          <span className="rounded-full bg-amber-200 px-2.5 py-1 text-xs font-semibold text-amber-900 dark:bg-amber-900/60 dark:text-amber-200">FORA DA SOMA · {formatMoney(outTotal)}</span>
        </div>
        <p className="text-sm text-amber-900/90 dark:text-amber-200/90">Não são receita de produto (ou ainda não têm a categoria do produto). Não entram em nenhum total da Receita. Clique para ver as linhas; as categorias se ajustam em Categorias.</p>
        {out.isLoading ? (
          <LoadingBlock className="h-24" />
        ) : outGroups.length ? (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {outGroups.map(([tratamento, g]) => (
              <li key={tratamento} className="rounded-lg border border-amber-200 bg-white/60 p-3 dark:border-amber-900/60 dark:bg-transparent">
                <button
                  type="button"
                  className="flex w-full justify-between gap-3 text-left text-sm font-semibold hover:underline"
                  onClick={() => open({ title: `Fora da soma · ${OUT_LABEL[tratamento as Treatment | "sem_categoria"] ?? tratamento}`, subtitle: period, tratamento })}
                >
                  <span>{OUT_LABEL[tratamento as Treatment | "sem_categoria"] ?? tratamento}</span>
                  <span className="tabular-nums">
                    {formatCount(g.qtd)} · {formatMoney(g.total)}
                  </span>
                </button>
                <ul className="mt-1.5 flex flex-col text-sm text-amber-900/90 dark:text-amber-200/90">
                  {g.cats.slice(0, 4).map((c) => (
                    <li key={c.categoria}>
                      <button
                        type="button"
                        className="flex w-full justify-between gap-3 text-left hover:underline"
                        onClick={() => open({ title: `Fora da soma · ${c.categoria}`, subtitle: period, tratamento, categoria: c.categoria === "(sem categoria)" ? null : c.categoria })}
                      >
                        <span className="truncate">{c.categoria}</span>
                        <span className="tabular-nums">{formatMoney(c.total)}</span>
                      </button>
                    </li>
                  ))}
                  {g.cats.length > 4 && <li className="text-xs">+ {g.cats.length - 4} categorias</li>}
                </ul>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-amber-900 dark:text-amber-200">Nada fora da soma no período.</p>
        )}
        {noCategory && noCategory.total > 0 && (
          <p className="text-sm text-amber-900 dark:text-amber-200">
            {formatMoney(noCategory.total)} ainda sem categoria carregada: a carga histórica da IULI continua em segundo plano, do mês atual para trás. Períodos mais antigos podem aparecer incompletos.
          </p>
        )}
      </section>

      <Panel title="Base de dados" info={S.revTitles()} action={<span className="text-sm text-muted-foreground">Todos os títulos que formam os números acima</span>}>
        <DetailTable drill={{ ...base, title: "Base de dados da receita", tratamento: "soma" }} />
      </Panel>
    </ResultShell>
  );
}

export default function ResultadoReceita() {
  return (
    <DrillProvider>
      <Content />
    </DrillProvider>
  );
}
