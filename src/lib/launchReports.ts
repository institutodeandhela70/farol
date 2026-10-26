import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { addDaysISO, todaySP } from "@/lib/iuliFilters";

// Painéis de lançamento (Marketing): DP100K e IPL Fortaleza — migration 20261027000000.
// Cruzam a Meta (campanhas/anúncios) com a Hubla (vendas por UTM). Análise dos painéis de referência:
// docs/analise-dashboards-meta-ads.md.

type Num = number | string | null;
const n = (v: Num | undefined) => (v === null || v === undefined ? 0 : Number(v));

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T[]> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return (data ?? []) as T[];
}

// ---------------------------------------------------------------------------
// Configuração dos lançamentos (edite aqui quando mudar a edição)
// ---------------------------------------------------------------------------

export const DP100K = {
  campaignRe: "DP100K",
  ticket: ["[DP100K] Desafio Palestrante 100K"],
  ipm: ["[IPM] Imersão Palcos Milionários"],
  /** Primeira segunda-feira da lista de turmas (cada turma = 7 dias a partir dela). */
  turmaStart: "2026-04-27",
  firstDay: "2025-06-01",
  funnels: [
    { key: "todos", label: "Todos" },
    { key: "oferta_principal", label: "Oferta principal" },
    { key: "vsl", label: "VSL" },
    { key: "quiz", label: "Quiz" },
    { key: "rmkt", label: "RMKT" },
  ],
};

export const IPL = {
  campaignRe: "IPL-(Fp08|Le08)",
  products: ["[IPL] Imersão Palestrante Lucrativo - Fortaleza (CE)"],
  evento: "2026-10-16",
  eventoLabel: "evento 16 a 18/10",
  /** Meta de cadeiras: o trilho parte de `desde` e chega em `cadeiras` no dia `ate`. */
  meta: { cadeiras: 220, desde: "2026-09-26", ate: "2026-10-14" },
  /** Captação (Le08): início/fim; `oferta` = abertura do carrinho. */
  plano: { inicio: "2026-08-17", fim: "2026-08-26", oferta: "2026-08-27" },
  antecipacaoInicio: "2026-08-11",
  killCpl: 35,
  ticketPadrao: 247,
};

// ---------------------------------------------------------------------------
// DP100K
// ---------------------------------------------------------------------------

export interface DailyRow {
  d: string;
  spend: number;
  impr: number;
  reach: number;
  lclk: number;
  lpv: number;
  ic: number;
  ing_n: number;
  ing_rev: number;
  ing_meta: number;
  ing_meta_rev: number;
  ipm_n: number;
  ipm_rev: number;
  out_n: number;
  out_rev: number;
}

/** Série diária completa (a tela filtra por período/turma no cliente, como o painel original). */
export function useDp100kDaily(ws: string | undefined, funnel: string) {
  return useQuery({
    queryKey: ["launch", "dp100k", "daily", ws, funnel],
    enabled: !!ws,
    queryFn: async (): Promise<DailyRow[]> => {
      const rows = await rpc<Record<string, Num | string>>("launch_daily", {
        p_workspace_id: ws,
        p_from: DP100K.firstDay,
        p_to: todaySP(),
        p_campaign_re: DP100K.campaignRe,
        p_funnel: funnel === "todos" ? null : funnel,
        p_ticket: DP100K.ticket,
        p_ipm: DP100K.ipm,
        p_other: null,
      });
      return rows.map((r) => ({
        d: r.day as string,
        spend: n(r.spend as Num), impr: n(r.impr as Num), reach: n(r.reach as Num), lclk: n(r.lclk as Num), lpv: n(r.lpv as Num), ic: n(r.ic as Num),
        ing_n: n(r.ing_n as Num), ing_rev: n(r.ing_rev as Num), ing_meta: n(r.ing_meta as Num), ing_meta_rev: n(r.ing_meta_rev as Num),
        ipm_n: n(r.ipm_n as Num), ipm_rev: n(r.ipm_rev as Num), out_n: n(r.out_n as Num), out_rev: n(r.out_rev as Num),
      }));
    },
  });
}

export interface AdRow {
  key: string;
  name: string;
  code: string | null;
  campaign: string;
  seg: string;
  active: boolean;
  thumb: string | null;
  permalink: string | null;
  spend: number;
  purch: number;
  impr: number;
  ic: number;
  lpv: number;
  lclk: number;
  leads: number;
  vimpr: number;
  vviews: number;
  // vendas da Hubla casadas pela UTM
  sales: number;
  rev: number;
}

