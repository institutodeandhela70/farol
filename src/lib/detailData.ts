import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { ResultFilters } from "@/lib/resultFilters";
import { addMonthsYM, monthBoundsYM } from "@/lib/resultFilters";

// Detalhamento (menu Resultado): as linhas que formam cada número.
// Funções do banco: vendas_detalhe / receita_detalhe / caixa_detalhe
// (migration 20260930260000) — mesmos filtros dos resumos, soma fecha com o KPI.

export type Domain = "vendas" | "receita" | "caixa";

/** O que foi clicado / o que a tabela mostra. Os campos de tela vêm dos filtros da página. */
export interface Drill {
  domain: Domain;
  title: string;
  subtitle?: string;
  from: string;
  to: string;
  /** "todas" ou id da integração IULI (Receita e Caixa). */
  empresa: string;
  /** Filtros de tela. */
  produto: string[] | null;
  owner: string | null;
  // Vendas
  grupos?: string[];
  pipeline?: string | null;
  onlyDuplicates?: boolean;
  // Receita
  tratamento?: string | null;
  origem?: string | null;
  mesVenda?: string | null;
  categoria?: string | null;
  // Caixa
  situacoes?: string[] | null;
  atrasoMin?: number | null;
  atrasoMax?: number | null;
  // Texto inicial de pesquisa
  search?: string;
}

/** Filtros extras que a pessoa aplica na tabela (somam aos da tela). */
export interface TableFilters {
  search: string;
  from: string | null;
  to: string | null;
  produtos: string[] | null;
  owner: string | null;
  empresa: string | null;
  origem: string | null;
  situacao: string | null;
  categoria: string | null;
  pipeline: string | null;
  min: string;
  max: string;
}

export const EMPTY_TABLE_FILTERS: TableFilters = {
  search: "",
  from: null,
  to: null,
  produtos: null,
  owner: null,
  empresa: null,
  origem: null,
  situacao: null,
  categoria: null,
  pipeline: null,
  min: "",
  max: "",
};

export interface DetailRow {
  // comuns
  cliente: string;
  produto: string | null;
  valor: number;
  contact_email: string | null;
  contact_phone: string | null;
  documento: string | null;
  owner_id: string | null;
  closer_owner_id: string | null;
  hubspot_id: string | null;
  dealname: string | null;
  pipeline_kind: string | null;
  dia_ganho: string | null;
  // vendas
  dia?: string | null;
  produto_raw?: string | null;
  grupo?: string | null;
  duplicado?: boolean;
  // receita / caixa
  empresa?: string | null;
  iuli_id?: number | null;
  categoria?: string | null;
  tratamento?: string | null;
  situacao?: string | null;
  pagamento?: string | null;
  due_date?: string | null;
  valor_previsto?: number | null;
  nf_numero?: string | null;
  venda_id?: number | null;
  descricao?: string | null;
  origem?: string | null;
}

export interface DetailPage {
  rows: DetailRow[];
  total: number;
  sum: number;
}

type Raw = Record<string, unknown>;
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

function mapRow(domain: Domain, r: Raw): DetailRow {
  const common = {
    contact_email: str(r.contact_email),
    contact_phone: str(r.contact_phone),
    documento: str(r.documento),
    owner_id: str(r.owner_id),
    closer_owner_id: str(r.closer_owner_id),
    hubspot_id: str(r.hubspot_id),
    dealname: str(r.dealname),
    pipeline_kind: str(r.pipeline_kind),
    dia_ganho: str(r.dia_ganho),
  };
  if (domain === "vendas") {
    return {
      ...common,
      cliente: str(r.contact_name) ?? str(r.dealname) ?? "(sem nome)",
      produto: str(r.produto),
      produto_raw: str(r.produto_raw),
      valor: num(r.amount),
      dia: str(r.dia),
      dia_ganho: str(r.dia),
      grupo: str(r.grupo),
      duplicado: Boolean(r.duplicado),
    };
  }
  return {
    ...common,
    cliente: str(r.cliente) ?? "(sem nome)",
    produto: str(r.produto),
    valor: num(r.valor),
    valor_previsto: numOrNull(r.valor_previsto),
    empresa: str(r.empresa),
    iuli_id: numOrNull(r.iuli_id),
    categoria: str(r.categoria),
    tratamento: str(r.tratamento),
    situacao: str(r.situacao),
    pagamento: str(r.pagamento),
    due_date: str(r.due_date),
    nf_numero: str(r.nf_numero),
    venda_id: numOrNull(r.venda_id),
    descricao: str(r.descricao),
    origem: str(r.origem),
  };
}

export interface DetailQuery {
  sort: string;
  dir: "asc" | "desc";
  limit: number;
  offset: number;
}

