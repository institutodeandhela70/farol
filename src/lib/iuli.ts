import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { addMonths, currentYM } from "@/lib/commercial";

// Dashboard Financeiro IULI — as telas nunca chamam a IULI ao vivo (ela só
// aceita uma consulta por vez por empresa e limita o volume). A edge function
// sync-iuli grava cada consulta como um snapshot em iuli_snapshots; aqui só
// lemos esses snapshots. Chaves: ver buildPlan() em supabase/functions/sync-iuli.

export interface IuliSnapshot<T = unknown> {
  key: string;
  tool: string;
  args: Record<string, unknown>;
  payload: T | null;
  error: string | null;
  fetched_at: string | null;
  expires_at: string;
}

export interface IuliIntegration {
  id: string;
  label: string | null;
  status: "disconnected" | "connected" | "error";
  last_synced_at: string | null;
  last_error: string | null;
  config: { tools?: string[] } | null;
}

/** true/false se o token da empresa libera a função; null se ainda não sabemos. */
export function companyHasTool(company: IuliIntegration | null | undefined, tool: string): boolean | null {
  const tools = company?.config?.tools;
  return Array.isArray(tools) ? tools.includes(tool) : null;
}

/** Empresas IULI conectadas (uma integração por empresa, cada uma com seu token). */
export function useIuliCompanies(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["iuli", "companies", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("integrations")
        .select("id, label, status, last_synced_at, last_error, config")
        .eq("workspace_id", workspaceId!)
        .eq("provider", "iuli")
        .order("created_at");
      if (error) throw error;
      return data as IuliIntegration[];
    },
  });
}

/**
 * Empresa selecionada no dashboard (fica na URL como ?empresa=<id>, então um
 * link abre na empresa certa). Sem seleção, a primeira conectada.
 */
export function useIuliSelectedCompany(workspaceId: string | undefined) {
  const [params, setParams] = useSearchParams();
  const companies = useIuliCompanies(workspaceId);
  const wanted = params.get("empresa");
  const selected = companies.data?.find((c) => c.id === wanted) ?? companies.data?.[0] ?? null;
  const select = (id: string) => {
    const next = new URLSearchParams(params);
    next.set("empresa", id);
    setParams(next, { replace: true });
  };
  return { companies: companies.data ?? [], isLoading: companies.isLoading, selected, select };
}

/** Integração (empresa) em foco no dashboard. */
export function useIuliIntegration(workspaceId: string | undefined) {
  const { selected, isLoading } = useIuliSelectedCompany(workspaceId);
  return { data: selected, isLoading };
}

export function useIuliSnapshots(workspaceId: string | undefined) {
  const { selected } = useIuliSelectedCompany(workspaceId);
  const integrationId = selected?.id;
  return useQuery({
    queryKey: ["iuli", "snapshots", workspaceId, integrationId],
    enabled: !!workspaceId && !!integrationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("iuli_snapshots")
        .select("key, tool, args, payload, error, fetched_at, expires_at")
        .eq("workspace_id", workspaceId!)
        .eq("integration_id", integrationId!);
      if (error) throw error;
      return new Map((data as IuliSnapshot[]).map((s) => [s.key, s]));
    },
  });
}

/** Payload de um snapshot, ou null se ainda não foi buscado. */
export function snap<T>(map: Map<string, IuliSnapshot> | undefined, key: string): T | null {
  return (map?.get(key)?.payload as T | undefined) ?? null;
}

/** Snapshot buscado mais antigo entre as chaves — "dados de até X atrás". */
export function oldestFetch(map: Map<string, IuliSnapshot> | undefined, keys: string[]): string | null {
  const dates = keys.map((k) => map?.get(k)?.fetched_at).filter((d): d is string => !!d);
  return dates.length ? dates.sort()[0] : null;
}

/**
 * "Atualizar agora": pra cada empresa, relê as janelas recentes (vendas,
 * títulos, notas, assinaturas — sync-iuli-records com force_recent) e depois os
 * totais oficiais (sync-iuli, usados na conferência e em Cadastros). Uma
 * empresa por vez; cada chamada tem ~100s de orçamento.
 */
