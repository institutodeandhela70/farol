import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { CommercialShell, EmptyState, LoadingBlock, Panel } from "@/components/commercial/CommercialUI";
import { axisProps, tooltipStyle } from "@/components/iuli/iuliTheme";
import { Bars, DateRange, Pill, SemFonte, Seg, Tile, type BarItem } from "@/components/meta/LaunchUI";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { addDaysISO, todaySP } from "@/lib/iuliFilters";
import { usePersistentSearchParams } from "@/lib/iuliPersist";
import { CHART, IPL, pace, semana, soma, useIplAds, useIplInvoices, useIplSales, useIplTraffic, type AdRow, type IplSale, type IplTrafficRow } from "@/lib/launchReports";
import { META_SECTIONS, brl, dec, int } from "@/lib/metaFormat";
import { cn } from "@/lib/utils";

// Painel IPL Fortaleza — "Painel da edição": reprodução, sobre os dados do FAROL, do dashboard de referência
// (meta de cadeiras com trilho/projeção, vendas e retorno por frente, criativos de venda direta e de captação,
// captação do meteórico e público). Hubla × Meta cruzados por UTM.

type Tab = "geral" | "vendas" | "crVD" | "crCAP" | "cap" | "pub";

const TABS: { id: Tab; label: string }[] = [
  { id: "geral", label: "Visão geral" },
  { id: "vendas", label: "Vendas e retorno" },
  { id: "crVD", label: "Criativos · Venda direta" },
  { id: "crCAP", label: "Criativos · Captação" },
  { id: "cap", label: "Captação Le08" },
  { id: "pub", label: "Público" },
];

const FR = ["MET", "VDA", "VDD", "OUT"] as const;
const FR_LBL: Record<string, string> = { MET: "Meteórico", VDA: "Venda direta · anúncios", VDD: "Venda direta · disparo", OUT: "Outros" };
const FR_COR: Record<string, string> = { MET: CHART.s1, VDA: CHART.s2, VDD: CHART.s3, OUT: CHART.other };
const TP_ORD = ["Individual", "Duplo", "VIP", "VIP duplo", "Segunda cadeira avulsa"];
const CAPF = ["EST", "VID", "QNT"] as const;
const CAPF_LBL: Record<string, string> = { EST: "Estáticos", VID: "Vídeos", QNT: "Quente" };
const CAPF_COR: Record<string, string> = { EST: CHART.s1, VID: CHART.s2, QNT: CHART.s3 };

const dia = (d: string) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : "");
const brl0 = (v: number) => `R$ ${Math.round(v || 0).toLocaleString("pt-BR")}`;
const xx = (v: number | null) => (v == null ? "—" : `${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`);
const pc = (v: number | null) => (v == null ? "—" : `${dec(v, 1)}%`);

const sum = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((a, r) => a + f(r), 0);

// ---------------------------------------------------------------------------
// Visão geral
// ---------------------------------------------------------------------------