/** Junta os filtros da tela (Drill) com os extras da tabela. */
export function buildArgs(ws: string, d: Drill, t: TableFilters, q: DetailQuery): { fn: string; args: Record<string, unknown> } {
  const from = t.from && t.from > d.from ? t.from : d.from;
  const to = t.to && t.to < d.to ? t.to : d.to;
  let produto = d.produto;
  if (t.produtos) produto = produto ? t.produtos.filter((p) => produto!.includes(p)) : t.produtos;
  const empty = produto !== null && produto.length === 0;
  const min = t.min.trim() ? Number(t.min.replace(/\./g, "").replace(",", ".")) : null;
  const max = t.max.trim() ? Number(t.max.replace(/\./g, "").replace(",", ".")) : null;
  const search = t.search.trim() || d.search?.trim() || null;
  const common = {
    p_workspace_id: ws,
    p_from: from,
    p_to: empty ? "1900-01-01" : to,
    p_produto: produto,
    p_search: search,
    p_min: Number.isFinite(min as number) ? min : null,
    p_max: Number.isFinite(max as number) ? max : null,
    p_sort: q.sort,
    p_dir: q.dir,
    p_limit: q.limit,
    p_offset: q.offset,
  };
  const empresaId = t.empresa ?? (d.empresa !== "todas" ? d.empresa : null);
  const integrations = empresaId ? [empresaId] : null;

  if (d.domain === "vendas") {
    return {
      fn: "vendas_detalhe",
      args: {
        ...common,
        p_grupos: d.grupos ?? ["high", "demais"],
        p_pipeline: t.pipeline ?? d.pipeline ?? null,
        p_owner: t.owner ?? d.owner ?? null,
        p_only_duplicates: !!d.onlyDuplicates,
        p_dedupe: true,
      },
    };
  }
  if (d.domain === "receita") {
    return {
      fn: "receita_detalhe",
      args: {
        ...common,
        p_tratamento: d.tratamento === undefined ? "soma" : d.tratamento,
        p_origem: t.origem ?? d.origem ?? null,
        p_mes_venda: d.mesVenda ?? null,
        p_integration_ids: integrations,
        p_categoria: t.categoria ?? d.categoria ?? null,
      },
    };
  }
  return {
    fn: "caixa_detalhe",
    args: {
      ...common,
      p_tratamento: d.tratamento === undefined ? "soma" : d.tratamento,
      p_situacoes: t.situacao ? [t.situacao] : d.situacoes ?? null,
      p_atraso_min: d.atrasoMin ?? null,
      p_atraso_max: d.atrasoMax ?? null,
      p_integration_ids: integrations,
      p_categoria: t.categoria ?? d.categoria ?? null,
    },
  };
}

export async function fetchDetail(ws: string, d: Drill, t: TableFilters, q: DetailQuery): Promise<DetailPage> {
  const { fn, args } = buildArgs(ws, d, t, q);
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  const rows = (data ?? []) as Raw[];
  return {
    rows: rows.map((r) => mapRow(d.domain, r)),
    total: rows.length ? num(rows[0].total_count) : 0,
    sum: rows.length ? num(rows[0].total_sum) : 0,
  };
}

export function useDetail(ws: string | undefined, d: Drill, t: TableFilters, q: DetailQuery, enabled = true) {
  return useQuery({
    queryKey: ["detail", ws, d, t, q],
    enabled: !!ws && enabled,
    queryFn: () => fetchDetail(ws!, d, t, q),
    placeholderData: (prev) => prev,
  });
}

// ---------------------------------------------------------------------------
// Ponte entre a tela e o detalhe
// ---------------------------------------------------------------------------

/** Base do detalhe com os filtros atuais da tela. */
export function drillBase(domain: Domain, f: ResultFilters): Pick<Drill, "domain" | "from" | "to" | "empresa" | "produto" | "owner"> {
  return { domain, from: f.from, to: f.to, empresa: f.empresa, produto: f.produto, owner: f.owner };
}

/** Período do item clicado num gráfico (dia, semana ou mês), sempre dentro do filtro da tela. */
export function bucketRange(bucket: string, grain: "day" | "week" | "month", f: Pick<ResultFilters, "from" | "to">) {
  let from = bucket;
  let to = bucket;
  if (grain === "week") {
    const d = new Date(`${bucket}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 6);
    to = d.toISOString().slice(0, 10);
  } else if (grain === "month") {
    to = monthBoundsYM(bucket.slice(0, 7)).to;
  }
  return { from: from < f.from ? f.from : from, to: to > f.to ? f.to : to };
}

/** Mês inteiro de uma entrada da matriz de safra. */
export function monthRange(ym: string) {
  return monthBoundsYM(ym.slice(0, 7));
}

export { addMonthsYM };

// ---------------------------------------------------------------------------
// CSV (Excel pt-BR: separador ";", decimal vírgula, UTF-8 com BOM)
// ---------------------------------------------------------------------------

export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "number" ? v.toFixed(2).replace(".", ",") : String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function downloadCsv(filename: string, header: string[], lines: unknown[][]) {
  const body = [header, ...lines].map((r) => r.map(csvCell).join(";")).join("\r\n");
  const blob = new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Busca todas as linhas (em páginas de 1000, até 50 mil) para exportar. */
export async function fetchAllDetail(ws: string, d: Drill, t: TableFilters, q: Pick<DetailQuery, "sort" | "dir">): Promise<DetailRow[]> {
  const all: DetailRow[] = [];
  const pageSize = 1000;
  for (let offset = 0; offset < 50_000; offset += pageSize) {
    const page = await fetchDetail(ws, d, t, { ...q, limit: pageSize, offset });
    all.push(...page.rows);
    if (all.length >= page.total || page.rows.length < pageSize) break;
  }
  return all;
}
