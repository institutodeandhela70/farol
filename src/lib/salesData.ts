import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { ResultFilters } from "@/lib/resultFilters";

// Vendas (menu Resultado) — negócios ganhos do HubSpot, classificados por
// produto, pelas funções sales_* (migrations 20260930080000 e 20260930090000).

type Num = number | string | null;
const n = (v: Num) => (v === null || v === undefined ? 0 : Number(v));

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T[]> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return (data ?? []) as T[];
}

export type SalesGroup = "high" | "demais" | "fora_dos_6";
export type PipelineKind = "contratos" | "hubla_tmb";

export interface SalesSummaryRow {
  grupo: SalesGroup;
  pipeline_kind: PipelineKind;
  produto: string;
  qtd: number;
  total: number;
}

export interface SalesSeriesRow {
  bucket: string;
  pipeline_kind: PipelineKind;
  grupo: SalesGroup;
  qtd: number;
  total: number;
}

export interface SalesDeal {
  hubspot_id: string;
  dealname: string | null;
  produto: string;
  produto_raw: string | null;
  pipeline_kind: PipelineKind;
  grupo: SalesGroup;
  dia: string;
  owner_id: string | null;
  amount: number;
  duplicado: boolean;
}

const base = (ws: string, f: ResultFilters, range?: { from: string; to: string }) => ({
  p_workspace_id: ws,
  p_from: (range ?? f).from,
  p_to: (range ?? f).to,
  p_owner: f.owner,
  p_produto: f.produto,
});

export function useSalesSummary(ws: string | undefined, f: ResultFilters, range?: { from: string; to: string }) {
  return useQuery({
    queryKey: ["sales", "summary", ws, f.from, f.to, f.owner, f.produto, range],
    enabled: !!ws,
    queryFn: async () =>
      (await rpc<SalesSummaryRow>("sales_summary", base(ws!, f, range))).map((r) => ({ ...r, qtd: n(r.qtd), total: n(r.total) })),
  });
}

export function useSalesSeries(ws: string | undefined, f: ResultFilters) {
  return useQuery({
    queryKey: ["sales", "series", ws, f.from, f.to, f.grain, f.owner, f.produto],
    enabled: !!ws,
    queryFn: async () =>
      (await rpc<SalesSeriesRow>("sales_series", { ...base(ws!, f), p_grain: f.grain })).map((r) => ({ ...r, qtd: n(r.qtd), total: n(r.total) })),
  });
}

export function useSalesDeals(
  ws: string | undefined,
  f: ResultFilters,
  opts: { grupo?: SalesGroup | null; onlyDuplicates?: boolean; limit?: number; enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: ["sales", "deals", ws, f.from, f.to, f.owner, f.produto, opts.grupo, opts.onlyDuplicates, opts.limit],
    enabled: !!ws && opts.enabled !== false,
    queryFn: async () =>
      (
        await rpc<SalesDeal>("sales_deals_list", {
          ...base(ws!, f),
          p_grupo: opts.grupo ?? null,
          p_limit: opts.limit ?? 10,
          p_only_duplicates: !!opts.onlyDuplicates,
          p_exclude_fora: !opts.grupo && !opts.onlyDuplicates,
        })
      ).map((r) => ({ ...r, amount: n(r.amount) })),
  });
}

export function useSalesDuplicates(ws: string | undefined, f: ResultFilters) {
  return useQuery({
    queryKey: ["sales", "duplicates", ws, f.from, f.to],
    enabled: !!ws,
    queryFn: async () =>
      (await rpc<{ produto: string; qtd: Num; total: Num }>("sales_duplicates", { p_workspace_id: ws, p_from: f.from, p_to: f.to })).map((r) => ({
        produto: r.produto,
        qtd: n(r.qtd),
        total: n(r.total),
      })),
  });
}

