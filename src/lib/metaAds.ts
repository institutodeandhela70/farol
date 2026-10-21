import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { usePersistentSearchParams } from "@/lib/iuliPersist";
import { previousRange, useResultFilters, type ResultFilters } from "@/lib/resultFilters";

// Meta Ads (menu Marketing) — lê as funções meta_ads_* (migration 20261022000000).
// Resultados usam um tipo canônico por conversão (a Meta repete a mesma conversão
// sob vários nomes): leads = 'lead', compras = 'purchase', conversas = mensagens iniciadas.

type Num = number | string | null;
const n = (v: Num | undefined) => (v === null || v === undefined ? 0 : Number(v));

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T[]> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return (data ?? []) as T[];
}

export interface Metrics {
  spend: number;
  impressions: number;
  link_clicks: number;
  leads: number;
  purchases: number;
  purchase_value: number;
  conversations: number;
}

const metrics = (r: Record<string, Num>): Metrics => ({
  spend: n(r.spend),
  impressions: n(r.impressions),
  link_clicks: n(r.link_clicks),
  leads: n(r.leads),
  purchases: n(r.purchases),
  purchase_value: n(r.purchase_value),
  conversations: n(r.conversations),
});

/** Razões derivadas — null quando o denominador é zero (a tela mostra "—"). */
export function derive(m: Metrics) {
  const div = (a: number, b: number) => (b > 0 ? a / b : null);
  return {
    cpm: div(m.spend * 1000, m.impressions),
    ctr: div(m.link_clicks, m.impressions),
    cpc: div(m.spend, m.link_clicks),
    cpl: div(m.spend, m.leads),
    cpa: div(m.spend, m.purchases),
    roas: div(m.purchase_value, m.spend),
    cpConversation: div(m.spend, m.conversations),
  };
}

export function ratioChange(now: number | null, prev: number | null): number | null {
  if (now === null || prev === null || prev === 0) return null;
  return (now - prev) / Math.abs(prev);
}

// ---------------------------------------------------------------------------
// Filtros: período (mesmo seletor do menu Resultado) + contas de anúncio (?contas=a,b)
// ---------------------------------------------------------------------------

export function useMetaFilters() {
  const { filters, set } = useResultFilters();
  const [params] = usePersistentSearchParams();
  const raw = params.get("contas");
  const accounts = raw ? raw.split(",").filter(Boolean) : null;
  return { filters, set, accounts };
}

export interface MetaAccount {
  account_id: string;
  name: string | null;
  currency: string | null;
  business_name: string | null;
}

export function useMetaAccounts(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["meta", "accounts", workspaceId],
    enabled: !!workspaceId,
    queryFn: async (): Promise<MetaAccount[]> => {
      const { data, error } = await supabase
        .from("meta_ad_accounts")
        .select("account_id, name, currency, business_name")
        .eq("workspace_id", workspaceId!)
        .eq("enabled", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as MetaAccount[];
    },
  });
}

export interface MetaFreshness {
  /** Dia mais antigo entre os "carregado até" das contas — o painel só é completo até aqui. */
  loadedThrough: string | null;
  accountsTotal: number;
  accountsLoaded: number;
  running: boolean;
}

