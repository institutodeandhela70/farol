import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { IuliFilters } from "@/lib/iuliFilters";

// Dados do Dashboard Financeiro IULI a partir dos registros (iuli_*), via as
// funções iuli_*_agg do banco (migration 20260929070000). Os totais fixos da
// IULI (iuli_snapshots) continuam sendo usados só na conferência e em
// Projetos & Cadastros.

type Num = number | string | null;
const n = (v: Num) => (v === null || v === undefined ? 0 : Number(v));

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T[]> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return (data ?? []) as T[];
}

/** Empresa do filtro → ids das integrações (null = todas as empresas). */
export function scopeIds(filters: Pick<IuliFilters, "empresa">): string[] | null {
  return filters.empresa && filters.empresa !== "todas" ? [filters.empresa] : null;
}

const common = (ws: string, f: IuliFilters, range?: { from: string; to: string }) => ({
  p_workspace_id: ws,
  p_integration_ids: scopeIds(f),
  p_from: (range ?? f).from,
  p_to: (range ?? f).to,
});

// ---------------------------------------------------------------------------
// Vendas
// ---------------------------------------------------------------------------

export interface SalesAggRow {
  bucket: string | null;
  status: string;
  grupo: "efetiva" | "aberta" | "perdida";
  qtd: number;
  total: number;
  liquido: number;
}

const salesArgs = (f: IuliFilters) => ({
  p_cliente: f.cliente,
  p_status: f.status,
  p_produto: f.produto,
  p_origem: f.origem,
  p_excluir_entre_empresas: f.entreEmpresas === "excluir",
});

export function useSalesAgg(ws: string | undefined, f: IuliFilters, opts: { range?: { from: string; to: string }; grain?: boolean } = {}) {
  const grain = opts.grain ? f.grain : "none";
  return useQuery({
    queryKey: ["iuli", "sales_agg", ws, f, opts.range, grain],
    enabled: !!ws,
    queryFn: async () =>
      (await rpc<SalesAggRow>("iuli_sales_agg", { ...common(ws!, f, opts.range), p_grain: grain, ...salesArgs(f) })).map((r) => ({
        ...r,
        qtd: n(r.qtd),
        total: n(r.total),
        liquido: n(r.liquido),
      })),
  });
}

export function useSalesTop(ws: string | undefined, f: IuliFilters, dim: "produto" | "cliente" | "origem" | "empresa", limit = 12) {
  return useQuery({
    queryKey: ["iuli", "sales_top", ws, f, dim, limit],
    enabled: !!ws,
    queryFn: async () =>
      (await rpc<{ nome: string; qtd: Num; total: Num }>("iuli_sales_top", { ...common(ws!, f), p_dim: dim, ...salesArgs(f), p_limit: limit })).map((r) => ({
        nome: r.nome,
        qtd: n(r.qtd),
        total: n(r.total),
      })),
  });
}

export function useSalesOptions(ws: string | undefined, f: IuliFilters) {
  return useQuery({
    queryKey: ["iuli", "sales_options", ws, f.empresa],
    enabled: !!ws,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const rows = await rpc<{ kind: string; value: string; qtd: Num }>("iuli_sales_options", { p_workspace_id: ws, p_integration_ids: scopeIds(f) });
      const of = (kind: string) =>
        rows.filter((r) => r.kind === kind).map((r) => ({ value: r.value, qtd: n(r.qtd) })).sort((a, b) => b.qtd - a.qtd);
      return { produto: of("produto"), origem: of("origem"), status: of("status") };
    },
  });
}

export interface SaleItem {
  iuli_id: number;
  empresa: string | null;
  status: string;
  valor_total: number;
  dia: string;
  cliente: string | null;
  produto: string | null;
  origem: string;
}