function Geral({ vendas, hoje, loading }: { vendas: IplSale[]; hoje: string; loading: boolean }) {
  const p = useMemo(() => pace(vendas, hoje), [vendas, hoje]);
  const MT = p.MT;
  const alvoHoje = p.trilho(p.H);
  const noTrilho = p.proj >= MT.cadeiras;
  const mult = p.ritmo ? (p.necessario ?? 0) / p.ritmo : null;

  const tipos = useMemo(() => {
    const m = new Map<string, { k: string; n: number; cad: number; rec: number }>();
    for (const x of vendas) {
      const o = m.get(x.tp) ?? { k: x.tp, n: 0, cad: 0, rec: 0 };
      o.n++; o.cad += x.cad; o.rec += x.v;
      m.set(x.tp, o);
    }
    const list = [...m.values()].sort((a, b) => TP_ORD.indexOf(a.k) - TP_ORD.indexOf(b.k));
    return { list, totCad: sum(list, (o) => o.cad) };
  }, [vendas]);

  const acum = useMemo(() => {
    const out: { label: string; real?: number; trilho?: number | null; proj?: number }[] = [];
    let acc = vendas.filter((x) => x.d < "2026-08-26").reduce((a, b) => a + b.cad, 0);
    const iOntem = soma(p.H, -1);
    for (let d = "2026-08-26"; d <= MT.ate; d = soma(d, 1)) {
      if (d <= p.H) acc += p.porDia[d]?.t ?? 0;
      const row: { label: string; real?: number; trilho?: number | null; proj?: number } = { label: dia(d), trilho: p.trilho(d) };
      if (d <= p.H) row.real = acc;
      if (d >= iOntem) row.proj = p.ontem + ((p.proj - p.ontem) * (new Date(`${d}T12:00:00`).getTime() - new Date(`${iOntem}T12:00:00`).getTime())) / Math.max(new Date(`${MT.ate}T12:00:00`).getTime() - new Date(`${iOntem}T12:00:00`).getTime(), 1);
      out.push(row);
    }
    return out;
  }, [vendas, p, MT.ate]);

  const porFrente = useMemo(() => {
    const out: Record<string, string | number>[] = [];
    for (let d = "2026-09-01"; d <= MT.ate; d = soma(d, 1)) {
      const o = d <= p.H ? p.porDia[d] : undefined;
      out.push({ label: dia(d), MET: o?.MET ?? 0, VDA: o?.VDA ?? 0, VDD: o?.VDD ?? 0, OUT: o?.OUT ?? 0 });
    }
    return out;
  }, [p, MT.ate]);
  const abertura = vendas.filter((x) => x.d < "2026-09-01" && x.d >= IPL.plano.oferta).reduce((a, b) => a + b.cad, 0);

  const tabela = useMemo(() => {
    const rows: { d: string; passou: boolean; hoje: boolean; n: number | null; meta: number | null; acc: number | null; alvo: number | null; dif: number | null }[] = [];
    let acc = p.ate(soma(MT.desde, -1));
    for (let d = MT.desde; d <= MT.ate; d = soma(d, 1)) {
      const passou = d < p.H, isHoje = d === p.H, tem = passou || isHoje;
      const nn = tem ? (p.porDia[d]?.t ?? 0) : null;
      if (tem) acc += nn ?? 0;
      const alvo = p.trilho(d);
      rows.push({ d, passou, hoje: isHoje, n: nn, meta: passou ? p.passo : p.necessario, acc: tem ? acc : null, alvo, dif: tem && alvo != null ? acc - alvo : null });
    }
    return rows;
  }, [p, MT]);

  if (loading) return <LoadingBlock />;
  return (
    <>
      <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr]">
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>Cadeiras vendidas</span>
            {noTrilho ? <Pill tone="good">No trilho</Pill> : <Pill tone="warn">Abaixo do trilho</Pill>}
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-5xl font-semibold tabular-nums tracking-tight">{int(p.total)}</span>
            <span className="text-lg text-muted-foreground">de {int(MT.cadeiras)}</span>
          </div>
          <div className="relative h-3 overflow-hidden rounded-full bg-muted">
            <i className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${Math.min(100, (100 * p.total) / MT.cadeiras)}%` }} />
            {alvoHoje != null && <b className="absolute inset-y-0 w-0.5 bg-foreground" style={{ left: `${Math.min(100, (100 * alvoHoje) / MT.cadeiras)}%` }} />}
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{pc((100 * p.total) / MT.cadeiras)} da meta</span>
            <span>{alvoHoje != null ? `▏trilho hoje: ${dec(alvoHoje, 1)}` : ""}</span>
            <span>meta {int(MT.cadeiras)} até {dia(MT.ate)}</span>
          </div>
          <p className="text-sm leading-relaxed">
            No ritmo dos últimos 7 dias (<b>{dec(p.ritmo, 1)}/dia</b>) a edição fecha <b>{int(p.proj)} cadeiras</b> em {dia(MT.ate)}
            {noTrilho ? ". A meta fecha." : <>, <b>{int(MT.cadeiras - p.proj)} abaixo da meta</b>. Pra fechar {int(MT.cadeiras)}, o ritmo precisa ir a <b>{dec(p.necessario ?? 0, 1)}/dia</b>{mult ? ` (${dec(mult, 1)}x o atual)` : ""}.</>}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Tile label="Faltam" value={int(p.falta)} sub={`${int(p.restantes)} dias até ${dia(MT.ate)}, com hoje`} />
          <Tile label="Necessário por dia" value={p.necessario == null ? "—" : dec(p.necessario, 1)} sub="a partir de hoje" />
          <Tile label="Ritmo atual" value={`${dec(p.ritmo, 1)}/dia`} sub="média dos 7 dias fechados" />
          <Tile label={`Projeção em ${dia(MT.ate)}`} value={int(p.proj)} sub={noTrilho ? <Pill tone="good">fecha a meta</Pill> : <Pill tone="crit">−{int(MT.cadeiras - p.proj)} da meta</Pill>} />
          <Tile label="Vendidas hoje" value={int(p.hoje)} sub={p.necessario == null ? "" : p.hoje >= p.necessario ? <Pill tone="good">bateu o necessário</Pill> : <Pill>faltam {dec(p.necessario - p.hoje, 1)}</Pill>} />
          <Tile label="Pessoas" value={<SemFonte inline>Compradores únicos exigem casar o cliente entre faturas; hoje contamos faturas pagas.</SemFonte>} sub={`${int(vendas.length)} vendas pagas`} />
        </div>
      </div>

      <Panel title="Total por tipo de ingresso">
        <p className="-mt-2 text-sm text-muted-foreground">Cadeiras vendidas; Duplo = 2 lugares no mesmo checkout (qualquer lote)</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {tipos.list.map((o) => (
            <Tile key={o.k} label={o.k} value={`${int(o.cad)} cad.`} sub={`${pc(tipos.totCad ? (100 * o.cad) / tipos.totCad : null)} · ${int(o.n)} ${o.n === 1 ? "venda" : "vendas"} · ${brl0(o.rec)}`} />
          ))}
          {!tipos.list.length && <p className="text-sm text-muted-foreground">Nenhuma venda paga encontrada para esta edição.</p>}
        </div>
      </Panel>

      <Panel title="Acumulado de cadeiras">
        <p className="-mt-2 text-sm text-muted-foreground">Realizado contra o trilho da meta e contra a projeção no ritmo dos últimos 7 dias fechados</p>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={acum} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="label" {...axisProps} minTickGap={28} />
              <YAxis {...axisProps} width={44} domain={[0, Math.max(MT.cadeiras, Math.ceil(p.proj), p.total) * 1.05]} allowDecimals={false} />
              <Tooltip formatter={(v: number, name: string) => [dec(v, 1), name]} {...tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 12 }} iconType="plainline" />
              <ReferenceLine y={MT.cadeiras} stroke="hsl(var(--foreground))" strokeDasharray="2 4" label={{ value: `meta ${MT.cadeiras}`, position: "right", fontSize: 11 }} />
              <Line type="monotone" dataKey="real" name="Realizado" stroke={CHART.s1} strokeWidth={2.4} dot={false} connectNulls />
              <Line type="linear" dataKey="trilho" name="Trilho da meta" stroke="hsl(var(--foreground))" strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls />
              <Line type="linear" dataKey="proj" name="Projeção no ritmo atual" stroke="hsl(var(--muted-foreground))" strokeWidth={2} strokeDasharray="1.5 4" dot={false} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <Panel title="Cadeiras por dia, por frente">
        <p className="-mt-2 text-sm text-muted-foreground">Desde 01/09. A abertura do carrinho ({dia(IPL.plano.oferta)} a 31/08) somou {int(abertura)} cadeiras e fica fora da escala</p>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={porFrente} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="label" {...axisProps} minTickGap={24} />
              <YAxis {...axisProps} width={32} allowDecimals={false} />
              <Tooltip {...tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" formatter={(v) => FR_LBL[v] ?? v} />
              {FR.map((f, i) => (
                <Bar key={f} dataKey={f} name={f} stackId="f" fill={FR_COR[f]} maxBarSize={24} radius={i === FR.length - 1 ? [4, 4, 0, 0] : 0} />
              ))}
              {p.necessario != null && <ReferenceLine y={p.necessario} stroke="hsl(var(--foreground))" strokeDasharray="5 4" label={{ value: `necessário ${dec(p.necessario, 1)}/dia`, position: "insideTopRight", fontSize: 11 }} />}
            </BarChart>
          </ResponsiveContainer>
        </div>
        <details className="rounded-lg border border-border">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Tabela dia a dia até {dia(MT.ate)}</summary>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>{["Dia", "Cadeiras", "Meta do dia", "Acumulado", "Trilho", "Diferença"].map((h, i) => <th key={h} className={cn("px-3 py-2 font-medium", i && "text-right")}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {tabela.map((r) => (
                  <tr key={r.d} className={cn("border-t border-border", r.hoje && "bg-primary/5", !r.passou && !r.hoje && "text-muted-foreground")}>
                    <td className="px-3 py-1.5">{dia(r.d)} <span className="text-muted-foreground">{semana(r.d)}</span>{r.hoje ? " · hoje" : ""}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.n == null ? "—" : int(r.n)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.meta == null ? "—" : dec(r.meta, 1)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.acc == null ? "—" : int(r.acc)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.alvo == null ? "—" : dec(r.alvo, 1)}</td>
                    <td className="px-3 py-1.5 text-right">{r.dif == null ? "—" : <Pill tone={r.dif >= 0 ? "good" : "crit"}>{r.dif >= 0 ? "+" : ""}{dec(r.dif, 1)}</Pill>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-3 py-2 text-xs text-muted-foreground">
            Trilho parte de {int(p.base)} cadeiras (fim de {dia(soma(MT.desde, -1))}) e sobe {dec(p.passo, 1)} por dia até {int(MT.cadeiras)}. Nos dias passados, a meta do dia é o passo do trilho; de hoje em diante, o necessário recalculado com o que falta.
            Cadeira = venda paga; ingresso "Duplo" conta 2.
          </p>
        </details>
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------------------
// Vendas e retorno
// ---------------------------------------------------------------------------

function Vendas({ vendas, traffic, invoices }: { vendas: IplSale[]; traffic: IplTrafficRow[]; invoices: Record<string, number> | undefined }) {
  const rows = useMemo(() => {
    const spendOf = (k: string) => (k === "MET" ? sum(traffic.filter((t) => ["ANT", "EST", "VID", "QNT"].includes(t.f)), (t) => t.s) : k === "VDA" ? sum(traffic.filter((t) => t.f === "VDA"), (t) => t.s) : 0);
    return FR.map((k) => {
      const v = vendas.filter((x) => x.fr === k);
      return { k, s: spendOf(k), n: v.length, cad: sum(v, (x) => x.cad), rec: sum(v, (x) => x.v) };
    });
  }, [vendas, traffic]);
  const tot = rows.reduce((a, o) => ({ s: a.s + o.s, n: a.n + o.n, cad: a.cad + o.cad, rec: a.rec + o.rec }), { s: 0, n: 0, cad: 0, rec: 0 });
  const roas = tot.s ? tot.rec / tot.s : null;

  const ofertas = useMemo(() => {
    const m = new Map<string, { of: string; n: number; cad: number; rec: number }>();
    for (const x of vendas) {
      const o = m.get(x.of) ?? { of: x.of, n: 0, cad: 0, rec: 0 };
      o.n++; o.cad += x.cad; o.rec += x.v;
      m.set(x.of, o);
    }
    return [...m.values()].sort((a, b) => b.rec - a.rec);
  }, [vendas]);

  const tipos = useMemo(() => {
    const m = new Map<string, { k: string; n: number; cad: number; rec: number }>();
    for (const x of vendas) {
      const o = m.get(x.tp) ?? { k: x.tp, n: 0, cad: 0, rec: 0 };
      o.n++; o.cad += x.cad; o.rec += x.v;
      m.set(x.tp, o);
    }
    const list = [...m.values()].sort((a, b) => TP_ORD.indexOf(a.k) - TP_ORD.indexOf(b.k));
    return { list, totCad: sum(list, (o) => o.cad) };
  }, [vendas]);

  const pagto = useMemo(() => {
    const m = new Map<string, { k: string; n: number }>();
    for (const x of vendas) {
      const k = x.mp === "Cartão de Crédito" ? `Cartão ${x.pc > 1 ? "parcelado" : "à vista"}` : x.mp || "—";
      const o = m.get(k) ?? { k, n: 0 };
      o.n++;
      m.set(k, o);
    }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [vendas]);

  const faturasTotal = invoices ? Object.values(invoices).reduce((a, b) => a + b, 0) : 0;
  const pagas = (invoices?.Paga ?? 0) + (invoices?.Reembolsada ?? 0);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Tile label="Receita" value={brl0(tot.rec)} sub={`${int(tot.n)} vendas pagas`} />
        <Tile label="Investimento" value={brl0(tot.s)} sub="Meteórico + venda direta" />
        <Tile label="ROAS da edição" value={xx(roas)} sub={roas == null ? "" : roas >= 1 ? <Pill tone="good">mídia se paga</Pill> : <Pill tone="crit">mídia não se paga</Pill>} />
        <Tile label="Custo por venda" value={tot.n ? brl0(tot.s / tot.n) : "—"} sub="investimento ÷ vendas" />
        <Tile label="Ticket médio" value={tot.n ? brl0(tot.rec / tot.n) : "—"} sub="com juros do parcelamento" />
        <Tile label="Reembolsos" value={int(invoices?.Reembolsada ?? 0)} sub="faturas reembolsadas" />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Investimento e receita por frente">
          <p className="-mt-2 text-sm text-muted-foreground">A frente sai da UTM da venda na Hubla</p>
          <Bars
            items={rows.map<BarItem>((o) => ({ key: o.k, label: FR_LBL[o.k], swatch: FR_COR[o.k], a: o.rec, b: o.s || null, color: FR_COR[o.k], txt: `${brl0(o.rec)}${o.s ? ` · ROAS ${xx(o.rec / o.s)}` : " · sem mídia"}` }))}
          />
        </Panel>
        <Panel title="Receita por oferta">
          <p className="-mt-2 text-sm text-muted-foreground">Vendas pagas; ingressos duplos contam 2 cadeiras</p>
          <Bars items={ofertas.map<BarItem>((o) => ({ key: o.of, label: o.of, a: o.rec, txt: `${brl0(o.rec)} · ${int(o.cad)} cad.` }))} empty="Nenhuma venda paga encontrada." />
        </Panel>
      </div>

      <Panel title="MQL 10k+ entre compradores, por frente">
        <SemFonte>A pesquisa pós-compra (renda declarada dos compradores) ainda não existe no FAROL. Quando houver, esta barra mostra a taxa de renda ≥ R$ 10 mil por frente.</SemFonte>
      </Panel>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Vendas por tipo de ingresso">
          <Bars items={tipos.list.map<BarItem>((o) => ({ key: o.k, label: o.k, a: o.n, txt: `${int(o.n)} ${o.n === 1 ? "venda" : "vendas"} · ${brl0(o.rec)}` }))} empty="Nenhuma venda paga encontrada." />
        </Panel>
        <Panel title="Cadeiras por tipo de ingresso">
          <Bars items={tipos.list.map<BarItem>((o) => ({ key: o.k, label: o.k, a: o.cad, txt: `${int(o.cad)} cad. · ${pc(tipos.totCad ? (100 * o.cad) / tipos.totCad : null)}` }))} empty="Nenhuma venda paga encontrada." />
        </Panel>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Checkout">
          <p className="-mt-2 text-sm text-muted-foreground">Faturas da Hubla deste produto</p>
          <Bars
            items={[
              { key: "t", label: "Faturas registradas", a: faturasTotal, txt: int(faturasTotal) },
              { key: "p", label: "Pagas", a: pagas, txt: `${int(pagas)} · ${pc(faturasTotal ? (100 * pagas) / faturasTotal : null)} de aprovação` },
              { key: "pe", label: "Aguardando pagamento", a: invoices?.Pendente ?? 0, txt: int(invoices?.Pendente ?? 0), dim: true },
              { key: "at", label: "Atrasadas", a: invoices?.Atrasada ?? 0, txt: int(invoices?.Atrasada ?? 0), dim: true },
            ]}
          />
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            Expiradas e carrinhos abandonados: <SemFonte inline>O FAROL só recebe faturas geradas/pagas da Hubla; carrinhos abandonados e faturas expiradas não chegam.</SemFonte>
          </div>
        </Panel>
        <Panel title="Forma de pagamento">
          <Bars items={pagto.map<BarItem>((o) => ({ key: o.k, label: o.k, a: o.n, txt: `${int(o.n)} · ${pc(tot.n ? (100 * o.n) / tot.n : null)}` }))} empty="Nenhuma venda paga encontrada." />
        </Panel>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[44rem] text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>{["Frente", "Investimento", "Vendas", "Cadeiras", "Receita", "Custo por venda", "ROAS"].map((h, i) => <th key={h} className={cn("px-3 py-2 font-medium", i && "text-right")}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.k} className="border-t border-border">
                <td className="px-3 py-2"><i className="mr-2 inline-block size-2.5 rounded-sm" style={{ background: FR_COR[o.k] }} />{FR_LBL[o.k]}</td>
                <td className="px-3 py-2 text-right tabular-nums">{o.s ? brl(o.s) : "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{int(o.n)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{int(o.cad)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{brl(o.rec)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{o.s && o.n ? brl(o.s / o.n) : "—"}</td>
                <td className="px-3 py-2 text-right">{o.s ? <Pill tone={o.rec >= o.s ? "good" : "crit"}>{xx(o.rec / o.s)}</Pill> : "—"}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-border bg-muted/30 font-semibold">
            <tr>
              <td className="px-3 py-2">Total</td>
              <td className="px-3 py-2 text-right tabular-nums">{brl(tot.s)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{int(tot.n)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{int(tot.cad)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{brl(tot.rec)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{tot.n ? brl(tot.s / tot.n) : "—"}</td>
              <td className="px-3 py-2 text-right tabular-nums">{xx(roas)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Meteórico = utm_campaign com "le08" (a venda nasce no grupo). Anúncios = utm_source meta_ads. Disparo = utm_campaign "fp08" fora da Meta. Investimento = Meta (campanhas IPL-Le08 e IPL-Fp08). Disparo e orgânico não têm verba de mídia.
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// Criativos
// ---------------------------------------------------------------------------

function AdThumb({ a, rank, badge }: { a: AdRow; rank: number; badge: React.ReactNode }) {
  return (
    <div className="relative aspect-[4/5] bg-muted">
      {a.thumb ? <img src={a.thumb} alt="" loading="lazy" className="size-full object-cover" /> : <div className="flex size-full items-center justify-center text-xs text-muted-foreground">sem prévia</div>}
      <span className="absolute left-2 top-2 rounded-md bg-background/90 px-2 py-0.5 text-xs font-bold">#{rank}</span>
      <span className="absolute right-2 top-2">{badge}</span>
    </div>
  );
}

function CriativosVD({ ads, vendas, loading }: { ads: AdRow[]; vendas: IplSale[]; loading: boolean }) {
  const [sort, setSort] = useState<"n" | "s" | "cpa" | "roas" | "cv">("n");
  const [st, setSt] = useState<"" | "ACTIVE" | "venda">("");
  const vda = vendas.filter((x) => x.fr === "VDA");
  const tk = vda.length ? sum(vda, (x) => x.v) / vda.length : IPL.ticketPadrao;

  const todos = useMemo(
    () => ads.filter((a) => a.seg === "VDA").map((a) => ({ ...a, n: a.sales, cpa: a.sales && a.spend ? a.spend / a.sales : null, roas: a.spend ? a.rev / a.spend : null, cv: a.lpv ? (100 * a.sales) / a.lpv : null, ctr: a.impr ? (100 * a.lclk) / a.impr : null })),
    [ads],
  );
  const all = useMemo(() => todos.filter((c) => c.name !== "sem AD"), [todos]);
  const semAd = todos.find((c) => c.name === "sem AD");
  const s = sum(all, (c) => c.spend), n = sum(all, (c) => c.n), rec = sum(all, (c) => c.rev);
  const nTot = n + (semAd?.n ?? 0), recTot = rec + (semAd?.rev ?? 0);
  const sePaga = all.filter((c) => c.n && c.cpa != null && c.cpa <= tk).length;
  const queima = all.filter((c) => !c.n && c.spend >= tk);

  const veredito = (c: (typeof all)[number]): [Parameters<typeof Pill>[0]["tone"], string] =>
    c.n ? (c.cpa != null && c.cpa <= tk ? ["good", "se paga"] : ["crit", "CPA > ticket"]) : c.spend >= tk ? ["crit", "sem venda"] : ["neu", "amostra curta"];

  const list = useMemo(() => {
    let L = all.slice();
    if (st === "ACTIVE") L = L.filter((c) => c.active);
    if (st === "venda") L = L.filter((c) => c.n);
    const key: Record<typeof sort, (c: (typeof all)[number]) => number> = { n: (c) => c.n * 1e6 + c.rev, s: (c) => c.spend, cpa: (c) => (c.cpa == null ? -1e9 : -c.cpa), roas: (c) => c.roas ?? 0, cv: (c) => c.cv ?? 0 };
    return L.sort((a, b) => key[sort](b) - key[sort](a) || b.spend - a.spend);
  }, [all, sort, st]);

  const scatter = all.filter((c) => c.spend > 0).map((c) => ({ x: Math.round(c.spend), y: c.n, name: c.code ?? c.name, ok: !!(c.n && c.cpa != null && c.cpa <= tk) }));
  const xMax = Math.max(1, ...scatter.map((p) => p.x)) * 1.05;

  if (loading) return <LoadingBlock />;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Tile label="Investimento" value={brl0(s)} sub={`${int(all.filter((c) => c.spend > 0).length)} criativos com verba`} />
        <Tile label="Vendas" value={int(nTot)} sub={semAd?.n ? `${int(semAd.n)} sem AD na UTM` : "pela utm_content da Hubla"} />
        <Tile label="CPA" value={nTot ? brl0(s / nTot) : "—"} sub={`ticket médio ${brl0(tk)}`} />
        <Tile label="ROAS" value={xx(s ? recTot / s : null)} sub={s ? (recTot >= s ? <Pill tone="good">se paga</Pill> : <Pill tone="crit">não se paga</Pill>) : ""} />
        <Tile label="Criativos que se pagam" value={`${int(sePaga)} de ${int(all.length)}`} sub="CPA até o ticket" />
        <Tile label="Sem venda, 1 ticket gasto" value={int(queima.length)} sub={queima.length ? `${brl0(sum(queima, (c) => c.spend))} investidos` : ""} />
      </div>

      <Panel title="Investimento x vendas por criativo">
        <p className="-mt-2 text-sm text-muted-foreground">Cada ponto é um criativo, somando as campanhas de venda direta. Linha tracejada = equilíbrio: 1 venda a cada {brl0(tk)}.</p>
        {scatter.length === 0 ? (
          <EmptyState>Sem criativos com verba.</EmptyState>
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" dataKey="x" name="Investido" {...axisProps} tickFormatter={(v) => brl0(v)} domain={[0, xMax]} />
                <YAxis type="number" dataKey="y" name="Vendas" {...axisProps} width={36} allowDecimals={false} />
                <ZAxis range={[60, 60]} />
                <Tooltip cursor={{ strokeDasharray: "3 3" }} formatter={(v: number, name: string) => [name === "Investido" ? brl0(v) : int(v), name]} labelFormatter={() => ""} {...tooltipStyle} />
                <ReferenceLine segment={[{ x: 0, y: 0 }, { x: xMax, y: xMax / tk }]} stroke="hsl(var(--foreground))" strokeDasharray="5 4" />
                <Scatter name="Se paga" data={scatter.filter((p) => p.ok)} fill={CHART.s1} />
                <Scatter name="Não se paga ou sem venda" data={scatter.filter((p) => !p.ok)} fill={CHART.other} />
                <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ordenar</span>
        <Seg value={sort} options={[{ id: "n", label: "Vendas" }, { id: "s", label: "Investimento" }, { id: "cpa", label: "CPA" }, { id: "roas", label: "ROAS" }, { id: "cv", label: "Venda/visita" }]} onChange={(v) => setSort(v as typeof sort)} label="Ordenar" />
        <Seg value={st} options={[{ id: "", label: "Todos" }, { id: "ACTIVE", label: "Ativos" }, { id: "venda", label: "Com venda" }]} onChange={(v) => setSt(v as typeof st)} label="Filtro" />
        <span className="text-sm text-muted-foreground">{int(list.length)} criativos</span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {list.map((c, i) => {
          const v = veredito(c);
          return (
            <div key={c.key} className={cn("flex flex-col overflow-hidden rounded-xl border border-border bg-card", !c.active && "opacity-80")}>
              <AdThumb a={c} rank={i + 1} badge={c.active ? <Pill tone="good">Ativo</Pill> : <Pill>Pausado</Pill>} />
              <div className="flex flex-col gap-2.5 p-3.5">
                <div className="flex items-center justify-between gap-2"><b>{c.code ?? c.name}</b><Pill tone={v[0]}>{v[1]}</Pill></div>
                <p className="truncate text-xs text-muted-foreground" title={c.campaign}>{c.campaign || "—"}</p>
                <div className="flex items-baseline gap-4">
                  <span className="text-2xl font-semibold tabular-nums">{int(c.n)}<small className="ml-1 text-xs font-normal text-muted-foreground">vendas</small></span>
                  <span className="text-lg font-semibold tabular-nums">{c.cpa == null ? "—" : brl0(c.cpa)}<small className="ml-1 text-xs font-normal text-muted-foreground">CPA</small></span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                  <div>Investido<b className="block text-sm text-foreground">{brl0(c.spend)}</b></div>
                  <div>ROAS<b className="block text-sm text-foreground">{xx(c.roas)}</b></div>
                  <div>Receita<b className="block text-sm text-foreground">{c.rev ? brl0(c.rev) : "—"}</b></div>
                  <div>Visitas<b className="block text-sm text-foreground">{int(c.lpv)}</b></div>
                  <div>Venda/visita<b className="block text-sm text-foreground">{c.cv == null ? "—" : pc(c.cv)}</b></div>
                  <div>CTR<b className="block text-sm text-foreground">{c.ctr == null ? "—" : pc(c.ctr)}</b></div>
                </div>
                {c.permalink && <a href={c.permalink} target="_blank" rel="noreferrer" className="rounded-md border border-border py-1.5 text-center text-xs font-semibold text-muted-foreground hover:border-primary hover:text-primary">Ver no Instagram</a>}
              </div>
            </div>
          );
        })}
      </div>
      {!list.length && <EmptyState>Nenhum criativo com esse filtro.</EmptyState>}
      <p className="text-xs text-muted-foreground">
        A venda casa com o criativo pelo código [AD-NN] da utm_content da fatura na Hubla; o pixel não entra. Investimento, cliques e visitas somam as campanhas de venda direta (IPL-Fp08). Veredito: CPA até o ticket médio ({brl0(tk)}) se paga; sem venda só vira problema depois de gastar um ticket inteiro.
      </p>
    </>
  );
}

function CriativosCap({ ads, loading }: { ads: AdRow[]; loading: boolean }) {
  const [sort, setSort] = useState<"lead" | "cpl" | "s" | "ctr" | "conv">("lead");
  const [fr, setFr] = useState<"" | "EST" | "VID" | "QNT">("");
  const KILL = IPL.killCpl;
  const cr = useMemo(
    () => ads.filter((a) => (CAPF as readonly string[]).includes(a.seg)).map((a) => ({ ...a, cpl: a.leads ? a.spend / a.leads : null, ctr: a.impr ? (100 * a.lclk) / a.impr : null, conv: a.lpv ? (100 * a.leads) / a.lpv : null, cpm: a.impr ? (1000 * a.spend) / a.impr : null })),
    [ads],
  );
  const list = useMemo(() => {
    const L = cr.filter((c) => !fr || c.seg === fr);
    const key: Record<typeof sort, (c: (typeof cr)[number]) => number> = { lead: (c) => c.leads * 1e6 - c.spend, cpl: (c) => (c.cpl == null ? -1e9 : -c.cpl), s: (c) => c.spend, ctr: (c) => c.ctr ?? 0, conv: (c) => c.conv ?? 0 };
    return L.sort((a, b) => key[sort](b) - key[sort](a));
  }, [cr, sort, fr]);

  if (loading) return <LoadingBlock />;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ordenar</span>
        <Seg value={sort} options={[{ id: "lead", label: "Leads" }, { id: "cpl", label: "CPL" }, { id: "s", label: "Investimento" }, { id: "ctr", label: "CTR" }, { id: "conv", label: "Página → lead" }]} onChange={(v) => setSort(v as typeof sort)} label="Ordenar" />
        <Seg value={fr} options={[{ id: "", label: "Todos" }, { id: "EST", label: "Estáticos" }, { id: "VID", label: "Vídeos" }, { id: "QNT", label: "Quente" }]} onChange={(v) => setFr(v as typeof fr)} label="Frente" />
        <span className="text-sm text-muted-foreground">{int(list.length)} criativos</span>
      </div>
      {list.length === 0 ? (
        <EmptyState>Nenhum criativo de captação no período.</EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {list.map((c, i) => {
            const st: [Parameters<typeof Pill>[0]["tone"], string] = c.cpl == null ? (c.spend >= KILL ? ["crit", "sem lead"] : ["neu", "amostra curta"]) : c.cpl <= KILL ? ["good", "abaixo do kill"] : c.cpl < KILL * 1.5 ? ["warn", "acima do kill"] : ["crit", "CPL alto"];
            return (
              <div key={c.key} className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
                <AdThumb a={c} rank={i + 1} badge={<Pill>{CAPF_LBL[c.seg] ?? c.seg}</Pill>} />
                <div className="flex flex-col gap-2.5 p-3.5">
                  <div className="flex items-center justify-between gap-2"><b>{c.code ?? c.name}</b><Pill tone={st[0]}>{st[1]}</Pill></div>
                  <div className="flex items-baseline gap-4">
                    <span className="text-2xl font-semibold tabular-nums">{int(c.leads)}<small className="ml-1 text-xs font-normal text-muted-foreground">leads</small></span>
                    <span className="text-lg font-semibold tabular-nums">{c.cpl == null ? "—" : brl(c.cpl)}<small className="ml-1 text-xs font-normal text-muted-foreground">CPL</small></span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                    <div>Investido<b className="block text-sm text-foreground">{brl0(c.spend)}</b></div>
                    <div>CTR<b className="block text-sm text-foreground">{c.ctr == null ? "—" : pc(c.ctr)}</b></div>
                    <div>CPM<b className="block text-sm text-foreground">{c.cpm == null ? "—" : brl0(c.cpm)}</b></div>
                    <div>Visitas<b className="block text-sm text-foreground">{int(c.lpv)}</b></div>
                    <div>Página→lead<b className="block text-sm text-foreground">{c.conv == null ? "—" : pc(c.conv)}</b></div>
                    <div>Custo/visita<b className="block text-sm text-foreground">{c.lpv ? brl(c.spend / c.lpv) : "—"}</b></div>
                  </div>
                  {c.permalink && <a href={c.permalink} target="_blank" rel="noreferrer" className="rounded-md border border-border py-1.5 text-center text-xs font-semibold text-muted-foreground hover:border-primary hover:text-primary">Ver no Instagram</a>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="text-xs text-muted-foreground">Lead do pixel da Meta. Enxerga perto de metade do inscrito real, mas é o número que o kill switch lê. Veredito contra o kill de {brl0(KILL)}.</p>
    </>
  );
}

// ---------------------------------------------------------------------------
// Captação Le08 e Público
// ---------------------------------------------------------------------------

function Captacao({ traffic, de, ate }: { traffic: IplTrafficRow[]; de: string; ate: string }) {
  const KILL = IPL.killCpl;
  const cap = useMemo(() => traffic.filter((r) => r.d >= de && r.d <= ate && (CAPF as readonly string[]).includes(r.f)), [traffic, de, ate]);
  const t = { s: sum(cap, (r) => r.s), i: sum(cap, (r) => r.i), k: sum(cap, (r) => r.k), l: sum(cap, (r) => r.l), lead: sum(cap, (r) => r.lead) };
  const cpl = t.lead ? t.s / t.lead : null;
  const serie = useMemo(() => {
    const dias = [...new Set(cap.map((r) => r.d))].sort();
    return dias.map((d) => ({ label: dia(d), s: sum(cap.filter((r) => r.d === d), (r) => r.s), lead: sum(cap.filter((r) => r.d === d), (r) => r.lead) }));
  }, [cap]);
  const fr = CAPF.map((f) => {
    const x = cap.filter((r) => r.f === f);
    const s = sum(x, (r) => r.s), lead = sum(x, (r) => r.lead);
    return { f, s, lead, cpl: lead ? s / lead : null };
  }).filter((x) => x.s > 0);
  const mxc = Math.max(...fr.map((x) => x.cpl ?? 0), KILL) * 1.15;
  const ant = traffic.filter((r) => r.f === "ANT");
  const A = { s: sum(ant, (r) => r.s), r: sum(ant, (r) => r.r), i: sum(ant, (r) => r.i) };
  const funil = [
    ["Impressões", t.i, t.i ? `CPM ${brl(1000 * t.s / t.i)}` : ""],
    ["Cliques no link", t.k, `CTR ${pc(t.i ? (100 * t.k) / t.i : null)}`],
    ["Visitas na página", t.l, `${pc(t.k ? (100 * t.l) / t.k : null)} dos cliques`],
    ["Leads (pixel)", t.lead, `${pc(t.l ? (100 * t.lead) / t.l : null)} das visitas`],
  ] as const;
  const mxf = Math.sqrt(Math.max(...funil.map((x) => x[1]), 1));

  return (
    <>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Tile label="Investimento" value={brl0(t.s)} sub="estáticos, vídeos e quente" />
        <Tile label="CPL pixel" value={cpl == null ? "—" : brl(cpl)} sub={cpl == null ? "" : cpl <= KILL ? <Pill tone="good">abaixo do kill {brl0(KILL)}</Pill> : <Pill tone="crit">acima do kill {brl0(KILL)}</Pill>} />
        <Tile label="Leads pixel" value={int(t.lead)} sub="pixel vê ~metade do real" />
        <Tile label="Inscritos Active" value={<SemFonte inline>ActiveCampaign ainda não está integrado ao FAROL.</SemFonte>} sub="CPL real indisponível" />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Investimento por dia">
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={serie} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" {...axisProps} minTickGap={24} />
                <YAxis {...axisProps} width={56} tickFormatter={brl0} />
                <Tooltip formatter={(v: number) => [brl(v), "Investimento"]} {...tooltipStyle} />
                <Bar dataKey="s" fill={CHART.s1} radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Leads por dia">
          <p className="-mt-2 text-sm text-muted-foreground">Pixel da Meta. Inscritos do ActiveCampaign: <SemFonte inline>ActiveCampaign ainda não está integrado.</SemFonte></p>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={serie} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" {...axisProps} minTickGap={24} />
                <YAxis {...axisProps} width={40} allowDecimals={false} />
                <Tooltip formatter={(v: number) => [int(v), "Pixel"]} {...tooltipStyle} />
                <Bar dataKey="lead" fill={CHART.s1} radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="CPL pixel por frente">
          <p className="-mt-2 text-sm text-muted-foreground">Traço vertical = kill switch em {brl0(KILL)} por lead</p>
          {fr.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem captação no período.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {fr.map((x) => (
                <li key={x.f} className="flex flex-col gap-1.5">
                  <div className="flex justify-between gap-3 text-sm">
                    <span className="flex items-center gap-1.5"><i className="inline-block size-2.5 rounded-sm" style={{ background: CAPF_COR[x.f] }} />{CAPF_LBL[x.f]}</span>
                    <span className="font-semibold tabular-nums">{x.cpl == null ? "—" : brl(x.cpl)} · {int(x.lead)} leads · {brl0(x.s)}</span>
                  </div>
                  <div className="relative h-2 rounded-full bg-muted">
                    <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(100 * (x.cpl ?? 0)) / mxc}%`, background: CAPF_COR[x.f] }} />
                    <b className="absolute -inset-y-0.5 w-0.5 bg-foreground" style={{ left: `${(100 * KILL) / mxc}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Funil da captação">
          <p className="-mt-2 text-sm text-muted-foreground">Do anúncio ao lead, no período (barras em raiz quadrada)</p>
          <ul className="flex flex-col gap-3">
            {funil.map((x) => (
              <li key={x[0]} className="flex flex-col gap-1.5">
                <div className="flex justify-between gap-3 text-sm"><span>{x[0]}</span><span className="font-semibold tabular-nums">{int(x[1])}{x[2] ? ` · ${x[2]}` : ""}</span></div>
                <div className="h-2 rounded-full bg-muted"><span className="block h-full rounded-full bg-primary" style={{ width: `${(100 * Math.sqrt(x[1])) / mxf}%` }} /></div>
              </li>
            ))}
            <li className="flex items-center justify-between text-sm"><span>Inscritos (Active)</span><SemFonte inline>ActiveCampaign ainda não está integrado.</SemFonte></li>
          </ul>
        </Panel>
      </div>
      <Panel title="Antecipação">
        <p className="-mt-2 text-sm text-muted-foreground">Visualização de vídeo antes da captação. Não gera lead; o produto é o público aquecido. Ignora o período.</p>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Tile label="Investimento" value={brl0(A.s)} />
          <Tile label="Alcance*" value={int(A.r)} />
          <Tile label="Custo por mil alcançados" value={A.r ? brl((1000 * A.s) / A.r) : "—"} />
          <Tile label="Impressões" value={int(A.i)} sub={A.r ? `frequência ${dec(A.i / A.r, 1)}` : ""} />
        </div>
        <p className="text-xs text-muted-foreground">*Alcance é a soma dos anúncios (não é de contas únicas).</p>
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

export default function LaunchIplFortaleza() {
  const { workspace } = useWorkspace();
  const ws = workspace?.id;
  const [params, setParams] = usePersistentSearchParams();
  const hoje = todaySP();
  const tab = (TABS.some((t) => t.id === params.get("aba")) ? params.get("aba") : "geral") as Tab;

  const sales = useIplSales(ws);
  const traffic = useIplTraffic(ws);
  const invoices = useIplInvoices(ws);

  const trFim = useMemo(() => (traffic.data ?? []).reduce((a, r) => (r.d > a ? r.d : a), IPL.plano.inicio), [traffic.data]);
  const de = params.get("de") ?? IPL.plano.inicio;
  const ate = params.get("ate") ?? (trFim > de ? trFim : hoje);
  const vendas = sales.data ?? [];

  const adsVD = useIplAds(ws, IPL.antecipacaoInicio, hoje);
  const adsCap = useIplAds(ws, tab === "crCAP" ? de : IPL.plano.inicio, tab === "crCAP" ? ate : IPL.plano.inicio);

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next);
  };

  const presets: [string, string, string][] = [
    ["Captação", IPL.plano.inicio, trFim],
    ["Com antecipação", IPL.antecipacaoInicio, trFim],
    ["Últimos 3 dias", addDaysISO(trFim, -2), trFim],
  ];
  const needsPeriod = tab === "cap" || tab === "crCAP" || tab === "pub";

  return (
    <CommercialShell
      eyebrow="Marketing"
      sections={META_SECTIONS}
      title="Painel IPL Fortaleza — Painel da edição"
      description={`IPL Fortaleza (CE) · ${IPL.eventoLabel}. Vendas da Hubla e tráfego da Meta (campanhas IPL-Fp08 e IPL-Le08), por frente e criativo.`}
      filters={<Seg value={tab} options={TABS} onChange={(v) => set({ aba: v === "geral" ? null : v })} label="Abas" />}
    >
      {(sales.error || traffic.error) && <EmptyState>Não foi possível carregar os dados: {((sales.error ?? traffic.error) as Error).message}</EmptyState>}

      {needsPeriod && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Período</span>
          <div className="flex flex-wrap gap-1.5">
            {presets.map(([label, a, b]) => (
              <button key={label} type="button" onClick={() => set({ de: a, ate: b })} className={cn("h-9 rounded-full border px-3 text-sm font-medium", de === a && ate === b ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:text-foreground")}>{label}</button>
            ))}
          </div>
          <DateRange from={de} to={ate} min={IPL.antecipacaoInicio} max={hoje} onChange={(a, b) => set({ de: a <= b ? a : b, ate: a <= b ? b : a })} />
          <span className="text-sm text-muted-foreground">{dia(de)} a {dia(ate)}</span>
        </div>
      )}

      {tab === "geral" && <Geral vendas={vendas} hoje={hoje} loading={sales.isLoading} />}
      {tab === "vendas" && (sales.isLoading ? <LoadingBlock /> : <Vendas vendas={vendas} traffic={traffic.data ?? []} invoices={invoices.data} />)}
      {tab === "crVD" && <CriativosVD ads={adsVD.data ?? []} vendas={vendas} loading={adsVD.isLoading || sales.isLoading} />}
      {tab === "crCAP" && <CriativosCap ads={adsCap.data ?? []} loading={adsCap.isLoading} />}
      {tab === "cap" && (traffic.isLoading ? <LoadingBlock /> : <Captacao traffic={traffic.data ?? []} de={de} ate={ate} />)}
      {tab === "pub" && (
        <Panel title="Perfil dos compradores">
          <SemFonte>
            A aba Público do painel de referência usa a pesquisa pós-compra (renda, idade, ocupação, cenário, desejo, tempo que conhece, gênero e se já participou), cruzada com a venda paga. Essa pesquisa ainda não existe no FAROL.
            Quando houver, entram aqui as barras por campo e o MQL 10k+ (renda declarada ≥ R$ 10.001).
          </SemFonte>
        </Panel>
      )}

      <p className="text-xs text-muted-foreground">
        Fontes: Hubla (faturas pagas do produto Fortaleza (CE), classificadas por UTM em Meteórico / Venda direta / Disparo / Outros) e Meta Ads (campanhas IPL-Fp08 e IPL-Le08). Cadeira = venda paga; ingresso Duplo conta 2. Nenhum dado pessoal de comprador aparece no painel.
        Meta de cadeiras, datas e kill switch ficam em src/lib/launchReports.ts.
      </p>
    </CommercialShell>
  );
}
