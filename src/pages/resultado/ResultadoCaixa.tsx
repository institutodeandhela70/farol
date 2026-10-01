import { useMemo } from "react";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { bucketLabel, bucketsBetween } from "@/lib/iuliData";
import { resultPeriodText, useResultFilters } from "@/lib/resultFilters";
import { RESULT_SOURCES as S } from "@/lib/resultSources";
import { TREATMENT_SHORT, type Treatment } from "@/lib/categoryMap";
import { bucketRange, drillBase, type Drill } from "@/lib/detailData";
import { formatCount, formatMoney, formatPercent } from "@/lib/money";
import { useCashAging, useCashClients, useCashOut, useCashProducts, useCashSeries, useCashSummary, type CashSituation } from "@/lib/cashData";
import { EmptyState, LoadingBlock, MultiSelect, Panel, WarnNote } from "@/components/commercial/CommercialUI";
import { ClickBarList, ClickCashChart, KpiTile, SplitBar } from "@/components/result/ResultCharts";
import { DetailTable } from "@/components/result/DetailTable";
import { DrillProvider, useDrill } from "@/components/result/DrillContext";
import { ResultCompanyFilter, ResultPeriodBar, ResultShell } from "@/components/result/ResultUI";

const SITUATION_LABEL: Record<CashSituation, string> = { recebido: "Recebido", a_vencer: "A vencer", vencido: "Vencido" };
const OUT_ORDER = ["a_classificar", "sem_categoria", "fora_outros_produtos", "nao_operacional", "revisar"];
const OUT_LABEL: Record<string, string> = { ...TREATMENT_SHORT, sem_categoria: "Sem categoria carregada" };

// Faixa de atraso → dias (o vencido tem pelo menos 1 dia de atraso)
const AGING_DAYS: Record<string, [number, number | null]> = {
  "Até 30 dias": [1, 30],
  "31 a 90 dias": [31, 90],
  "91 a 180 dias": [91, 180],
  "181 a 365 dias": [181, 365],
  "Mais de 1 ano": [366, null],
};

const sumOf = <T,>(rows: T[] | undefined, pick: (r: T) => number) => (rows ?? []).reduce((a, r) => a + pick(r), 0);
const titulos = (n: number) => `${formatCount(n)} ${n === 1 ? "título" : "títulos"}`;