export function useMetaFreshness(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["meta", "freshness", workspaceId],
    enabled: !!workspaceId,
    refetchInterval: 30_000,
    queryFn: async (): Promise<MetaFreshness> => {
      const [{ data: accs }, { data: state }] = await Promise.all([
        supabase.from("meta_ad_accounts").select("account_id").eq("workspace_id", workspaceId!).eq("enabled", true),
        supabase.from("meta_sync_state").select("account_id, dataset, loaded_through, cursor_date, cycle_started_at").eq("workspace_id", workspaceId!),
      ]);
      const ids = (accs ?? []).map((a) => a.account_id as string);
      const insights = (state ?? []).filter((s) => s.dataset === "insights");
      const loaded = ids.filter((id) => insights.some((s) => s.account_id === id && s.loaded_through && !s.cursor_date));
      const through = loaded.length
        ? insights
            .filter((s) => loaded.includes(s.account_id as string))
            .map((s) => s.loaded_through as string)
            .sort()[0]
        : null;
      return {
        loadedThrough: through,
        accountsTotal: ids.length,
        accountsLoaded: loaded.length,
        running: (state ?? []).some((s) => s.cursor_date || s.cycle_started_at),
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

const keyOf = (name: string, ws: string | undefined, from: string, to: string, accounts: string[] | null, ...rest: unknown[]) =>
  ["meta", name, ws, from, to, accounts?.join(",") ?? "all", ...rest];

export function useMetaTotals(ws: string | undefined, from: string, to: string, accounts: string[] | null) {
  return useQuery({
    queryKey: keyOf("totals", ws, from, to, accounts),
    enabled: !!ws,
    queryFn: async () => {
      const [row] = await rpc<Record<string, Num>>("meta_ads_totals", { p_workspace_id: ws, p_from: from, p_to: to, p_accounts: accounts });
      return { ...metrics(row ?? {}), ads_count: n(row?.ads_count) };
    },
  });
}

export interface DailyPoint extends Metrics {
  day: string;
}

export function useMetaDaily(ws: string | undefined, from: string, to: string, accounts: string[] | null) {
  return useQuery({
    queryKey: keyOf("daily", ws, from, to, accounts),
    enabled: !!ws,
    queryFn: async (): Promise<DailyPoint[]> => {
      const rows = await rpc<Record<string, Num> & { day: string }>("meta_ads_daily", { p_workspace_id: ws, p_from: from, p_to: to, p_accounts: accounts });
      return rows.map((r) => ({ day: r.day as unknown as string, ...metrics(r) }));
    },
  });
}

export type RankingLevel = "campaign" | "adset" | "ad";

export interface RankingRow extends Metrics {
  item_id: string;
  name: string | null;
  status: string | null;
  parent_name: string | null;
  objective: string | null;
  account_id: string | null;
  account_name: string | null;
  thumbnail: string | null;
  first_day: string | null;
  last_day: string | null;
}

export function useMetaRanking(ws: string | undefined, from: string, to: string, accounts: string[] | null, level: RankingLevel, parent: string | null) {
  return useQuery({
    queryKey: keyOf("ranking", ws, from, to, accounts, level, parent),
    enabled: !!ws,
    queryFn: async (): Promise<RankingRow[]> => {
      const rows = await rpc<Record<string, Num | string | null>>("meta_ads_ranking", {
        p_workspace_id: ws,
        p_from: from,
        p_to: to,
        p_accounts: accounts,
        p_level: level,
        p_parent: parent,
      });
      return rows.map((r) => ({
        ...metrics(r as Record<string, Num>),
        item_id: r.item_id as string,
        name: r.name as string | null,
        status: r.status as string | null,
        parent_name: r.parent_name as string | null,
        objective: r.objective as string | null,
        account_id: r.account_id as string | null,
        account_name: r.account_name as string | null,
        thumbnail: r.thumbnail as string | null,
        first_day: r.first_day as string | null,
        last_day: r.last_day as string | null,
      }));
    },
  });
}

export type BreakdownKind = "placement" | "age_gender" | "region";

export interface BreakdownRow extends Metrics {
  key1: string;
  key2: string;
}

export function useMetaBreakdown(ws: string | undefined, from: string, to: string, accounts: string[] | null, kind: BreakdownKind) {
  return useQuery({
    queryKey: keyOf("breakdown", ws, from, to, accounts, kind),
    enabled: !!ws,
    queryFn: async (): Promise<BreakdownRow[]> => {
      const rows = await rpc<Record<string, Num | string>>("meta_ads_breakdown", { p_workspace_id: ws, p_from: from, p_to: to, p_accounts: accounts, p_breakdown: kind });
      return rows.map((r) => ({ ...metrics(r as Record<string, Num>), key1: String(r.key1 ?? ""), key2: String(r.key2 ?? "") }));
    },
  });
}

export interface ActionRow {
  action_type: string;
  qty: number;
  value: number;
}

export function useMetaActions(ws: string | undefined, from: string, to: string, accounts: string[] | null) {
  return useQuery({
    queryKey: keyOf("actions", ws, from, to, accounts),
    enabled: !!ws,
    queryFn: async (): Promise<ActionRow[]> => {
      const rows = await rpc<Record<string, Num | string>>("meta_ads_actions", { p_workspace_id: ws, p_from: from, p_to: to, p_accounts: accounts });
      return rows.map((r) => ({ action_type: String(r.action_type), qty: n(r.qty as Num), value: n(r.value as Num) }));
    },
  });
}

/** Período anterior de mesmo tamanho (pra comparar os KPIs). */
export function previousPeriod(f: Pick<ResultFilters, "from" | "to">) {
  return previousRange(f.from, f.to);
}

// ---------------------------------------------------------------------------
// Rótulos
// ---------------------------------------------------------------------------

export const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Ativa",
  PAUSED: "Pausada",
  ARCHIVED: "Arquivada",
  CAMPAIGN_PAUSED: "Campanha pausada",
  ADSET_PAUSED: "Conjunto pausado",
  IN_PROCESS: "Em processamento",
  WITH_ISSUES: "Com problemas",
  DISAPPROVED: "Reprovada",
  PENDING_REVIEW: "Em análise",
  PREAPPROVED: "Pré-aprovada",
  PENDING_BILLING_INFO: "Pendente de pagamento",
};

export const OBJECTIVE_LABEL: Record<string, string> = {
  OUTCOME_LEADS: "Leads",
  OUTCOME_SALES: "Vendas",
  OUTCOME_TRAFFIC: "Tráfego",
  OUTCOME_ENGAGEMENT: "Engajamento",
  OUTCOME_AWARENESS: "Reconhecimento",
  OUTCOME_APP_PROMOTION: "App",
  LINK_CLICKS: "Cliques no link",
  CONVERSIONS: "Conversões",
  VIDEO_VIEWS: "Visualizações de vídeo",
  REACH: "Alcance",
  POST_ENGAGEMENT: "Engajamento no post",
  MESSAGES: "Mensagens",
  BRAND_AWARENESS: "Reconhecimento de marca",
  LEAD_GENERATION: "Geração de leads",
};

export const PLATFORM_LABEL: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  audience_network: "Audience Network",
  messenger: "Messenger",
  threads: "Threads",
  whatsapp: "WhatsApp",
  unknown: "Desconhecido",
};

export const POSITION_LABEL: Record<string, string> = {
  feed: "Feed",
  instagram_stories: "Stories",
  instagram_reels: "Reels",
  instagram_explore: "Explorar",
  instagram_explore_grid_home: "Explorar (home)",
  instagram_profile_feed: "Feed do perfil",
  instagram_search: "Busca",
  instagram_shop: "Shop",
  facebook_reels: "Reels",
  facebook_stories: "Stories",
  facebook_reels_overlay: "Reels (overlay)",
  right_hand_column: "Coluna da direita",
  marketplace: "Marketplace",
  video_feeds: "Feeds de vídeo",
  search: "Busca",
  story: "Stories",
  an_classic: "Audience Network",
  instream_video: "In-stream",
  rewarded_video: "Vídeo premiado",
  unknown: "Desconhecido",
};

export const GENDER_LABEL: Record<string, string> = { female: "Feminino", male: "Masculino", unknown: "Não informado" };