async function loadAds(ws: string, from: string, to: string, re: string, mode: "dp100k" | "ipl", products: string[], seg: string | null): Promise<AdRow[]> {
  const [ads, sales] = await Promise.all([
    rpc<Record<string, Num | string | boolean | null>>("launch_ads", { p_workspace_id: ws, p_from: from, p_to: to, p_campaign_re: re, p_mode: mode, p_seg: seg }),
    rpc<Record<string, Num | string>>("launch_sales_by_ad", { p_workspace_id: ws, p_from: from, p_to: to, p_products: products, p_mode: mode, p_frente: null }),
  ]);
  const bySales = new Map(sales.map((s) => [s.ad_key as string, { n: n(s.n as Num), rev: n(s.rev as Num) }]));
  const out: AdRow[] = ads.map((a) => {
    const s = bySales.get(a.ad_key as string);
    bySales.delete(a.ad_key as string);
    return {
      key: a.ad_key as string, name: (a.ad_name as string) ?? (a.ad_key as string), code: a.ad_code as string | null, campaign: (a.campaign_name as string) ?? "",
      seg: a.seg as string, active: a.is_active === true, thumb: a.thumb as string | null, permalink: a.permalink as string | null,
      spend: n(a.spend as Num), purch: n(a.purch as Num), impr: n(a.impr as Num), ic: n(a.ic as Num), lpv: n(a.lpv as Num), lclk: n(a.lclk as Num),
      leads: n(a.leads as Num), vimpr: n(a.vimpr as Num), vviews: n(a.vviews as Num), sales: s?.n ?? 0, rev: s?.rev ?? 0,
    };
  });
  // vendas sem anúncio com verba no período (ex.: "sem AD" na UTM) ficam num balde próprio
  if (mode === "ipl") {
    for (const [k, s] of bySales) {
      if (k.startsWith("sem AD")) out.push({ key: k, name: "sem AD", code: null, campaign: "", seg: "VDA", active: false, thumb: null, permalink: null, spend: 0, purch: 0, impr: 0, ic: 0, lpv: 0, lclk: 0, leads: 0, vimpr: 0, vviews: 0, sales: s.n, rev: s.rev });
    }
  }
  return out;
}

export function useDp100kAds(ws: string | undefined, from: string, to: string, funnel: string) {
  return useQuery({
    queryKey: ["launch", "dp100k", "ads", ws, from, to, funnel],
    enabled: !!ws && !!from && !!to,
    queryFn: () => loadAds(ws!, from, to, DP100K.campaignRe, "dp100k", DP100K.ticket, funnel === "todos" ? null : funnel),
  });
}

/** Turmas semanais [inicio, fim) a partir de DP100K.turmaStart; rótulo = mês do fim + contador no mês. */
export interface Turma {
  label: string;
  inicio: string;
  fim: string; // exclusivo
}
const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
export function buildTurmas(today = todaySP()): Turma[] {
  const out: Turma[] = [];
  const counter: Record<string, number> = {};
  for (let ini = DP100K.turmaStart; ini <= today; ini = addDaysISO(ini, 7)) {
    const fim = addDaysISO(ini, 7);
    const ym = fim.slice(0, 7);
    counter[ym] = (counter[ym] ?? 0) + 1;
    out.push({ label: `${MESES[Number(fim.slice(5, 7)) - 1]}/${fim.slice(2, 4)} - ${counter[ym]}`, inicio: ini, fim });
  }
  return out;
}

export function aggDaily(rows: DailyRow[]) {
  const s = (k: keyof DailyRow) => rows.reduce((t, r) => t + (Number(r[k]) || 0), 0);
  const inv = s("spend");
  const fat = s("ing_rev") + s("ipm_rev") + s("out_rev");
  return {
    inv, ing: s("ing_n"), ing_rev: s("ing_rev"), ing_meta: s("ing_meta"), ipm: s("ipm_n"), ipm_rev: s("ipm_rev"),
    out: s("out_n"), out_rev: s("out_rev"), fat, roas: inv ? fat / inv : null,
    impr: s("impr"), reach: s("reach"), lclk: s("lclk"), lpv: s("lpv"), ic: s("ic"),
  };
}

/** Hook = visualizações de 3 s ÷ impressões (dias com vídeo). Piso de 30 visualizações contra ruído. */
export const V3_MIN = 30;
export const hookRate = (a: AdRow) => (a.vimpr > 0 && a.vviews >= V3_MIN ? (a.vviews / a.vimpr) * 100 : null);

// ---------------------------------------------------------------------------
// IPL Fortaleza
// ---------------------------------------------------------------------------

export interface IplSale {
  d: string;
  h: string;
  of: string;
  tp: string;
  cad: number;
  v: number;
  mp: string;
  pc: number;
  fr: "MET" | "VDA" | "VDD" | "OUT";
  src: string;
  camp: string;
  a: string | null;
}