export function useIuliRefresh(workspaceId: string | undefined, integrationIds: string[]) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      let busy = false;
      let pausedUntil: string | null = null;
      for (const id of integrationIds) {
        for (const [fn, body] of [
          ["sync-iuli-records", { integration_id: id, force_recent: true }],
          ["sync-iuli", { integration_id: id }],
        ] as const) {
          const { data, error } = await supabase.functions.invoke(fn, { body });
          if (error) throw error;
          if (data?.error) throw new Error(data.error);
          if (data?.busy) busy = true;
          if (data?.paused_until) pausedUntil = data.paused_until;
        }
      }
      return { busy, pausedUntil };
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["iuli"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Meses — o sync guarda 13 meses de vendas/notas (atual + 12) e contas a
// receber de -12 a +6 meses pelo vencimento
// ---------------------------------------------------------------------------

export function lastMonths(count: number, end = currentYM()): string[] {
  return Array.from({ length: count }, (_, i) => addMonths(end, i - count + 1));
}

// ---------------------------------------------------------------------------
// Vendas
// ---------------------------------------------------------------------------

export interface SalesSummary {
  total_vendas: number;
  quantidade: number;
  ticket_medio: number;
  top_produtos: { produto: string; total: number; qty: number }[];
  top_clientes: { client_id: number; cliente: string; total: number; qty: number }[];
}

export interface StatusCount {
  status: string;
  qtd: number;
  total?: number;
}

export interface SalesStatus {
  por_status: StatusCount[];
  total_encontrado: number;
}

export type SaleGroup = "efetiva" | "aberta" | "perdida";

export const SALE_STATUS: Record<string, { label: string; group: SaleGroup }> = {
  concluida: { label: "Concluída", group: "efetiva" },
  aprovada: { label: "Aprovada", group: "efetiva" },
  iniciada: { label: "Iniciada", group: "aberta" },
  boleto_gerado: { label: "Boleto gerado", group: "aberta" },
  aguardando_pagamento: { label: "Aguardando pagamento", group: "aberta" },
  em_analise: { label: "Em análise", group: "aberta" },
  cancelada: { label: "Cancelada", group: "perdida" },
  reembolsada: { label: "Reembolsada", group: "perdida" },
  chargeback: { label: "Chargeback", group: "perdida" },
  expirada: { label: "Expirada", group: "perdida" },
};

export const SALE_GROUP_LABEL: Record<SaleGroup, string> = {
  efetiva: "Efetivas",
  aberta: "Em aberto",
  perdida: "Perdidas",
};

export function saleGroupOf(status: string): SaleGroup {
  return SALE_STATUS[status]?.group ?? "aberta";
}

export function groupSales(rows: StatusCount[] | undefined) {
  const out: Record<SaleGroup, { qtd: number; total: number }> = {
    efetiva: { qtd: 0, total: 0 },
    aberta: { qtd: 0, total: 0 },
    perdida: { qtd: 0, total: 0 },
  };
  for (const r of rows ?? []) {
    const g = out[saleGroupOf(r.status)];
    g.qtd += r.qtd;
    g.total += r.total ?? 0;
  }
  return out;
}

/** Soma por status de vários meses (list_sales.por_status). */
export function mergeStatus(list: (StatusCount[] | undefined)[]): StatusCount[] {
  const map = new Map<string, StatusCount>();
  for (const rows of list) {
    for (const r of rows ?? []) {
      const cur = map.get(r.status) ?? { status: r.status, qtd: 0, total: 0 };
      cur.qtd += r.qtd;
      cur.total = (cur.total ?? 0) + (r.total ?? 0);
      map.set(r.status, cur);
    }
  }
  return [...map.values()].sort((a, b) => (b.total ?? b.qtd) - (a.total ?? a.qtd));
}

// ---------------------------------------------------------------------------
// Contas a receber
// ---------------------------------------------------------------------------

export interface Receivable {
  total_a_receber: number;
  quantidade: number;
  total_vencidas: number;
  qtd_vencidas: number;
  total_recebidas: number;
  qtd_recebidas: number;
  total_juros: number;
  soma_valores_recebidas?: { previsto: number; efetivo: number; juros_acrescimos: number; descontos_pagamentos_parciais: number };
  cobertura_documental?: {
    titulos: number;
    com_anexo: number;
    sem_anexo: number;
    com_nota_fiscal: number;
    sem_nota_fiscal: number;
    com_boleto: number;
    com_comprovante: number;
  };
  itens?: {
    id: number;
    description: string | null;
    status: string;
    due_date: string;
    competencia: string | null;
    valor: number;
    empresa: string | null;
    tem_nf: boolean;
  }[];
}

export const AGING_BUCKETS: { key: string; label: string; overdue: boolean }[] = [
  { key: "vencido_365_mais", label: "Vencido há +1 ano", overdue: true },
  { key: "vencido_181_365", label: "Vencido 181–365 dias", overdue: true },
  { key: "vencido_91_180", label: "Vencido 91–180 dias", overdue: true },
  { key: "vencido_31_90", label: "Vencido 31–90 dias", overdue: true },
  { key: "vencido_1_30", label: "Vencido 1–30 dias", overdue: true },
  { key: "a_vencer_0_30", label: "Vence em até 30 dias", overdue: false },
  { key: "a_vencer_31_90", label: "Vence em 31–90 dias", overdue: false },
  { key: "a_vencer_91_180", label: "Vence em 91–180 dias", overdue: false },
  { key: "a_vencer_180_mais", label: "Vence em +180 dias", overdue: false },
];

// ---------------------------------------------------------------------------
// Notas fiscais
// ---------------------------------------------------------------------------

export interface Invoices {
  por_status: StatusCount[];
  itens?: {
    id: number;
    numero: string | null;
    valor: number;
    status: string;
    detalhe_status: string | null;
    venda_id: number | null;
    criada_em: string;
  }[];
}

export const INVOICE_STATUS: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "neutral" }> = {
  autorizada: { label: "Autorizada", tone: "ok" },
  processando: { label: "Processando", tone: "neutral" },
  externa: { label: "Externa", tone: "neutral" },
  negada: { label: "Negada", tone: "bad" },
  cancelada: { label: "Cancelada", tone: "neutral" },
  solicitando_cancelamento: { label: "Solicitando cancelamento", tone: "warn" },
  cancelamento_negado: { label: "Cancelamento negado", tone: "bad" },
};

