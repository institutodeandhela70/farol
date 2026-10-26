import { useMemo, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CommercialShell, EmptyState, LoadingBlock, Panel } from "@/components/commercial/CommercialUI";
import { axisProps, tooltipStyle } from "@/components/iuli/iuliTheme";
import { DateRange, Pill, SemFonte, Seg, Tile } from "@/components/meta/LaunchUI";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { formatDayBR, addDaysISO, todaySP } from "@/lib/iuliFilters";
import { aggDaily, buildTurmas, CHART, DP100K, hookRate, useDp100kAds, useDp100kDaily, type AdRow, type DailyRow } from "@/lib/launchReports";
import { usePersistentSearchParams } from "@/lib/iuliPersist";
import { META_SECTIONS, brl, dec, int, pct } from "@/lib/metaFormat";
import { formatAxis } from "@/lib/money";
import { cn } from "@/lib/utils";

// Painel DP100K — "Vendas & Tráfego": reprodução, sobre os dados do FAROL, do dashboard de referência
// (abas Geral · Por turma · Ads + filtro de funil). Hubla × Meta cruzados por UTM.

type View = "geral" | "turma" | "ads";
type AdSort = "vendas" | "invest" | "cpa" | "hook";

const mk = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1e6) return `R$ ${(v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi`;
  if (a >= 1e3) return `R$ ${(v / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return brl(v);
};
const money0 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : `R$ ${Math.round(v).toLocaleString("pt-BR")}`);

function Kpis({ rows, funnel }: { rows: DailyRow[]; funnel: string }) {
  const a = aggDaily(rows);
  const seg = funnel !== "todos";
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
      <Tile label="Investimento" value={a.inv ? money0(a.inv) : "—"} />
      <Tile label="Vendas ingressos" value={a.ing ? int(a.ing) : "—"} sub={a.ing ? mk(a.ing_rev) : seg ? "atribuídas via UTM" : undefined} />
      <Tile label="CPA geral" value={a.ing && a.inv ? money0(a.inv / a.ing) : "—"} sub="invest. ÷ todas as vendas" />
      <Tile
        label="CPA Meta Ads"
        value={a.ing_meta && a.inv ? money0(a.inv / a.ing_meta) : "—"}
        sub={a.ing_meta ? `${int(a.ing_meta)} vendas meta_ads${a.ing ? ` (${Math.round((a.ing_meta / a.ing) * 100)}%)` : ""}` : undefined}
      />
      <Tile label="Vendas IPM" value={seg ? "—" : a.ipm ? int(a.ipm) : "—"} sub={seg ? "só no Geral" : a.ipm ? mk(a.ipm_rev) : undefined} />
      <Tile label="Outras vendas" value={seg ? "—" : a.out ? int(a.out) : "—"} sub={seg ? "só no Geral" : a.out ? mk(a.out_rev) : undefined} />
      <Tile label={seg ? "Faturamento ingressos" : "Faturamento"} value={a.fat ? money0(a.fat) : "—"} sub={seg ? "front-end" : undefined} />
      <Tile label={seg ? "ROAS front" : "ROAS"} value={a.roas ? `${dec(a.roas)}x` : "—"} sub={a.inv ? `${mk(a.fat)} / ${mk(a.inv)}` : undefined} />
    </div>
  );
}

function SalesChart({ rows }: { rows: DailyRow[] }) {
  const data = rows.map((r) => ({ label: formatDayBR(r.d).slice(0, 5), ing: r.ing_n, ipm: r.ipm_n, out: r.out_n, fat: r.ing_rev + r.ipm_rev + r.out_rev }));
  if (!data.length) return <EmptyState>Sem dados no período.</EmptyState>;
  return (
    <div className="h-80">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="label" {...axisProps} minTickGap={24} />
          <YAxis yAxisId="l" {...axisProps} width={44} allowDecimals={false} />
          <YAxis yAxisId="r" orientation="right" {...axisProps} width={64} tickFormatter={formatAxis} />
          <Tooltip formatter={(v: number, name: string) => [name === "Faturamento" ? brl(v) : int(v), name]} {...tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
          <Bar yAxisId="r" dataKey="fat" name="Faturamento" fill={CHART.s3} fillOpacity={0.18} maxBarSize={28} />
          <Line yAxisId="l" type="monotone" dataKey="ing" name="Ingressos" stroke={CHART.s1} strokeWidth={2.4} dot={false} />
          <Line yAxisId="l" type="monotone" dataKey="ipm" name="IPM" stroke={CHART.amber} strokeWidth={1.8} dot={false} />
          <Line yAxisId="l" type="monotone" dataKey="out" name="Outras" stroke={CHART.violet} strokeWidth={1.8} dot={false} />
          <Line yAxisId="r" type="monotone" dataKey="fat" name="Faturamento" stroke={CHART.s3} strokeWidth={2.6} dot={false} legendType="none" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function TrafficTable({ rows }: { rows: DailyRow[] }) {
  if (!rows.length) return <EmptyState>Sem dados no período.</EmptyState>;
  const head = ["Data", "Investimento", "Vendas ing.", "CPA geral", "Vendas Meta", "CPA Meta", "% MQL", "Impressões", "CPM", "Alcance*", "Cliques link", "CTR link", "Visitas pág.", "Checkout", "Conv. página", "Conv. checkout"];
  const line = (r: DailyRow | null, t?: ReturnType<typeof aggDaily>) => {
    const spend = r ? r.spend : t!.inv, ing = r ? r.ing_n : t!.ing, meta = r ? r.ing_meta : t!.ing_meta, impr = r ? r.impr : t!.impr;
    const reach = r ? r.reach : t!.reach, lclk = r ? r.lclk : t!.lclk, lpv = r ? r.lpv : t!.lpv, ic = r ? r.ic : t!.ic;
    return [
      money0(spend || null), ing ? int(ing) : "—", ing && spend ? brl(spend / ing) : "—", meta ? int(meta) : "—", meta && spend ? brl(spend / meta) : "—", null,
      impr ? int(impr) : "—", impr ? brl((spend / impr) * 1000) : "—", reach ? int(reach) : "—", lclk ? int(lclk) : "—", impr ? pct(lclk / impr, 2) : "—",
      lpv ? int(lpv) : "—", ic ? int(ic) : "—", lpv ? pct(ic / lpv, 1) : "—", ic ? pct(ing / ic, 1) : "—",
    ];
  };
  const total = aggDaily(rows);
  const cell = (c: string | null) => (c === null ? <SemFonte inline>Pesquisa de renda dos compradores ainda não integrada ao FAROL.</SemFonte> : c);
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[72rem] text-sm">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>
            {head.map((h, i) => (
              <th key={h} className={cn("whitespace-nowrap px-3 py-2 text-xs font-semibold uppercase tracking-wide", i === 0 ? "text-left" : "text-right")}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.d} className="border-t border-border">
              <td className="whitespace-nowrap px-3 py-2 font-medium">{formatDayBR(r.d)}</td>
              {line(r).map((c, i) => (
                <td key={i} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{cell(c)}</td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t-2 border-border bg-muted/30 font-semibold">
          <tr>
            <td className="px-3 py-2">Total do período</td>
            {line(null, total).map((c, i) => (
              <td key={i} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{cell(c)}</td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

const ADS_LIMIT = 60;

function AdCard({ a, rank }: { a: AdRow; rank: number }) {
  const cpa = a.sales ? a.spend / a.sales : null;
  const ctr = a.impr ? (a.lclk / a.impr) * 100 : null;
  const hk = hookRate(a);
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
      <div className="relative aspect-[4/5] bg-muted">
        {a.thumb ? <img src={a.thumb} alt="" loading="lazy" className="size-full object-cover" /> : <div className="flex size-full items-center justify-center text-xs text-muted-foreground">sem prévia</div>}
      </div>
      <div className="flex flex-col gap-3 p-3.5">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">#{rank}</span>
          <span className="truncate font-semibold" title={a.name}>{a.code ?? a.name.slice(0, 18)}</span>
          <span className="ml-auto"><Pill tone={a.active ? "good" : "neu"}>{a.active ? "Ativo" : "Pausado"}</Pill></span>
        </div>
        <p className="truncate text-xs text-muted-foreground" title={a.name}>{a.name}</p>
        <div className="grid grid-cols-3 gap-x-2 gap-y-3 text-sm">
          {[
            ["Vendas", int(a.sales), "text-primary"],
            ["Investido", mk(a.spend), ""],
            ["CPA", cpa ? money0(cpa) : "—", ""],
            ["% MQL", null, ""],
            ["Impressões", int(a.impr), ""],
            ["CTR link", ctr != null ? pct(ctr / 100, 2) : "—", ""],
          ].map(([l, v, c]) => (
            <div key={l as string}>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{l}</div>
              <div className={cn("font-semibold tabular-nums", c as string)}>{v === null ? <SemFonte inline>Pesquisa de renda dos compradores ainda não integrada.</SemFonte> : v}</div>
            </div>
          ))}
        </div>
        {a.vviews >= 30 && (
          <div className="border-t border-border pt-2.5 text-xs">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-semibold uppercase tracking-wide text-muted-foreground">Retenção</span>
              <span className="tabular-nums" title="Hook = visualizações de 3 s ÷ impressões">
                hook <b className="text-emerald-600">{hk != null ? `${dec(hk, 1)}%` : "—"}</b> · hold <SemFonte inline>Retenção 25/50/75/100% do vídeo ainda não é coletada do Meta.</SemFonte>
              </span>
            </div>
          </div>
        )}
        {a.permalink && (
          <a href={a.permalink} target="_blank" rel="noreferrer" className="rounded-md border border-border py-1.5 text-center text-xs font-semibold text-muted-foreground hover:border-primary hover:text-primary">
            Abrir no Instagram
          </a>
        )}
      </div>
    </div>
  );
}

export default function LaunchDp100k() {
  const { workspace } = useWorkspace();
  const ws = workspace?.id;
  const [params, setParams] = usePersistentSearchParams();
  const today = todaySP();
  const turmas = useMemo(() => buildTurmas(today), [today]);

  const view = (["geral", "turma", "ads"].includes(params.get("aba") ?? "") ? params.get("aba") : "geral") as View;
  const funnel = DP100K.funnels.some((f) => f.key === params.get("funil")) ? params.get("funil")! : "todos";
  const turmaIdx = Math.min(Math.max(Number(params.get("turma") ?? turmas.length - 1), 0), Math.max(turmas.length - 1, 0));
  const monthStart = `${today.slice(0, 7)}-01`;
  const from = params.get("de") ?? monthStart;
  const to = params.get("ate") ?? today;
  const [sort, setSort] = useState<AdSort>("vendas");

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next);
  };

  const daily = useDp100kDaily(ws, funnel);
  const turma = turmas[turmaIdx];
  const geralRows = useMemo(() => (daily.data ?? []).filter((r) => r.d >= from && r.d <= to), [daily.data, from, to]);
  const turmaRows = useMemo(() => (turma ? (daily.data ?? []).filter((r) => r.d >= turma.inicio && r.d < turma.fim) : []), [daily.data, turma]);
  const adsFrom = view === "ads" ? from : "";
  const ads = useDp100kAds(ws, adsFrom, to, funnel);

  const adList = useMemo(() => {
    const list = [...(ads.data ?? [])];
    const key: Record<AdSort, (x: AdRow) => number> = {
      vendas: (x) => -x.sales,
      invest: (x) => -x.spend,
      cpa: (x) => (x.sales ? x.spend / x.sales : 1e15),
      hook: (x) => { const h = hookRate(x); return h == null ? 1e15 : -h; },
    };
    return list.sort((a, b) => key[sort](a) - key[sort](b) || b.spend - a.spend);
  }, [ads.data, sort]);

  const presets: [string, string, string][] = [
    ["Este mês", monthStart, today],
    ["Mês passado", `${addDaysISO(monthStart, -1).slice(0, 7)}-01`, addDaysISO(monthStart, -1)],
    ["Últimos 30d", addDaysISO(today, -29), today],
    ["Últimos 7d", addDaysISO(today, -6), today],
    ["Tudo", DP100K.firstDay, today],
  ];

  const funnelBar = (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Funil</span>
      <Seg value={funnel} options={DP100K.funnels.map((f) => ({ id: f.key, label: f.label }))} onChange={(v) => set({ funil: v === "todos" ? null : v })} label="Funil" />
      {funnel !== "todos" && (
        <span className="text-xs text-muted-foreground">Tráfego + ingressos atribuídos via UTM a este funil. IPM e vendas orgânicas aparecem só no Geral (Todos).</span>
      )}
    </div>
  );

  const periodBar = (
    <div className="flex flex-wrap items-center gap-2">
      <DateRange from={from} to={to} min={DP100K.firstDay} max={today} onChange={(a, b) => set({ de: a <= b ? a : b, ate: a <= b ? b : a })} />
      <div className="flex flex-wrap gap-1.5">
        {presets.map(([label, a, b]) => (
          <button
            key={label}
            type="button"
            onClick={() => set({ de: a, ate: b })}
            className={cn("h-9 rounded-full border px-3 text-sm font-medium", from === a && to === b ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:text-foreground")}
          >
            {label}
          </button>
        ))}
      </div>
      <span className="text-sm text-muted-foreground">{view === "geral" ? `${geralRows.length} dias` : ""}</span>
    </div>
  );

  return (
    <CommercialShell
      eyebrow="Marketing"
      sections={META_SECTIONS}
      title="Painel DP100K — Vendas & Tráfego"
      description="Ingressos do Desafio Palestrante 100K (Hubla) cruzados com o tráfego pago da Meta, por dia, turma e criativo."
      filters={
        <div className="flex flex-col gap-3">
          <Seg value={view} options={[{ id: "geral", label: "Geral" }, { id: "turma", label: "Por turma" }, { id: "ads", label: "Ads" }]} onChange={(v) => set({ aba: v === "geral" ? null : v })} label="Visão" />
          {funnelBar}
        </div>
      }
    >
      {daily.error && <EmptyState>Não foi possível carregar os dados: {(daily.error as Error).message}</EmptyState>}

      {view === "geral" && (
        <>
          {periodBar}
          <Kpis rows={geralRows} funnel={funnel} />
          <Panel title="Vendas e faturamento por dia">{daily.isLoading ? <LoadingBlock /> : <SalesChart rows={geralRows} />}</Panel>
          <Panel title="Métricas de tráfego por dia">{daily.isLoading ? <LoadingBlock /> : <TrafficTable rows={geralRows} />}</Panel>
        </>
      )}

      {view === "turma" && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Turma</span>
            {turmas.map((t, i) => (
              <button
                key={t.label}
                type="button"
                onClick={() => set({ turma: String(i) })}
                className={cn("h-9 rounded-full border px-3 text-sm font-medium", i === turmaIdx ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:text-foreground")}
              >
                {t.label}
              </button>
            ))}
            {turma && <span className="text-sm text-muted-foreground">{turma.label} · {formatDayBR(turma.inicio)} – {formatDayBR(addDaysISO(turma.fim, -1))}</span>}
          </div>
          <Kpis rows={turmaRows} funnel={funnel} />
          <Panel title="Vendas e faturamento por dia">{daily.isLoading ? <LoadingBlock /> : <SalesChart rows={turmaRows} />}</Panel>
          <Panel title="Métricas de tráfego por dia">{daily.isLoading ? <LoadingBlock /> : <TrafficTable rows={turmaRows} />}</Panel>
          <p className="text-xs text-muted-foreground">Turmas semanais de segunda a domingo, a partir de {formatDayBR(DP100K.turmaStart)}. O painel de referência vira a turma por hora; aqui a virada é por dia.</p>
        </>
      )}

      {view === "ads" && (
        <>
          {periodBar}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ordenar</span>
            <Seg value={sort} options={[{ id: "vendas", label: "Mais vendas" }, { id: "invest", label: "Maior investimento" }, { id: "cpa", label: "Melhor CPA" }, { id: "hook", label: "Melhor hook" }]} onChange={(v) => setSort(v as AdSort)} label="Ordenar" />
            <span className="text-sm text-muted-foreground">
              {adList.length} anúncios{adList.length > ADS_LIMIT ? ` · mostrando top ${ADS_LIMIT}` : ""} · {formatDayBR(from)} – {formatDayBR(to)}
            </span>
          </div>
          {ads.isLoading ? (
            <LoadingBlock />
          ) : adList.length === 0 ? (
            <EmptyState>Nenhum anúncio com investimento no período.</EmptyState>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {adList.slice(0, ADS_LIMIT).map((a, i) => (
                <AdCard key={a.key} a={a} rank={i + 1} />
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Vendas = faturas pagas da Hubla cujo utm_content é o nome do anúncio. Hook = visualizações de 3 s ÷ impressões (só dias com vídeo; mínimo de 30 visualizações). Anúncios de nutrição ficam de fora.
          </p>
        </>
      )}

      <p className="text-xs text-muted-foreground">
        Fontes: Meta Ads (campanhas com "DP100K" no nome) e Hubla (faturas pagas; ingressos = produto Desafio Palestrante 100K; IPM e outras vendas só quando a UTM é de campanha do DP100K).
        *Alcance é a soma dos anúncios no dia (não é de contas únicas). % MQL e retenção "hold" não têm fonte de dados no FAROL ainda.
      </p>
    </CommercialShell>
  );
}