export function useSalesOptions(ws: string | undefined, f: ResultFilters) {
  return useQuery({
    queryKey: ["sales", "options", ws, f.from, f.to],
    enabled: !!ws,
    queryFn: async () => {
      const rows = await rpc<{ kind: "produto" | "owner"; value: string; qtd: Num }>("sales_options", { p_workspace_id: ws, p_from: f.from, p_to: f.to });
      return {
        produtos: rows.filter((r) => r.kind === "produto").sort((a, b) => n(b.qtd) - n(a.qtd)).map((r) => r.value),
        owners: rows.filter((r) => r.kind === "owner").map((r) => r.value),
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Configuração (tela Produtos): catálogo, de-para e dedupe
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Vendas que deveriam estar em Contratos e não foram encontradas lá
// (função vendas_faltantes, migration 20261005200000)
// ---------------------------------------------------------------------------

export interface MissingSale {
  cliente: string;
  produto: string;
  contratos_situacao: "nao_existe" | "nao_ganho";
  contratos_etapa: string | null;
  contratos_negocio: string | null;
  contratos_valor: number | null;
  contratos_data: string | null;
  contratos_owner_id: string | null;
  hubla_qtd: number;
  hubla_valor: number;
  hubla_primeira: string | null;
  iuli_qtd: number;
  iuli_valor: number;
  iuli_recebido: number;
  iuli_a_receber: number;
  iuli_primeira: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  documento: string | null;
}

export function useSalesMissing(ws: string | undefined, f: ResultFilters) {
  return useQuery({
    queryKey: ["sales", "missing", ws, f.from, f.to],
    enabled: !!ws,
    queryFn: async () =>
      (await rpc<Record<string, Num | string | null>>("vendas_faltantes", { p_workspace_id: ws, p_from: f.from, p_to: f.to })).map(
        (r) =>
          ({
            ...r,
            contratos_valor: r.contratos_valor == null ? null : n(r.contratos_valor as Num),
            hubla_qtd: n(r.hubla_qtd as Num),
            hubla_valor: n(r.hubla_valor as Num),
            iuli_qtd: n(r.iuli_qtd as Num),
            iuli_valor: n(r.iuli_valor as Num),
            iuli_recebido: n(r.iuli_recebido as Num),
            iuli_a_receber: n(r.iuli_a_receber as Num),
          }) as unknown as MissingSale,
      ),
  });
}

export interface CatalogRow {
  produto: string;
  is_high: boolean;
  count_hubla: boolean;
  sort_order: number;
}

export interface OverrideRow {
  source: PipelineKind;
  raw_value: string;
  produto: string;
}

export function useSalesCatalog(ws: string | undefined) {
  return useQuery({
    queryKey: ["sales", "catalog", ws],
    enabled: !!ws,
    queryFn: async () => {
      const { data, error } = await supabase.from("sales_product_catalog").select("produto, is_high, count_hubla, sort_order").eq("workspace_id", ws!).order("sort_order");
      if (error) throw error;
      return (data ?? []) as CatalogRow[];
    },
  });
}

export function useSalesOverrides(ws: string | undefined) {
  return useQuery({
    queryKey: ["sales", "overrides", ws],
    enabled: !!ws,
    queryFn: async () => {
      const { data, error } = await supabase.from("sales_product_overrides").select("source, raw_value, produto").eq("workspace_id", ws!);
      if (error) throw error;
      return (data ?? []) as OverrideRow[];
    },
  });
}

export interface SalesSettings {
  dedupe_enabled: boolean;
  dedupe_days: number;
}

export function useSalesSettings(ws: string | undefined) {
  return useQuery({
    queryKey: ["sales", "settings", ws],
    enabled: !!ws,
    queryFn: async () => {
      const { data, error } = await supabase.from("sales_settings").select("dedupe_enabled, dedupe_days").eq("workspace_id", ws!).maybeSingle();
      if (error) throw error;
      return (data ?? { dedupe_enabled: true, dedupe_days: 90 }) as SalesSettings;
    },
  });
}

/** Valores de produto que existem nos negócios ganhos, com o nome padronizado atual (para o de-para). */
export function useRawProducts(ws: string | undefined) {
  return useQuery({
    queryKey: ["sales", "raw-products", ws],
    enabled: !!ws,
    queryFn: async () => {
      const rows = await rpc<{ pipeline_kind: PipelineKind; produto_raw: string | null; produto: string; grupo: SalesGroup; qtd: Num; total: Num }>("sales_raw_products", {
        p_workspace_id: ws,
      });
      return rows.map((r) => ({ ...r, qtd: n(r.qtd), total: n(r.total) }));
    },
  });
}