export function useIplSales(ws: string | undefined) {
  return useQuery({
    queryKey: ["launch", "ipl", "sales", ws],
    enabled: !!ws,
    queryFn: async (): Promise<IplSale[]> => {
      const rows = await rpc<Record<string, Num | string | null>>("launch_ipl_sales", { p_workspace_id: ws, p_products: IPL.products, p_from: "2026-01-01", p_to: "2026-12-31" });
      return rows.map((r) => ({
        d: r.day as string, h: (r.hour as string) ?? "", of: (r.offer as string) ?? "", tp: r.tp as string, cad: n(r.cad as Num), v: n(r.value as Num),
        mp: (r.pay_method as string) ?? "", pc: n(r.installments as Num) || 1, fr: r.fr as IplSale["fr"], src: (r.src as string) ?? "", camp: (r.camp as string) ?? "", a: r.ad_code as string | null,
      }));
    },
  });
}

export interface IplTrafficRow {
  d: string;
  f: string;
  a: string;
  s: number;
  i: number;
  r: number;
  k: number;
  l: number;
  lead: number;
}

export function useIplTraffic(ws: string | undefined) {
  return useQuery({
    queryKey: ["launch", "ipl", "traffic", ws],
    enabled: !!ws,
    queryFn: async (): Promise<IplTrafficRow[]> => {
      const rows = await rpc<Record<string, Num | string>>("launch_traffic", { p_workspace_id: ws, p_from: IPL.antecipacaoInicio, p_to: todaySP(), p_campaign_re: IPL.campaignRe });
      return rows.map((r) => ({
        d: r.day as string, f: r.front as string, a: r.ad_code as string, s: n(r.spend as Num), i: n(r.impr as Num), r: n(r.reach as Num),
        k: n(r.clicks as Num), l: n(r.lpv as Num), lead: n(r.leads as Num),
      }));
    },
  });
}

export function useIplAds(ws: string | undefined, from: string, to: string) {
  return useQuery({
    queryKey: ["launch", "ipl", "ads", ws, from, to],
    enabled: !!ws,
    queryFn: () => loadAds(ws!, from, to, IPL.campaignRe, "ipl", IPL.products, null),
  });
}

export function useIplInvoices(ws: string | undefined) {
  return useQuery({
    queryKey: ["launch", "ipl", "invoices", ws],
    enabled: !!ws,
    queryFn: async () => {
      const rows = await rpc<{ status: string; n: Num }>("launch_invoice_status", { p_workspace_id: ws, p_products: IPL.products });
      return Object.fromEntries(rows.map((r) => [r.status, n(r.n)])) as Record<string, number>;
    },
  });
}

// Matemática de ritmo da edição (porte do painel de referência)
export const diasEntre = (a: string, b: string) => Math.round((new Date(`${b}T12:00:00`).getTime() - new Date(`${a}T12:00:00`).getTime()) / 864e5);
export const soma = (iso: string, k: number) => addDaysISO(iso, k);
const SEM = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
export const semana = (d: string) => SEM[new Date(`${d}T12:00:00`).getDay()];

export function pace(vendas: IplSale[], hoje: string) {
  const MT = IPL.meta;
  const porDia: Record<string, { MET: number; VDA: number; VDD: number; OUT: number; t: number }> = {};
  for (const x of vendas) {
    const o = (porDia[x.d] ??= { MET: 0, VDA: 0, VDD: 0, OUT: 0, t: 0 });
    o[x.fr] += x.cad;
    o.t += x.cad;
  }
  const ate = (lim: string) => vendas.filter((x) => x.d <= lim).reduce((a, b) => a + b.cad, 0);
  const total = ate("9999-12-31");
  const base = ate(soma(MT.desde, -1));
  const nPlano = diasEntre(MT.desde, MT.ate) + 1;
  const passo = (MT.cadeiras - base) / nPlano;
  const trilho = (d: string) => (d < soma(MT.desde, -1) ? null : base + passo * (diasEntre(MT.desde, d) + 1));
  const ontem = ate(soma(hoje, -1));
  const hojeN = porDia[hoje]?.t ?? 0;
  const restantes = hoje > MT.ate ? 0 : diasEntre(hoje, MT.ate) + 1;
  const falta = Math.max(MT.cadeiras - total, 0);
  const necessario = restantes ? Math.max(MT.cadeiras - ontem, 0) / restantes : null;
  const ritmo = (ontem - ate(soma(hoje, -8))) / 7;
  const proj = Math.max(ontem + ritmo * restantes, total + ritmo * Math.max(restantes - 1, 0));
  return { MT, H: hoje, porDia, total, base, nPlano, passo, trilho, ontem, hoje: hojeN, restantes, falta, necessario, ritmo, proj, ate };
}


export const CHART = { s1: "#2a78d6", s2: "#eb6834", s3: "#1baf7a", other: "#bdbbb3", violet: "#8b5cf6", amber: "#e6960f" };