export function useSalesList(ws: string | undefined, f: IuliFilters, limit = 50) {
  return useQuery({
    queryKey: ["iuli", "sales_list", ws, f, limit],
    enabled: !!ws,
    queryFn: async () => {
      let q = supabase
        .from("iuli_sales_v")
        .select("iuli_id, empresa, status, valor_total, dia, cliente, produto, origem", { count: "exact" })
        .eq("workspace_id", ws!)
        .gte("dia", f.from)
        .lte("dia", f.to)
        .order("valor_total", { ascending: false })
        .limit(limit);
      const ids = scopeIds(f);
      if (ids) q = q.in("integration_id", ids);
      if (f.cliente) q = q.ilike("cliente", `%${f.cliente}%`);
      if (f.status) q = q.in("status", f.status);
      if (f.origem) q = q.in("origem", f.origem);
      if (f.produto) {
        const named = f.produto.filter((p) => p !== "(não identificado)");
        q = f.produto.includes("(não identificado)")
          ? q.or(`produto.is.null${named.length ? `,produto.in.(${named.map((p) => `"${p}"`).join(",")})` : ""}`)
          : q.in("produto", named);
      }
      if (f.entreEmpresas === "excluir") q = q.eq("entre_empresas", false);
      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: (data ?? []).map((r) => ({ ...r, valor_total: n(r.valor_total) })) as SaleItem[], count: count ?? 0 };
    },
  });
}

// ---------------------------------------------------------------------------
// Títulos a receber
// ---------------------------------------------------------------------------

export interface FlowRow {
  bucket: string | null;
  serie: "vence_recebido" | "vence_aberto" | "recebido";
  qtd: number;
  total: number;
}

const recArgs = (f: IuliFilters) => ({
  p_cliente: f.cliente,
  p_nf: f.nf,
  p_excluir_entre_empresas: f.entreEmpresas === "excluir",
});

export function useReceivablesFlow(ws: string | undefined, f: IuliFilters, opts: { range?: { from: string; to: string }; grain?: boolean } = {}) {
  const grain = opts.grain ? f.grain : "none";
  return useQuery({
    queryKey: ["iuli", "rec_flow", ws, f, opts.range, grain],
    enabled: !!ws,
    queryFn: async () =>
      (await rpc<FlowRow>("iuli_receivables_flow", { ...common(ws!, f, opts.range), p_grain: grain, ...recArgs(f) })).map((r) => ({
        ...r,
        qtd: n(r.qtd),
        total: n(r.total),
      })),
  });
}

export interface PositionRow {
  faixa: string;
  qtd: number;
  total: number;
  com_nf: number;
  com_anexo: number;
}

export function useReceivablesPosition(ws: string | undefined, f: IuliFilters) {
  return useQuery({
    queryKey: ["iuli", "rec_position", ws, f.empresa, f.cliente, f.nf, f.entreEmpresas],
    enabled: !!ws,
    queryFn: async () =>
      (
        await rpc<PositionRow>("iuli_receivables_position", {
          p_workspace_id: ws,
          p_integration_ids: scopeIds(f),
          ...recArgs(f),
        })
      ).map((r) => ({ ...r, qtd: n(r.qtd), total: n(r.total), com_nf: n(r.com_nf), com_anexo: n(r.com_anexo) })),
  });
}

export interface ReceivableItem {
  iuli_id: number;
  empresa: string | null;
  description: string | null;
  status: string;
  situacao: "recebido" | "vencido" | "a_vencer";
  due_date: string;
  pagamento: string | null;
  valor: number;
  valor_pago: number | null;
  cliente: string | null;
  tem_nf: boolean;
  entre_empresas: boolean;
}

