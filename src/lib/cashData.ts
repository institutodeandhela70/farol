import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { ResultFilters } from "@/lib/resultFilters";

// Caixa (menu Resultado) — receitas da IULI pela data de vencimento, só de
// categorias de produto (migration 20260930200000).

type Num = number | string | null;
const n = (v: Num) => (v === null || v === undefined ? 0 : Number(v));

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T[]> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return (data ?? []) as T[];
}

export type CashSituation = "recebido" | "a_vencer" | "vencido";

export interface CashSeriesRow {
  bucket: string;
  situacao: CashSituation;
  qtd: number;
  total: number;
}
export interface CashSummaryRow {
  situacao: CashSituation;
  produto: string;
  qtd: number;
  total: number;
}
export interface CashOutRow {
  tratamento: string;
  categoria: string;
  qtd: number;
  total: number;
}
export interface CashClientRow {
  cliente: string;
  qtd: number;
  total: number;
  recebido: number;
  aberto: number;
}
export interface CashAgingRow {
  faixa: string;
  ordem: number;
  qtd: number;
  total: number;
}
export interface CashTitle {
  empresa: string;
  cliente: string | null;
  categoria: string | null;
  produto: string | null;
  due_date: string;
  pagamento: string | null;
  situacao: CashSituation;
  valor: number;
}

const scope = (f: ResultFilters) => ({
  p_integration_ids: f.empresa !== "todas" ? [f.empresa] : null,
  p_excluir_ee: f.excluirEE,
});

const base = (ws: string, f: ResultFilters) => ({ p_workspace_id: ws, p_from: f.from, p_to: f.to, ...scope(f) });
const withProduct = (ws: string, f: ResultFilters) => ({ ...base(ws, f), p_produto: f.produto });

const key = (f: ResultFilters) => [f.from, f.to, f.empresa, f.excluirEE, f.produto];

export function useCashSeries(ws: string | undefined, f: ResultFilters) {
  return useQuery({
    queryKey: ["cash", "series", ws, ...key(f), f.grain],
    enabled: !!ws,
    queryFn: async () => (await rpc<CashSeriesRow>("caixa_series", { ...withProduct(ws!, f), p_grain: f.grain })).map((r) => ({ ...r, qtd: n(r.qtd), total: n(r.total) })),
  });
}

export function useCashSummary(ws: string | undefined, f: ResultFilters) {
  return useQuery({
    queryKey: ["cash", "summary", ws, ...key(f)],
    enabled: !!ws,
    queryFn: async () => (await rpc<CashSummaryRow>("caixa_summary", withProduct(ws!, f))).map((r) => ({ ...r, qtd: n(r.qtd), total: n(r.total) })),
  });
}

export function useCashOut(ws: string | undefined, f: ResultFilters) {
  return useQuery({
    queryKey: ["cash", "out", ws, f.from, f.to, f.empresa, f.excluirEE],
    enabled: !!ws,
    queryFn: async () => (await rpc<CashOutRow>("caixa_fora", base(ws!, f))).map((r) => ({ ...r, qtd: n(r.qtd), total: n(r.total) })),
  });
}

export function useCashClients(ws: string | undefined, f: ResultFilters, limit = 10) {
  return useQuery({
    queryKey: ["cash", "clients", ws, ...key(f), limit],
    enabled: !!ws,
    queryFn: async () =>
      (await rpc<CashClientRow>("caixa_clientes", { ...withProduct(ws!, f), p_limit: limit })).map((r) => ({
        ...r,
        qtd: n(r.qtd),
        total: n(r.total),
        recebido: n(r.recebido),
        aberto: n(r.aberto),
      })),
  });
}

export function useCashAging(ws: string | undefined, f: ResultFilters) {
  return useQuery({
    queryKey: ["cash", "aging", ws, f.empresa, f.excluirEE, f.produto],
    enabled: !!ws,
    queryFn: async () =>
      (await rpc<CashAgingRow>("caixa_aging", { p_workspace_id: ws, ...scope(f), p_produto: f.produto }))
        .map((r) => ({ ...r, qtd: n(r.qtd), total: n(r.total) }))
        .sort((a, b) => a.ordem - b.ordem),
  });
}

export function useCashTitles(ws: string | undefined, f: ResultFilters, limit = 15) {
  return useQuery({
    queryKey: ["cash", "titles", ws, ...key(f), limit],
    enabled: !!ws,
    queryFn: async () =>
      (await rpc<CashTitle>("caixa_titulos", { ...withProduct(ws!, f), p_situacao: null, p_limit: limit })).map((r) => ({ ...r, valor: n(r.valor) })),
  });
}

export function useCashProducts(ws: string | undefined, f: ResultFilters) {
  return useQuery({
    queryKey: ["cash", "products", ws, f.from, f.to],
    enabled: !!ws,
    queryFn: async () => (await rpc<{ produto: string; total: Num }>("caixa_produtos", { p_workspace_id: ws, p_from: f.from, p_to: f.to })).map((r) => r.produto),
  });
}