function Content() {
  const { workspace } = useWorkspace();
  const ws = workspace?.id;
  const drill = useDrill();
  const { filters, set } = useResultFilters();

  const series = useCashSeries(ws, filters);
  const summary = useCashSummary(ws, filters);
  const out = useCashOut(ws, filters);
  const clients = useCashClients(ws, filters, 10);
  const aging = useCashAging(ws, filters);
  const products = useCashProducts(ws, filters);

  const base = drillBase("caixa", filters);
  const open = (d: Partial<Drill> & Pick<Drill, "title">) => drill.open({ ...base, tratamento: "soma", ...d });
  const period = resultPeriodText(filters);

  const k = useMemo(() => {
    const rows = summary.data ?? [];
    const by = (s: CashSituation) => ({ total: sumOf(rows.filter((r) => r.situacao === s), (r) => r.total), qtd: sumOf(rows.filter((r) => r.situacao === s), (r) => r.qtd) });
    const recebido = by("recebido");
    const aVencer = by("a_vencer");
    const vencido = by("vencido");
    const produtos = new Map<string, { total: number; recebido: number; aberto: number; qtd: number }>();
    for (const r of rows) {
      const cur = produtos.get(r.produto) ?? { total: 0, recebido: 0, aberto: 0, qtd: 0 };
      cur.total += r.total;
      cur.qtd += r.qtd;
      if (r.situacao === "recebido") cur.recebido += r.total;
      else cur.aberto += r.total;
      produtos.set(r.produto, cur);
    }
    return { recebido, aVencer, vencido, total: recebido.total + aVencer.total + vencido.total, qtd: recebido.qtd + aVencer.qtd + vencido.qtd, produtos: [...produtos.entries()].sort((a, b) => b[1].total - a[1].total) };
  }, [summary.data]);

  const chart = useMemo(() => {
    const map = new Map<string, { recebido: number; a_vencer: number; vencido: number }>();
    for (const r of series.data ?? []) {
      const cur = map.get(r.bucket) ?? { recebido: 0, a_vencer: 0, vencido: 0 };
      cur[r.situacao] += r.total;
      map.set(r.bucket, cur);
    }
    let acc = 0;
    return bucketsBetween(filters.from, filters.to, filters.grain).map((b) => {
      const v = map.get(b) ?? { recebido: 0, a_vencer: 0, vencido: 0 };
      acc += v.recebido + v.a_vencer + v.vencido;
      return { label: bucketLabel(b, filters.grain), bucket: b, ...v, acumulado: acc };
    });
  }, [series.data, filters.from, filters.to, filters.grain]);

  const outGroups = useMemo(() => {
    const map = new Map<string, { total: number; qtd: number; cats: { categoria: string; total: number; qtd: number }[] }>();
    for (const r of out.data ?? []) {
      const cur = map.get(r.tratamento) ?? { total: 0, qtd: 0, cats: [] };
      cur.total += r.total;
      cur.qtd += r.qtd;
      cur.cats.push({ categoria: r.categoria, total: r.total, qtd: r.qtd });
      map.set(r.tratamento, cur);
    }
    for (const g of map.values()) g.cats.sort((a, b) => b.total - a.total);
    return [...map.entries()].sort((a, b) => OUT_ORDER.indexOf(a[0]) - OUT_ORDER.indexOf(b[0]));
  }, [out.data]);

  const outTotal = outGroups.reduce((a, [, g]) => a + g.total, 0);
  const toClassify = outGroups.find(([t]) => t === "a_classificar")?.[1];
  const noCategory = outGroups.find(([t]) => t === "sem_categoria")?.[1];
  const agingTotal = sumOf(aging.data, (r) => r.total);
  const agingOld = (aging.data ?? []).find((r) => r.ordem === 5)?.total ?? 0;
  const aReceber = k.aVencer.total + k.vencido.total;
  const today = useMemo(() => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()), []);
  const yesterday = useMemo(() => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }, [today]);

  return (
    <ResultShell
      title="Caixa"
      description={`${period} · receitas de produto da IULI pela data de vencimento`}
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
          <b>Precisa categorizar:</b> {formatCount(toClassify.qtd)} lançamentos ({formatMoney(toClassify.total)}) com vencimento no período estão em &quot;a classificar&quot; na IULI e ficam fora do Caixa até receberem a categoria do produto.
        </WarnNote>
      )}

      <section aria-label="Indicadores" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile info={S.cashTotal()} label="Caixa previsto no período" value={formatMoney(k.total)} sub={titulos(k.qtd)} loading={summary.isLoading} onClick={() => open({ title: "Caixa previsto no período", subtitle: period })} />
        <KpiTile
          info={S.cashReceived()}
          label="Recebido"
          value={formatMoney(k.recebido.total)}
          sub={`${titulos(k.recebido.qtd)} · ${formatPercent(k.total ? k.recebido.total / k.total : null)}`}
          loading={summary.isLoading}
          onClick={() => open({ title: "Recebido", subtitle: period, situacoes: ["recebido"] })}
        />
        <KpiTile
          info={S.cashOpen()}
          label="A vencer"
          value={formatMoney(k.aVencer.total)}
          sub={`${titulos(k.aVencer.qtd)} · ${formatPercent(k.total ? k.aVencer.total / k.total : null)}`}
          loading={summary.isLoading}
          onClick={() => open({ title: "A vencer", subtitle: period, situacoes: ["a_vencer"] })}
        />
        <KpiTile
          info={S.cashOverdue()}
          label="Vencido"
          value={formatMoney(k.vencido.total)}
          sub={`${titulos(k.vencido.qtd)} · ${formatPercent(k.total ? k.vencido.total / k.total : null)}`}
          tone={k.total && k.vencido.total / k.total > 0.2 ? "warn" : "default"}
          loading={summary.isLoading}
          onClick={() => open({ title: "Vencido", subtitle: period, situacoes: ["vencido"] })}
        />
      </section>

      <Panel title="Recebido × ainda a receber" info={S.cashTotal()}>
        {summary.isLoading ? (
          <LoadingBlock className="h-16" />
        ) : k.total > 0 ? (
          <SplitBar
            left={{ label: "Recebido", value: k.recebido.total, display: formatMoney(k.recebido.total), sub: titulos(k.recebido.qtd), onClick: () => open({ title: "Recebido", subtitle: period, situacoes: ["recebido"] }) }}
            right={{
              label: "A receber",
              value: aReceber,
              display: formatMoney(aReceber),
              sub: `${titulos(k.aVencer.qtd + k.vencido.qtd)} · a vencer + vencido`,
              onClick: () => open({ title: "A receber (a vencer + vencido)", subtitle: period, situacoes: ["a_vencer", "vencido"] }),
            }}
          />
        ) : (
          <EmptyState>Sem receitas de produto com vencimento no período.</EmptyState>
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel title="Entradas por vencimento" info={S.cashSeries()} action={<span className="text-sm text-muted-foreground">Valor {filters.grain === "day" ? "por dia" : filters.grain === "week" ? "por semana" : "por mês"} · linha = acumulado · clique numa barra</span>}>
          {series.isLoading ? (
            <LoadingBlock className="h-72" />
          ) : (
            <ClickCashChart
              data={chart}
              onBarClick={(row, situacao) => {
                const range = bucketRange(row.bucket, filters.grain, filters);
                open({ title: `${SITUATION_LABEL[situacao]} · ${row.label}`, subtitle: period, ...range, situacoes: [situacao] });
              }}
            />
          )}
        </Panel>

        <Panel title="Caixa por produto" info={S.cashProducts()}>
          {summary.isLoading ? (
            <LoadingBlock />
          ) : k.produtos.length ? (
            <ClickBarList
              items={k.produtos.slice(0, 10).map(([produto, v]) => ({
                key: produto,
                label: produto,
                value: v.total,
                sub: `recebido ${formatMoney(v.recebido)} · em aberto ${formatMoney(v.aberto)}`,
                segments: [
                  { value: v.recebido, className: "bg-primary" },
                  { value: v.aberto, className: "bg-sky-500" },
                ],
              }))}
              onItemClick={(produto) => open({ title: `Caixa de ${produto}`, subtitle: period, produto: [produto] })}
            />
          ) : (
            <EmptyState>Sem receitas de produto no período.</EmptyState>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Vencido hoje, por tempo de atraso" info={S.cashAging()}>
          {aging.isLoading ? (
            <LoadingBlock />
          ) : aging.data?.length ? (
            <div className="flex flex-col gap-3">
              <ClickBarList
                tone="blue"
                items={aging.data.map((r) => ({ key: r.faixa, label: `${r.faixa} · ${formatCount(r.qtd)}`, value: r.total }))}
                onItemClick={(faixa) => {
                  const [min, max] = AGING_DAYS[faixa] ?? [1, null];
                  open({ title: `Vencido · ${faixa}`, subtitle: "Todo o vencido de hoje (não depende do período)", from: "2000-01-01", to: yesterday, situacoes: ["vencido"], atrasoMin: min, atrasoMax: max });
                }}
              />
              {agingTotal > 0 && agingOld / agingTotal > 0.5 && (
                <WarnNote>
                  {formatPercent(agingOld / agingTotal, 0)} do vencido ({formatMoney(agingOld)}) tem mais de 1 ano. Muito disso deve ser baixa que ninguém registrou na IULI, e não inadimplência: vale conferir antes de cobrar.
                </WarnNote>
              )}
            </div>
          ) : (
            <EmptyState>Nenhum título vencido de produto.</EmptyState>
          )}
        </Panel>

        <Panel title="Maiores clientes do período" info={S.cashClients()}>
          {clients.isLoading ? (
            <LoadingBlock />
          ) : clients.data?.length ? (
            <ClickBarList
              items={clients.data.map((c) => ({
                key: c.cliente,
                label: c.cliente,
                value: c.total,
                sub: `recebido ${formatMoney(c.recebido)} · em aberto ${formatMoney(c.aberto)} · ${titulos(c.qtd)}`,
                segments: [
                  { value: c.recebido, className: "bg-primary" },
                  { value: c.aberto, className: "bg-sky-500" },
                ],
              }))}
              onItemClick={(cliente) => open({ title: `Caixa de ${cliente}`, subtitle: period, search: cliente })}
            />
          ) : (
            <EmptyState>Sem clientes no período.</EmptyState>
          )}
        </Panel>
      </div>

      <section
        aria-label="Fora da soma"
        className="flex min-w-0 flex-col gap-3 rounded-xl border border-dashed border-amber-400 bg-amber-50 p-4 dark:border-amber-500/50 dark:bg-amber-950/20 md:p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-amber-900 dark:text-amber-200">Com vencimento no período, mas fora da soma</h2>
          <span className="rounded-full bg-amber-200 px-2.5 py-1 text-xs font-semibold text-amber-900 dark:bg-amber-900/60 dark:text-amber-200">FORA DA SOMA · {formatMoney(outTotal)}</span>
        </div>
        <p className="text-sm text-amber-900/90 dark:text-amber-200/90">Não são receita de produto (ou ainda não têm a categoria do produto), então não entram em nenhum total do Caixa. Clique para ver as linhas; as categorias se ajustam em Categorias.</p>
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

      <Panel title="Base de dados" info={S.cashTitles()} action={<span className="text-sm text-muted-foreground">Todos os títulos que formam os números acima</span>}>
        <DetailTable drill={{ ...base, title: "Base de dados do caixa", tratamento: "soma" }} />
      </Panel>
    </ResultShell>
  );
}

export default function ResultadoCaixa() {
  return (
    <DrillProvider>
      <Content />
    </DrillProvider>
  );
}