/** Títulos que vencem no período (ou, com situação "recebido", pagos no período). */
export function useReceivablesList(ws: string | undefined, f: IuliFilters, order: "due_date" | "valor", limit = 50) {
  return useQuery({
    queryKey: ["iuli", "rec_list", ws, f, order, limit],
    enabled: !!ws,
    queryFn: async () => {
      let q = supabase
        .from("iuli_receivables_v")
        .select("iuli_id, empresa, description, status, situacao, due_date, pagamento, valor, valor_pago, cliente, tem_nf, entre_empresas", { count: "exact" })
        .eq("workspace_id", ws!)
        .gte("due_date", f.from)
        .lte("due_date", f.to)
        .order(order, { ascending: order === "due_date" })
        .limit(limit);
      const ids = scopeIds(f);
      if (ids) q = q.in("integration_id", ids);
      if (f.cliente) q = q.ilike("cliente", `%${f.cliente}%`);
      if (f.situacao) q = q.in("situacao", f.situacao);
      if (f.nf) q = q.eq("tem_nf", f.nf === "com");
      if (f.entreEmpresas === "excluir") q = q.eq("entre_empresas", false);
      const { data, error, count } = await q;
      if (error) throw error;
      return {
        rows: (data ?? []).map((r) => ({ ...r, valor: n(r.valor), valor_pago: r.valor_pago == null ? null : n(r.valor_pago) })) as ReceivableItem[],
        count: count ?? 0,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Notas fiscais
// ---------------------------------------------------------------------------

export interface InvoiceAggRow {
  bucket: string | null;
  status: string;
  qtd: number;
  total: number;
}

export function useInvoicesAgg(ws: string | undefined, f: IuliFilters, opts: { range?: { from: string; to: string }; grain?: boolean } = {}) {
  const grain = opts.grain ? f.grain : "none";
  return useQuery({
    queryKey: ["iuli", "inv_agg", ws, f.empresa, f.notaStatus, opts.range ?? [f.from, f.to], grain],
    enabled: !!ws,
    queryFn: async () =>
      (await rpc<InvoiceAggRow>("iuli_invoices_agg", { ...common(ws!, f, opts.range), p_grain: grain, p_status: f.notaStatus })).map((r) => ({
        ...r,
        qtd: n(r.qtd),
        total: n(r.total),
      })),
  });
}

export interface InvoiceItem {
  iuli_id: number;
  empresa: string | null;
  numero: string | null;
  valor: number;
  status: string;
  detalhe_status: string | null;
  venda_id: number | null;
  criada_em: string;
}

export function useInvoicesList(ws: string | undefined, f: IuliFilters, statuses: string[] | null, limit = 30) {
  return useQuery({
    queryKey: ["iuli", "inv_list", ws, f.empresa, f.from, f.to, statuses, limit],
    enabled: !!ws,
    queryFn: async () => {
      let q = supabase
        .from("iuli_invoices_v")
        .select("iuli_id, empresa, numero, valor, status, detalhe_status, venda_id, criada_em", { count: "exact" })
        .eq("workspace_id", ws!)
        .gte("dia", f.from)
        .lte("dia", f.to)
        .order("criada_em", { ascending: false })
        .limit(limit);
      const ids = scopeIds(f);
      if (ids) q = q.in("integration_id", ids);
      if (statuses) q = q.in("status", statuses);
      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: (data ?? []).map((r) => ({ ...r, valor: n(r.valor) })) as InvoiceItem[], count: count ?? 0 };
    },
  });
}

// ---------------------------------------------------------------------------
// Assinaturas
// ---------------------------------------------------------------------------

export interface SubsAggRow {
  bucket: string | null;
  produto: string;
  ciclo: string | null;
  status: string | null;
  qtd: number;
  mensal: number;
  valor: number;
}

export function useSubscriptionsAgg(ws: string | undefined, f: IuliFilters, opts: { period?: boolean; grain?: boolean } = {}) {
  const grain = opts.grain ? f.grain : "none";
  return useQuery({
    queryKey: ["iuli", "subs_agg", ws, f.empresa, f.cliente, f.produto, f.ciclo, f.assinaturaStatus, opts.period ? [f.from, f.to] : null, grain],
    enabled: !!ws,
    queryFn: async () =>
      (
        await rpc<SubsAggRow>("iuli_subscriptions_agg", {
          p_workspace_id: ws,
          p_integration_ids: scopeIds(f),
          p_from: opts.period ? f.from : null,
          p_to: opts.period ? f.to : null,
          p_grain: grain,
          p_cliente: f.cliente,
          p_produto: f.produto,
          p_ciclo: f.ciclo,
          p_status: f.assinaturaStatus,
        })
      ).map((r) => ({ ...r, qtd: n(r.qtd), mensal: n(r.mensal), valor: n(r.valor) })),
  });
}

export interface SubscriptionItem {
  iuli_id: number;
  empresa: string | null;
  cliente: string | null;
  produto: string | null;
  valor: number;
  ciclo: string | null;
  status: string | null;
  criada_em: string;
}

export function useSubscriptionsList(ws: string | undefined, f: IuliFilters, limit = 20) {
  return useQuery({
    queryKey: ["iuli", "subs_list", ws, f.empresa, f.from, f.to, f.cliente, f.produto, f.ciclo, f.assinaturaStatus, limit],
    enabled: !!ws,
    queryFn: async () => {
      let q = supabase
        .from("iuli_subscriptions_v")
        .select("iuli_id, empresa, cliente, produto, valor, ciclo, status, criada_em", { count: "exact" })
        .eq("workspace_id", ws!)
        .gte("dia", f.from)
        .lte("dia", f.to)
        .order("criada_em", { ascending: false })
        .limit(limit);
      const ids = scopeIds(f);
      if (ids) q = q.in("integration_id", ids);
      if (f.cliente) q = q.ilike("cliente", `%${f.cliente}%`);
      if (f.produto) q = q.in("produto", f.produto);
      if (f.ciclo) q = q.in("ciclo", f.ciclo);
      if (f.assinaturaStatus) q = q.in("status", f.assinaturaStatus);
      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: (data ?? []).map((r) => ({ ...r, valor: n(r.valor) })) as SubscriptionItem[], count: count ?? 0 };
    },
  });
}

// ---------------------------------------------------------------------------
// Estado da carga e da conferência (por empresa)
// ---------------------------------------------------------------------------

export interface CompanyLoadStatus {
  integrationId: string;
  initialLoadDone: boolean;
  progress: { task: string; rows: number; total: number | null; done: boolean }[];
  lastRecordsSync: string | null;
  mismatches: { scope: string; period: string; iuli_value: number; local_value: number }[];
  checkedAt: string | null;
  pausedUntil: string | null;
}

export function useIuliLoadStatus(ws: string | undefined) {
  return useQuery({
    queryKey: ["iuli", "load_status", ws],
    enabled: !!ws,
    refetchInterval: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("iuli_sync_state")
        .select("integration_id, task, rows_synced, total_expected, completed_at, next_run_at, cursor, updated_at")
        .eq("workspace_id", ws!);
      if (error) throw error;
      const by = new Map<string, CompanyLoadStatus>();
      for (const r of data ?? []) {
        const s =
          by.get(r.integration_id) ??
          ({ integrationId: r.integration_id, initialLoadDone: false, progress: [], lastRecordsSync: null, mismatches: [], checkedAt: null, pausedUntil: null } as CompanyLoadStatus);
        if (r.task === "__initial_load") s.initialLoadDone = !!r.completed_at;
        else if (r.task === "__consistency") {
          s.mismatches = ((r.cursor as { mismatches?: CompanyLoadStatus["mismatches"] })?.mismatches ?? []).map((m) => ({
            ...m,
            iuli_value: n(m.iuli_value as Num),
            local_value: n(m.local_value as Num),
          }));
          s.checkedAt = r.completed_at;
        } else if (r.task === "__lock") {
          s.pausedUntil = new Date(r.next_run_at).getTime() - Date.now() > 3 * 60_000 ? r.next_run_at : null;
        } else if (r.task.endsWith(":full")) {
          s.progress.push({ task: r.task, rows: n(r.rows_synced), total: r.total_expected, done: !!r.completed_at });
        }
        if (!r.task.startsWith("__") && (!s.lastRecordsSync || r.updated_at > s.lastRecordsSync)) s.lastRecordsSync = r.updated_at;
        by.set(r.integration_id, s);
      }
      return by;
    },
  });
}

export interface CounterpartyRule {
  id: string;
  pattern: string;
  label: string | null;
}

export function useCounterpartyRules(ws: string | undefined) {
  return useQuery({
    queryKey: ["iuli", "counterparty_rules", ws],
    enabled: !!ws,
    queryFn: async () => {
      const { data, error } = await supabase.from("iuli_counterparty_rules").select("id, pattern, label").eq("workspace_id", ws!).order("created_at");
      if (error) throw error;
      return (data ?? []) as CounterpartyRule[];
    },
  });
}

// ---------------------------------------------------------------------------
// Utilitários de agregação no cliente
// ---------------------------------------------------------------------------

export function sumBy<T>(rows: T[] | undefined, pick: (r: T) => number, where: (r: T) => boolean = () => true) {
  return (rows ?? []).filter(where).reduce((a, r) => a + pick(r), 0);
}

/** Lista de buckets contínua entre from/to (pra gráfico sem buracos). */
export function bucketsBetween(from: string, to: string, grain: "day" | "week" | "month"): string[] {
  const out: string[] = [];
  const start = new Date(`${from}T12:00:00Z`);
  if (grain === "week") start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  if (grain === "month") start.setUTCDate(1);
  for (const d = start; d.toISOString().slice(0, 10) <= to; ) {
    out.push(d.toISOString().slice(0, 10));
    if (grain === "day") d.setUTCDate(d.getUTCDate() + 1);
    else if (grain === "week") d.setUTCDate(d.getUTCDate() + 7);
    else d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function bucketLabel(iso: string, grain: "day" | "week" | "month") {
  const [y, m, d] = iso.split("-");
  if (grain === "month") return `${MONTHS[Number(m) - 1]}/${y.slice(2)}`;
  return `${d}/${m}`;
}

// ---------------------------------------------------------------------------
// Notas negadas sem data — a IULI não grava criada_em nelas. Lista: as 100 mais
// recentes de cada empresa (limite da IULI), com a data da venda vinculada.
// Contagem exata: por_status do snapshot invoices:all (todo o histórico).
// ---------------------------------------------------------------------------

export interface UndatedDenied {
  iuli_id: number;
  empresa: string | null;
  valor: number;
  status: string;
  detalhe_status: string | null;
  venda_id: number | null;
  venda_em: string | null;
  cliente: string | null;
}

export function useUndatedDenied(ws: string | undefined, f: Pick<IuliFilters, "empresa">) {
  return useQuery({
    queryKey: ["iuli", "undated_denied", ws, f.empresa],
    enabled: !!ws,
    queryFn: async () => {
      let q = supabase
        .from("iuli_invoices_undated_v")
        .select("iuli_id, empresa, valor, status, detalhe_status, venda_id, venda_em, cliente")
        .eq("workspace_id", ws!)
        .order("venda_em", { ascending: false, nullsFirst: false })
        .limit(300);
      const ids = scopeIds(f);
      if (ids) q = q.in("integration_id", ids);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((r) => ({ ...r, valor: n(r.valor) })) as UndatedDenied[];
    },
  });
}

/** Negadas no histórico inteiro, por empresa (contagem exata informada pela IULI). */
export function useDeniedTotals(ws: string | undefined, f: Pick<IuliFilters, "empresa">) {
  return useQuery({
    queryKey: ["iuli", "denied_totals", ws, f.empresa],
    enabled: !!ws,
    queryFn: async () => {
      let q = supabase.from("iuli_snapshots").select("integration_id, payload").eq("workspace_id", ws!).eq("key", "invoices:all");
      const ids = scopeIds(f);
      if (ids) q = q.in("integration_id", ids);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((r) => ({
        integrationId: r.integration_id as string,
        negadas: ((r.payload?.por_status ?? []) as { status: string; qtd: number }[]).filter((s) => s.status === "negada").reduce((a, s) => a + n(s.qtd), 0),
      }));
    },
  });
}
