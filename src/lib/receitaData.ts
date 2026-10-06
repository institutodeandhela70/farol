import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { addMonthsYM, monthBoundsYM, type ResultFilters } from "@/lib/resultFilters";

// Receita (menu Resultado) — entradas da IULI (valor pago, data do pagamento) de
// categorias de produto, ligadas ao negócio ganho do HubSpot (migration 20260930230000/240000).

type Num = number | string | null;
const n = (v: Num) => (v === null || v === undefined ? 0 : Number(v));

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T[]> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return (data ?? []) as T[];
}

export type RevenueOrigin = "mes" | "outros" | "sem_negocio";

export interface RevenueSummaryRow {
  origem: RevenueOrigin;
  situacao: "recebido" | "a_receber";
  produto: string;
  qtd: number;
  total: number;
}
export interface RevenueSeriesRow {
  bucket: string;
  origem: RevenueOrigin;
  qtd: number;
  total: number;
}
export interface RevenueSafraRow {
  mes_entrada: string;
  mes_venda: string | null;
  qtd: number;
  total: number;
}
export interface RevenueOutRow {
  tratamento: string;
  categoria: string;
  qtd: number;
  total: number;
}
const scope = (f: ResultFilters) => ({
  p_integration_ids: f.empresa !== "todas" ? [f.empresa] : null,
  p_excluir_ee: f.excluirEE,
});
const base = (ws: string, f: ResultFilters, range?: { from: string; to: string }) => ({
  p_workspace_id: ws,
  p_from: (range ?? f).from,
  p_to: (range ?? f).to,
  ...scope(f),
});
const withProduct = (ws: string, f: ResultFilters, range?: { from: string; to: string }) => ({ ...base(ws, f, range), p_produto: f.produto });
const key = (f: ResultFilters) => [f.from, f.to, f.empresa, f.excluirEE, f.produto];

export function useRevenueSummary(ws: string | undefined, f: ResultFilters) {
  return useQuery({
    queryKey: ["revenue", "summary", ws, ...key(f)],
    enabled: !!ws,
    queryFn: async () => (await rpc<RevenueSummaryRow>("receita_summary", withProduct(ws!, f))).map((r) => ({ ...r, qtd: n(r.qtd), total: n(r.total) })),
  });
}

export function useRevenueSeries(ws: string | undefined, f: ResultFilters) {
  return useQuery({
    queryKey: ["revenue", "series", ws, ...key(f), f.grain],
    enabled: !!ws,
    queryFn: async () => (await rpc<RevenueSeriesRow>("receita_series", { ...withProduct(ws!, f), p_grain: f.grain })).map((r) => ({ ...r, qtd: n(r.qtd), total: n(r.total) })),
  });
}

/** Matriz de safra: dos 6 meses até a data final do filtro (ou do período, se for maior). */
export function safraRange(f: Pick<ResultFilters, "from" | "to">) {
  const start = `${addMonthsYM(f.to.slice(0, 7), -5)}-01`;
  return { from: f.from < start ? f.from : start, to: f.to };
}

export function useRevenueSafra(ws: string | undefined, f: ResultFilters) {
  const range = safraRange(f);
  return useQuery({
    queryKey: ["revenue", "safra", ws, range.from, range.to, f.empresa, f.excluirEE, f.produto],
    enabled: !!ws,
    queryFn: async () => (await rpc<RevenueSafraRow>("receita_safra", withProduct(ws!, f, range))).map((r) => ({ ...r, qtd: n(r.qtd), total: n(r.total) })),
  });
}

export function useRevenueOut(ws: string | undefined, f: ResultFilters) {
  return useQuery({
    queryKey: ["revenue", "out", ws, f.from, f.to, f.empresa, f.excluirEE],
    enabled: !!ws,
    queryFn: async () => (await rpc<RevenueOutRow>("receita_fora", base(ws!, f))).map((r) => ({ ...r, qtd: n(r.qtd), total: n(r.total) })),
  });
}

export function useRevenueProducts(ws: string | undefined, f: ResultFilters) {
  return useQuery({
    queryKey: ["revenue", "products", ws, f.from, f.to],
    enabled: !!ws,
    queryFn: async () => (await rpc<{ produto: string; total: Num }>("receita_produtos", { p_workspace_id: ws, p_from: f.from, p_to: f.to })).map((r) => r.produto),
  });
}

export async function refreshRevenueLinks(ws: string): Promise<number> {
  const { data, error } = await supabase.rpc("receita_refresh_links_admin", { p_workspace_id: ws });
  if (error) throw error;
  return Number(data ?? 0);
}

export { monthBoundsYM };
