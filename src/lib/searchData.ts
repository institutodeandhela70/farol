import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { ResultFilters } from "@/lib/resultFilters";

// Resultado → Pesquisa: lançamentos (títulos) de receita de produto da IULI, com o negócio
// vinculado (migration 20261006000000: pesquisa_lancamentos / pesquisa_lancamento_detalhe).

type Raw = Record<string, unknown>;
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

export type SearchBase = "competencia" | "vencimento" | "pagamento" | "ganho";

export const BASE_LABEL: Record<SearchBase, string> = {
  competencia: "Competência (data da venda na IULI)",
  vencimento: "Vencimento",
  pagamento: "Pagamento",
  ganho: "Data do ganho (Contratos)",
};

export const METHOD_LABEL: Record<string, string> = {
  nome: "Nome do cliente + produto",
  documento: "CPF igual ao do negócio",
  email: "E-mail igual ao do contato",
  valor_data: "Valor exato + data (até 30 dias)",
  manual: "Vínculo manual",
};

export interface SearchRow {
  integration_id: string;
  iuli_id: number;
  empresa: string;
  cliente: string;
  categoria: string | null;
  produto: string | null;
  situacao: "recebido" | "a_vencer" | "vencido";
  competencia: string | null;
  due_date: string | null;
  pagamento: string | null;
  valor: number;
  valor_previsto: number | null;
  nf_numero: string | null;
  venda_id: number | null;
  hubspot_id: string | null;
  dealname: string | null;
  dia_ganho: string | null;
  pipeline_kind: string | null;
  metodo: string | null;
  etapa: string | null;
  owner_id: string | null;
  closer_owner_id: string | null;
  deal_amount: number | null;
  contact_email: string | null;
  contact_phone: string | null;
  documento: string | null;
}

export interface SearchPage {
  rows: SearchRow[];
  total: number;
  sum: number;
}

export interface SearchQuery {
  base: SearchBase;
  search: string;
  situacoes: string[] | null;
  vinculo: "com" | "sem" | null;
  sort: string;
  dir: "asc" | "desc";
  limit: number;
  offset: number;
}

function mapRow(r: Raw): SearchRow {
  return {
    integration_id: String(r.integration_id),
    iuli_id: num(r.iuli_id),
    empresa: str(r.empresa) ?? "",
    cliente: str(r.cliente) ?? "(sem nome)",
    categoria: str(r.categoria),
    produto: str(r.produto),
    situacao: str(r.situacao) as SearchRow["situacao"],
    competencia: str(r.competencia),
    due_date: str(r.due_date),
    pagamento: str(r.pagamento),
    valor: num(r.valor),
    valor_previsto: numOrNull(r.valor_previsto),
    nf_numero: str(r.nf_numero),
    venda_id: numOrNull(r.venda_id),
    hubspot_id: str(r.hubspot_id),
    dealname: str(r.dealname),
    dia_ganho: str(r.dia_ganho),
    pipeline_kind: str(r.pipeline_kind),
    metodo: str(r.metodo),
    etapa: str(r.etapa),
    owner_id: str(r.owner_id),
    closer_owner_id: str(r.closer_owner_id),
    deal_amount: numOrNull(r.deal_amount),
    contact_email: str(r.contact_email),
    contact_phone: str(r.contact_phone),
    documento: str(r.documento),
  };
}

export async function fetchSearch(ws: string, f: ResultFilters, q: SearchQuery): Promise<SearchPage> {
  const { data, error } = await supabase.rpc("pesquisa_lancamentos", {
    p_workspace_id: ws,
    p_base: q.base,
    p_from: f.from,
    p_to: f.to,
    p_search: q.search.trim() || null,
    p_produto: f.produto,
    p_integration_ids: f.empresa !== "todas" ? [f.empresa] : null,
    p_situacoes: q.situacoes,
    p_categoria: null,
    p_vinculo: q.vinculo,
    p_sort: q.sort,
    p_dir: q.dir,
    p_limit: q.limit,
    p_offset: q.offset,
  });
  if (error) throw error;
  const rows = (data ?? []) as Raw[];
  return {
    rows: rows.map(mapRow),
    total: rows.length ? num(rows[0].total_count) : 0,
    sum: rows.length ? num(rows[0].total_sum) : 0,
  };
}

export function useSearch(ws: string | undefined, f: ResultFilters, q: SearchQuery) {
  return useQuery({
    queryKey: ["search", ws, f.from, f.to, f.empresa, f.produto, q],
    enabled: !!ws,
    queryFn: () => fetchSearch(ws!, f, q),
    placeholderData: (prev) => prev,
  });
}

/** Todas as linhas do filtro (páginas de 1000, até 50 mil) para exportar. */
export async function fetchAllSearch(ws: string, f: ResultFilters, q: Omit<SearchQuery, "limit" | "offset">): Promise<SearchRow[]> {
  const all: SearchRow[] = [];
  const size = 1000;
  for (let offset = 0; offset < 50_000; offset += size) {
    const page = await fetchSearch(ws, f, { ...q, limit: size, offset });
    all.push(...page.rows);
    if (all.length >= page.total || page.rows.length < size) break;
  }
  return all;
}

// ---------------------------------------------------------------------------
// Detalhe completo de um lançamento
// ---------------------------------------------------------------------------

export type Detail = Record<string, Record<string, unknown> | Record<string, unknown>[] | null>;

export function useSearchDetail(ws: string | undefined, integrationId: string | null, iuliId: number | null) {
  return useQuery({
    queryKey: ["search", "detail", ws, integrationId, iuliId],
    enabled: !!ws && !!integrationId && iuliId !== null,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("pesquisa_lancamento_detalhe", { p_workspace_id: ws, p_integration_id: integrationId, p_iuli_id: iuliId });
      if (error) throw error;
      return (data ?? null) as Detail | null;
    },
  });
}