export function invoiceLabel(status: string) {
  return INVOICE_STATUS[status]?.label ?? status;
}

// ---------------------------------------------------------------------------
// Assinaturas (agregado pelo sync — paginou todas)
// ---------------------------------------------------------------------------

export interface SubscriptionGroup {
  key: string;
  qtd: number;
  valor_mensalizado: number;
  valor: number;
}

export interface Subscriptions {
  por_status: { status: string; qtd: number; valor_contratado_total: number; mrr: number }[];
  total_encontrado: number;
  por_produto: SubscriptionGroup[];
  por_ciclo: SubscriptionGroup[];
  por_forma_pagamento: SubscriptionGroup[];
  por_origem: SubscriptionGroup[];
  por_status_item: SubscriptionGroup[];
  por_mes_criacao: SubscriptionGroup[];
  recentes: { id: number; cliente: string; produto: string; valor: number; ciclo: string; status: string; criada_em: string }[];
}

export const CYCLE_LABEL: Record<string, string> = {
  WEEKLY: "Semanal",
  BIWEEKLY: "Quinzenal",
  MONTHLY: "Mensal",
  BIMONTHLY: "Bimestral",
  QUARTERLY: "Trimestral",
  SEMIANNUALLY: "Semestral",
  YEARLY: "Anual",
};

export const SUBSCRIPTION_STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Ativa",
  CANCELED: "Cancelada",
  "1": "Status \"1\" (não padronizado)",
};

// ---------------------------------------------------------------------------
// Cadastros
// ---------------------------------------------------------------------------

export interface Project {
  id: number;
  nome: string;
  sigla: string | null;
  descricao: string | null;
  inicio: string | null;
  fim: string | null;
  situacao: "planejado" | "em_andamento" | "encerrado" | "cancelado";
  arquivado: number;
  receita_orcada: number;
  despesa_orcada: number;
  cliente: string | null;
  familia: string | null;
  confiavel: number;
}

export const PROJECT_STATUS_LABEL: Record<Project["situacao"], string> = {
  planejado: "Planejado",
  em_andamento: "Em andamento",
  encerrado: "Encerrado",
  cancelado: "Cancelado",
};

export interface CostCenter {
  id: number;
  nome: string;
  sigla: string | null;
  descricao: string | null;
  situacao: "ativo" | "inativo";
}

export interface Product {
  id: number;
  codigo: string | null;
  nome: string;
  preco: number;
  product_type: number;
}

export interface Charges {
  por_status: StatusCount[];
  itens: unknown[];
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}
