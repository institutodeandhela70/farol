import { useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { bucketLabel, bucketsBetween } from "@/lib/iuliData";
import { addMonthsYM, monthLabelYM, resultPeriodText, useResultFilters, type ResultFilters } from "@/lib/resultFilters";
import { RESULT_SOURCES as S } from "@/lib/resultSources";
import { useCategoryMap } from "@/lib/categoryMap";
import { drillBase, monthRange, type Domain, type Drill } from "@/lib/detailData";
import { formatCount, formatMoney, formatPercent } from "@/lib/money";
import { useSalesDuplicates, useSalesSeries, useSalesSummary } from "@/lib/salesData";
import { useRevenueOut, useRevenueSeries, useRevenueSummary } from "@/lib/receitaData";
import { useCashAging, useCashOut, useCashSeries, useCashSummary } from "@/lib/cashData";
import { EmptyState, LoadingBlock, Panel } from "@/components/commercial/CommercialUI";
import { ClickBarChart, KpiTile } from "@/components/result/ResultCharts";
import { DetailTable } from "@/components/result/DetailTable";
import { DrillProvider, useDrill } from "@/components/result/DrillContext";
import { ResultCompanyFilter, ResultPeriodBar, ResultShell } from "@/components/result/ResultUI";
import { TONE } from "@/components/iuli/iuliTheme";
import { cn } from "@/lib/utils";

const sumOf = <T,>(rows: T[] | undefined, pick: (r: T) => number, where: (r: T) => boolean = () => true) => (rows ?? []).filter(where).reduce((a, r) => a + pick(r), 0);
const neg = (n: number) => `${formatCount(n)} ${n === 1 ? "negócio" : "negócios"}`;

function DetailLink({ to, children }: { to: string; children: string }) {
  const { search } = useLocation();
  return (
    <Link to={{ pathname: `/resultado/${to}`, search }} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
      {children}
      <ArrowRight className="size-4" />
    </Link>
  );
}

function BridgeRow({ label, sub, value, max, tone, onClick }: { label: string; sub?: string; value: number; max: number; tone: "primary" | "blue" | "amber" | "neutral"; onClick: () => void }) {
  const color = { primary: "bg-primary", blue: "bg-sky-500", amber: "bg-amber-500", neutral: "bg-foreground/60" }[tone];
  return (
    <li>
      <button type="button" onClick={onClick} title="Clique para ver as linhas" className="flex w-full flex-col gap-1.5 rounded-lg px-2 py-2 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="flex justify-between gap-3 text-sm">
          <span className="font-medium">
            {label}
            {sub && <span className="block text-xs font-normal text-muted-foreground">{sub}</span>}
          </span>
          <span className="font-semibold tabular-nums">{formatMoney(value)}</span>
        </span>
        <span className="flex h-3 w-full overflow-hidden rounded-full bg-muted" role="presentation">
          <span className={cn("h-full rounded-full", color)} style={{ width: `${Math.max(0, Math.min(1, value / max)) * 100}%` }} />
        </span>
      </button>
    </li>
  );
}

function Content() {
  const { workspace } = useWorkspace();
  const ws = workspace?.id;
  const drill = useDrill();
  const { filters: raw, set } = useResultFilters();
  // A visão geral não filtra por produto nem vendedor (as telas de detalhe filtram).
  const filters: ResultFilters = useMemo(() => ({ ...raw, produto: null, owner: null }), [raw]);
  const monthly: ResultFilters = useMemo(() => ({ ...filters, from: `${addMonthsYM(filters.to.slice(0, 7), -11)}-01`, grain: "month" }), [filters]);
  const period = resultPeriodText(filters);

  const sales = useSalesSummary(ws, filters);
  const dups = useSalesDuplicates(ws, filters);
  const revenue = useRevenueSummary(ws, filters);
  const revenueOut = useRevenueOut(ws, filters);
  const cash = useCashSummary(ws, filters);
  const cashOut = useCashOut(ws, filters);
  const aging = useCashAging(ws, filters);
  const categories = useCategoryMap(ws);
  const salesMonthly = useSalesSeries(ws, monthly);
  const revenueMonthly = useRevenueSeries(ws, monthly);
  const cashMonthly = useCashSeries(ws, monthly);

  const open = (domain: Domain, d: Partial<Drill> & Pick<Drill, "title">) => drill.open({ ...drillBase(domain, filters), tratamento: domain === "vendas" ? undefined : "soma", subtitle: period, ...d });
  const openSales = (d: Partial<Drill> & Pick<Drill, "title">) => open("vendas", { grupos: ["high", "demais"], ...d });

  const k = useMemo(() => {
    const s = sales.data ?? [];
    const real = s.filter((r) => r.grupo !== "fora_dos_6");
    const foraSales = s.filter((r) => r.grupo === "fora_dos_6");
    const rv = revenue.data ?? [];
    const c = cash.data ?? [];
    const recebido = sumOf(c, (r) => r.total, (r) => r.situacao === "recebido");
    const aVencer = sumOf(c, (r) => r.total, (r) => r.situacao === "a_vencer");
    const vencido = sumOf(c, (r) => r.total, (r) => r.situacao === "vencido");
    return {
      vendido: sumOf(real, (r) => r.total),
      high: sumOf(real, (r) => r.total, (r) => r.grupo === "high"),
      qtdVendas: sumOf(real, (r) => r.qtd),
      foraQtd: sumOf(foraSales, (r) => r.qtd),
      foraTotal: sumOf(foraSales, (r) => r.total),
      semProduto: sumOf(real, (r) => r.qtd, (r) => r.grupo === "demais" && r.produto === "(sem produto)"),
      receita: sumOf(rv, (r) => r.total),
      mes: sumOf(rv, (r) => r.total, (r) => r.origem === "mes"),
      outros: sumOf(rv, (r) => r.total, (r) => r.origem === "outros"),
      sem: sumOf(rv, (r) => r.total, (r) => r.origem === "sem_negocio"),
      qtdReceita: sumOf(rv, (r) => r.qtd),
      recebido,
      aVencer,
      vencido,
      caixa: recebido + aVencer + vencido,
      qtdCaixa: sumOf(c, (r) => r.qtd),
    };
  }, [sales.data, revenue.data, cash.data]);

  const chart = useMemo(() => {
    const v = new Map<string, number>();
    const r = new Map<string, number>();
    const c = new Map<string, number>();
    for (const x of salesMonthly.data ?? []) if (x.grupo !== "fora_dos_6") v.set(x.bucket, (v.get(x.bucket) ?? 0) + x.total);
    for (const x of revenueMonthly.data ?? []) r.set(x.bucket, (r.get(x.bucket) ?? 0) + x.total);
    for (const x of cashMonthly.data ?? []) c.set(x.bucket, (c.get(x.bucket) ?? 0) + x.total);
    return bucketsBetween(monthly.from, monthly.to, "month").map((b) => ({ label: bucketLabel(b, "month"), bucket: b, vendido: v.get(b) ?? 0, receita: r.get(b) ?? 0, caixa: c.get(b) ?? 0 }));
  }, [salesMonthly.data, revenueMonthly.data, cashMonthly.data, monthly.from, monthly.to]);

  const products = useMemo(() => {
    const map = new Map<string, { vendido: number; receita: number; caixa: number }>();
    const add = (name: string, patch: Partial<{ vendido: number; receita: number; caixa: number }>) => {
      const cur = map.get(name) ?? { vendido: 0, receita: 0, caixa: 0 };
      map.set(name, { vendido: cur.vendido + (patch.vendido ?? 0), receita: cur.receita + (patch.receita ?? 0), caixa: cur.caixa + (patch.caixa ?? 0) });
    };
    for (const r of sales.data ?? []) if (r.grupo !== "fora_dos_6") add(r.produto, { vendido: r.total });
    for (const r of revenue.data ?? []) add(r.produto, { receita: r.total });
    for (const r of cash.data ?? []) add(r.produto, { caixa: r.total });
    return [...map.entries()].filter(([, v]) => v.vendido || v.receita || v.caixa).sort((a, b) => Math.max(b[1].vendido, b[1].receita) - Math.max(a[1].vendido, a[1].receita)).slice(0, 12);
  }, [sales.data, revenue.data, cash.data]);

  const outOf = (rows: { tratamento: string; qtd: number; total: number }[] | undefined, t: string) => ({
    qtd: sumOf(rows, (r) => r.qtd, (r) => r.tratamento === t),
    total: sumOf(rows, (r) => r.total, (r) => r.tratamento === t),
  });
  const revClassify = outOf(revenueOut.data, "a_classificar");
  const cashClassify = outOf(cashOut.data, "a_classificar");
  const noCategory = outOf(revenueOut.data, "sem_categoria");
  const dupQtd = sumOf(dups.data, (d) => d.qtd);
  const dupTotal = sumOf(dups.data, (d) => d.total);
  const agingOld = (aging.data ?? []).find((r) => r.ordem === 5);
  const toReview = (categories.data ?? []).filter((c) => c.tratamento === "revisar").length;

  const attention = [
    { show: k.foraQtd > 0, tone: "warn", text: `${neg(k.foraQtd)} (${formatMoney(k.foraTotal)}) na pipeline de Contratos são de produtos fora dos 6 e ficam fora das Vendas.`, to: "vendas", cta: "Ver em Vendas" },
    { show: k.semProduto > 0, tone: "warn", text: `${neg(k.semProduto)} da Hubla & TMB estão sem produto preenchido no HubSpot.`, to: "vendas", cta: "Ver em Vendas" },
    { show: dupQtd > 0, tone: "info", text: `${neg(dupQtd)} (${formatMoney(dupTotal)}) da Hubla & TMB saíram das Vendas por repetirem um ganho de Contratos.`, to: "vendas", cta: "Ver quais" },
    { show: revClassify.total > 0, tone: "warn", text: `${formatCount(revClassify.qtd)} entradas (${formatMoney(revClassify.total)}) estão em "a classificar" na IULI e ficam fora da Receita. Precisa categorizar.`, to: "receita", cta: "Ver em Receita" },
    { show: cashClassify.total > 0, tone: "warn", text: `${formatCount(cashClassify.qtd)} lançamentos (${formatMoney(cashClassify.total)}) com vencimento no período estão em "a classificar" e ficam fora do Caixa.`, to: "caixa", cta: "Ver em Caixa" },
    { show: k.sem > 0, tone: "info", text: `${formatMoney(k.sem)} da receita não tem negócio vinculado (contam na receita, mas não dá para datar a venda).`, to: "receita", cta: "Conciliar" },
    { show: !!agingOld && agingOld.total > 0, tone: "info", text: `${formatMoney(agingOld?.total ?? 0)} vencidos há mais de 1 ano: provável baixa não registrada na IULI, e não inadimplência.`, to: "caixa", cta: "Ver em Caixa" },
    { show: noCategory.total > 0, tone: "info", text: `${formatMoney(noCategory.total)} de entradas ainda sem categoria carregada (a carga histórica continua em segundo plano).`, to: "receita", cta: "Ver em Receita" },
    { show: toReview > 0, tone: "warn", text: `${formatCount(toReview)} categorias da IULI ainda a revisar no de-para.`, to: "categorias", cta: "Revisar categorias" },
  ].filter((a) => a.show);

  const bridgeMax = Math.max(1, k.vendido, k.receita, k.aVencer + k.vencido);
  const loading = sales.isLoading || revenue.isLoading || cash.isLoading;
  const conversion = k.vendido ? k.mes / k.vendido : null;
  const [tab, setTab] = useState<Domain>("vendas");

  return (
    <ResultShell
      title="Visão Geral"
      description={`${period} · vendido (HubSpot) × entrou (IULI) × a receber (IULI)`}
      filters={
        <>
          <ResultPeriodBar filters={raw} set={set} />
          <div className="flex-1" />
          <ResultCompanyFilter filters={raw} set={set} />
        </>
      }
    >
      <section aria-label="Indicadores" className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="flex flex-col gap-2">
          <KpiTile info={S.ovSales()} label="Vendas" value={formatMoney(k.vendido)} sub={`${neg(k.qtdVendas)} · high ticket ${formatMoney(k.high)} (${formatPercent(k.vendido ? k.high / k.vendido : null)})`} loading={loading} onClick={() => openSales({ title: "Vendas do período" })} />
          <DetailLink to="vendas">Detalhar vendas</DetailLink>
        </div>
        <div className="flex flex-col gap-2">
          <KpiTile info={S.ovRevenue()} label="Receita" value={formatMoney(k.receita)} sub={`${formatCount(k.qtdReceita)} títulos · do mês ${formatMoney(k.mes)} · outros meses ${formatMoney(k.outros)}`} loading={loading} onClick={() => open("receita", { title: "Receita do período" })} />
          <DetailLink to="receita">Detalhar receita</DetailLink>
        </div>
        <div className="flex flex-col gap-2">
          <KpiTile
            info={S.ovCash()}
            label="Caixa previsto"
            value={formatMoney(k.caixa)}
            sub={`recebido ${formatMoney(k.recebido)} · a vencer ${formatMoney(k.aVencer)} · vencido ${formatMoney(k.vencido)}`}
            loading={loading}
            onClick={() => open("caixa", { title: "Caixa previsto no período" })}
          />
          <DetailLink to="caixa">Detalhar caixa</DetailLink>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Do vendido ao que entra" info={S.ovBridge()}>
          {loading ? (
            <LoadingBlock />
          ) : k.vendido || k.receita ? (
            <div className="flex flex-col gap-3">
              <ul className="flex flex-col gap-1">
                <BridgeRow label="Vendido no período" sub="negócios ganhos no HubSpot" value={k.vendido} max={bridgeMax} tone="neutral" onClick={() => openSales({ title: "Vendido no período" })} />
                <BridgeRow label="Entrou de vendas do mês" sub="negócio ganho no mesmo mês do pagamento" value={k.mes} max={bridgeMax} tone="primary" onClick={() => open("receita", { title: "Entrou de vendas do mês", origem: "mes" })} />
                <BridgeRow label="Entrou de vendas de outros meses" sub="parcelas de vendas anteriores" value={k.outros} max={bridgeMax} tone="blue" onClick={() => open("receita", { title: "Entrou de vendas de outros meses", origem: "outros" })} />
                <BridgeRow label="Entrou sem negócio vinculado" sub="receita de produto que não consegui datar" value={k.sem} max={bridgeMax} tone="amber" onClick={() => open("receita", { title: "Entrou sem negócio vinculado", origem: "sem_negocio" })} />
                <BridgeRow label="A receber no período" sub="a vencer + vencido, com vencimento no período" value={k.aVencer + k.vencido} max={bridgeMax} tone="blue" onClick={() => open("caixa", { title: "A receber no período", situacoes: ["a_vencer", "vencido"] })} />
              </ul>
              {conversion !== null && (
                <p className="text-sm text-muted-foreground">
                  Do que foi vendido no período, {formatPercent(conversion, 1)} já entrou no mesmo mês. O resto entra em parcelas nos meses seguintes (veja a safra em Receita).
                </p>
              )}
            </div>
          ) : (
            <EmptyState>Sem movimento no período.</EmptyState>
          )}
        </Panel>

        <Panel title="Vendas × Receita × Caixa por mês" info={S.ovChart()} action={<span className="text-sm text-muted-foreground">12 meses até {monthLabelYM(filters.to.slice(0, 7), true)} · clique numa barra</span>}>
          {salesMonthly.isLoading || revenueMonthly.isLoading || cashMonthly.isLoading ? (
            <LoadingBlock className="h-72" />
          ) : (
            <ClickBarChart
              stacked={false}
              data={chart}
              series={[
                { key: "vendido", label: "Vendido", color: TONE.primary },
                { key: "receita", label: "Receita (entrou)", color: TONE.blue },
                { key: "caixa", label: "Caixa (vencimento)", color: TONE.amber },
              ]}
              onBarClick={(row, key) => {
                const ym = String(row.bucket).slice(0, 7);
                const range = monthRange(ym);
                const name = monthLabelYM(ym);
                if (key === "vendido") openSales({ title: `Vendido em ${name}`, ...range });
                else if (key === "receita") open("receita", { title: `Receita de ${name}`, ...range });
                else open("caixa", { title: `Caixa de ${name}`, ...range });
              }}
            />
          )}
        </Panel>
      </div>

      <Panel title="Por produto" info={S.ovProducts()} action={<span className="text-sm text-muted-foreground">Clique num valor</span>}>
        {loading ? (
          <LoadingBlock />
        ) : products.length ? (
          <div className="-mx-4 overflow-x-auto md:mx-0">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-4 py-2 font-medium md:pl-0">Produto</th>
                  <th className="px-3 py-2 text-right font-medium">Vendido</th>
                  <th className="px-3 py-2 text-right font-medium">Receita</th>
                  <th className="px-4 py-2 text-right font-medium md:pr-0">Caixa previsto</th>
                </tr>
              </thead>
              <tbody>
                {products.map(([produto, v]) => {
                  const cell = (value: number, onClick: () => void) =>
                    value ? (
                      <button type="button" onClick={onClick} className="rounded px-2 py-1 tabular-nums hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" title="Clique para ver as linhas">
                        {formatMoney(value)}
                      </button>
                    ) : (
                      <span className="px-2 py-1 text-muted-foreground">—</span>
                    );
                  return (
                    <tr key={produto} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-2 font-medium md:pl-0">{produto}</td>
                      <td className="px-3 py-1.5 text-right">{cell(v.vendido, () => openSales({ title: `Vendas de ${produto}`, produto: [produto] }))}</td>
                      <td className="px-3 py-1.5 text-right">{cell(v.receita, () => open("receita", { title: `Receita de ${produto}`, produto: [produto] }))}</td>
                      <td className="px-4 py-1.5 text-right md:pr-0">{cell(v.caixa, () => open("caixa", { title: `Caixa de ${produto}`, produto: [produto] }))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState>Sem movimento por produto no período.</EmptyState>
        )}
      </Panel>

      <Panel title="O que precisa de atenção" info={S.ovAttention()}>
        {loading ? (
          <LoadingBlock className="h-24" />
        ) : attention.length ? (
          <ul className="flex flex-col divide-y divide-border">
            {attention.map((a, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 text-sm">
                <span className="flex min-w-0 flex-1 items-start gap-2.5">
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", a.tone === "warn" ? "bg-amber-500" : "bg-sky-500")} aria-hidden />
                  <span>{a.text}</span>
                </span>
                <DetailLink to={a.to}>{a.cta}</DetailLink>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>Nada pendente no período.</EmptyState>
        )}
      </Panel>

      <Panel title="Base de dados" action={<span className="text-sm text-muted-foreground">Todas as linhas que formam os números acima</span>}>
        <div role="tablist" aria-label="Base de dados" className="flex flex-wrap gap-2">
          {(["vendas", "receita", "caixa"] as const).map((d) => (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={tab === d}
              onClick={() => setTab(d)}
              className={cn("rounded-full border px-3.5 py-1.5 text-sm font-medium", tab === d ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:bg-accent")}
            >
              {d === "vendas" ? "Vendas" : d === "receita" ? "Receita" : "Caixa"}
            </button>
          ))}
        </div>
        <DetailTable
          key={tab}
          drill={{ ...drillBase(tab, filters), title: `Base de dados · ${tab}`, ...(tab === "vendas" ? { grupos: ["high", "demais"] } : { tratamento: "soma" }) }}
        />
      </Panel>
    </ResultShell>
  );
}

export default function ResultadoVisaoGeral() {
  return (
    <DrillProvider>
      <Content />
    </DrillProvider>
  );
}
