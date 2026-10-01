import { useCallback, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Meses (sempre no fuso de São Paulo — sem horário de verão desde 2019, -03:00)
// ---------------------------------------------------------------------------

export function currentYM(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" })
    .formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  return `${y}-${m}`;
}

export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let ym = from; ym <= to; ym = addMonths(ym, 1)) out.push(ym);
  return out;
}

export function monthStartISO(ym: string): string {
  return new Date(`${ym}-01T00:00:00-03:00`).toISOString();
}

export function monthEndISO(ym: string): string {
  return new Date(new Date(`${addMonths(ym, 1)}-01T00:00:00-03:00`).getTime() - 1).toISOString();
}

/** Quantos dias tem o mês (considerando ano bissexto). */
export function daysInMonth(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

export function daysOfMonth(ym: string): string[] {
  const total = daysInMonth(ym);
  return Array.from({ length: total }, (_, i) => `${ym}-${String(i + 1).padStart(2, "0")}`);
}

export function dayLabel(isoDay: string): string {
  const [, , d] = isoDay.split("-");
  return String(Number(d));
}

export function dayStartISO(day: string): string {
  return new Date(`${day}T00:00:00-03:00`).toISOString();
}

export function dayEndISO(day: string): string {
  return new Date(new Date(`${day}T00:00:00-03:00`).getTime() + 24 * 60 * 60 * 1000 - 1).toISOString();
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function dayLabelLong(isoDay: string): string {
  const [y, m, d] = isoDay.split("-").map(Number);
  return `${String(d).padStart(2, "0")}/${MONTH_SHORT[m - 1]}/${String(y).slice(2)}`;
}

const MONTH_SHORT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const MONTH_LONG = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

export function monthLabel(ym: string, long = false): string {
  const [y, m] = ym.split("-").map(Number);
  return long ? `${MONTH_LONG[m - 1]} ${y}` : `${MONTH_SHORT[m - 1]}/${String(y).slice(2)}`;
}

/** "2026-09-01" (date do Postgres) → "2026-09" */
export function ymOf(date: string): string {
  return date.slice(0, 7);
}

export function periodLabel(from: string, to: string): string {
  return from === to ? monthLabel(from, true) : `${monthLabel(from)} a ${monthLabel(to)}`;
}

// ---------------------------------------------------------------------------
// Formatação
// ---------------------------------------------------------------------------

export function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

export function formatBRLShort(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `R$ ${(value / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi`;
  if (abs >= 1_000) return `R$ ${(value / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil`;
  return formatBRL(value);
}

export function formatInt(value: number): string {
  return value.toLocaleString("pt-BR");
}

export function formatPct(ratio: number | null, digits = 0): string {
  if (ratio === null || !Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toLocaleString("pt-BR", { maximumFractionDigits: digits })}%`;
}

/** Variação percentual; null quando não há base de comparação. */
export function delta(current: number, previous: number): number | null {
  if (!previous) return null;
  return (current - previous) / previous;
}

export const NO_OWNER = "(sem proprietário)";

// ---------------------------------------------------------------------------
// Filtros — ficam na URL, então um link já abre filtrado
// ---------------------------------------------------------------------------

export type Attribution = "owner" | "closer";
export type DateBasis = "created" | "meeting";

export interface CommercialFilters {
  from: string;
  to: string;
  /** Recorte exato por dia (opcional) — quando presente, tem prioridade sobre from/to (mês) para consultas. from/to continuam refletindo os meses que o recorte cobre. */
  fromDay: string | null;
  toDay: string | null;
  owner: string | null;
  pipelines: string[] | null;
  attribution: Attribution;
  activityTypes: string[] | null;
}

// Persistência entre telas: o filtro fica na URL (pra um link já abrir filtrado),
// mas também salva no localStorage — assim, ao navegar pra outra tela do Comercial
// por um link "seco" (sem querystring, ex.: menu lateral), o filtro anterior volta
// sozinho em vez de resetar pro padrão. Se a URL já tem algum parâmetro de filtro
// explícito, ela manda (link compartilhado/bookmarkado vale mais que o que tava salvo).
const STORAGE_KEY = "farol.comercial.filters";

interface StoredFilters {
  from?: string;
  to?: string;
  fromDay?: string | null;
  toDay?: string | null;
  owner?: string | null;
  pipelines?: string[] | null;
  attribution?: Attribution;
  activityTypes?: string[] | null;
}

function readStoredFilters(): StoredFilters {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeStoredFilters(f: StoredFilters) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(f));
  } catch {
    // localStorage indisponível (modo privado, quota, etc.) — segue sem persistir.
  }
}

const FILTER_PARAM_KEYS = ["de", "ate", "deDia", "ateDia", "vendedor", "pipelines", "atrib", "tipos"];

export function useCommercialFilters() {
  const [params, setParams] = useSearchParams();
  const hasAnyParam = FILTER_PARAM_KEYS.some((k) => params.has(k));

  const filters = useMemo<CommercialFilters>(() => {
    const stored = hasAnyParam ? {} : readStoredFilters();
    const now = currentYM();
    const from = params.get("de") ?? stored.from ?? now;
    const to = params.get("ate") ?? stored.to ?? from;
    const fromDay = params.get("deDia") ?? stored.fromDay ?? null;
    const toDay = params.get("ateDia") ?? stored.toDay ?? null;
    const list = (key: string, storedVal: string[] | null | undefined) => {
      const v = params.get(key);
      if (v) return v.split(",").filter(Boolean);
      return hasAnyParam ? null : (storedVal ?? null);
    };
    return {
      from: from <= to ? from : to,
      to: from <= to ? to : from,
      fromDay: fromDay && toDay ? (fromDay <= toDay ? fromDay : toDay) : null,
      toDay: fromDay && toDay ? (fromDay <= toDay ? toDay : fromDay) : null,
      owner: params.get("vendedor") ?? (hasAnyParam ? null : (stored.owner ?? null)),
      pipelines: list("pipelines", stored.pipelines),
      attribution: (params.get("atrib") === "closer" ? "closer" : hasAnyParam ? "owner" : (stored.attribution ?? "owner")),
      activityTypes: list("tipos", stored.activityTypes),
    };
  }, [params, hasAnyParam]);

  // Na primeira carga de uma tela sem nenhum parâmetro na URL, reflete o que veio
  // do localStorage na barra de endereço — mantém URL e estado salvo consistentes.
  useEffect(() => {
    if (hasAnyParam) return;
    const stored = readStoredFilters();
    const hasStored = stored.from || stored.owner || stored.pipelines?.length || stored.attribution || stored.activityTypes?.length;
    if (!hasStored) return;
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (stored.from) next.set("de", stored.from);
        if (stored.to) next.set("ate", stored.to);
        if (stored.fromDay) next.set("deDia", stored.fromDay);
        if (stored.toDay) next.set("ateDia", stored.toDay);
        if (stored.owner) next.set("vendedor", stored.owner);
        if (stored.pipelines?.length) next.set("pipelines", stored.pipelines.join(","));
        if (stored.attribution === "closer") next.set("atrib", "closer");
        if (stored.activityTypes?.length) next.set("tipos", stored.activityTypes.join(","));
        return next;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setFilters = useCallback(
    (patch: Partial<CommercialFilters>) => {
      const merged: StoredFilters = {
        from: patch.from ?? filters.from,
        to: patch.to ?? filters.to,
        fromDay: "fromDay" in patch ? patch.fromDay : filters.fromDay,
        toDay: "toDay" in patch ? patch.toDay : filters.toDay,
        owner: "owner" in patch ? patch.owner : filters.owner,
        pipelines: "pipelines" in patch ? patch.pipelines : filters.pipelines,
        attribution: patch.attribution ?? filters.attribution,
        activityTypes: "activityTypes" in patch ? patch.activityTypes : filters.activityTypes,
      };
      writeStoredFilters(merged);

      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          const put = (key: string, value: string | null) => (value ? next.set(key, value) : next.delete(key));
          if ("from" in patch) put("de", patch.from ?? null);
          if ("to" in patch) put("ate", patch.to ?? null);
          if ("fromDay" in patch) put("deDia", patch.fromDay ?? null);
          if ("toDay" in patch) put("ateDia", patch.toDay ?? null);
          if ("owner" in patch) put("vendedor", patch.owner ?? null);
          if ("pipelines" in patch) put("pipelines", patch.pipelines?.length ? patch.pipelines.join(",") : null);
          if ("attribution" in patch) put("atrib", patch.attribution === "closer" ? "closer" : null);
          if ("activityTypes" in patch) put("tipos", patch.activityTypes?.length ? patch.activityTypes.join(",") : null);
          return next;
        },
        { replace: true },
      );
    },
    [setParams, filters],
  );

  return { filters, setFilters };
}

/** Início do período em ISO — usa o recorte por dia quando presente, senão o mês inteiro. */
export function periodStartISO(f: Pick<CommercialFilters, "from" | "fromDay">): string {
  return f.fromDay ? dayStartISO(f.fromDay) : monthStartISO(f.from);
}

export function periodEndISO(f: Pick<CommercialFilters, "to" | "toDay">): string {
  return f.toDay ? dayEndISO(f.toDay) : monthEndISO(f.to);
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T[]> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return (data ?? []) as T[];
}

// bigint/numeric chegam como number ou string dependendo do tamanho — normaliza.
function num<T extends object>(rows: T[], keys: (keyof T)[]): T[] {
  return rows.map((r) => {
    const out = { ...r };
    for (const k of keys) (out as Record<keyof T, unknown>)[k] = Number(r[k] ?? 0);
    return out;
  });
}

export interface ClosingRow {
  month: string;
  owner_id: string;
  won_count: number;
  won_amount: number;
  lost_count: number;
  lost_amount: number;
}

export function useClosing(workspaceId: string | undefined, from: string, to: string, f: CommercialFilters) {
  return useQuery({
    queryKey: ["commercial", "closing", workspaceId, from, to, f.attribution, f.pipelines],
    enabled: !!workspaceId,
    queryFn: async () =>
      num(
        await rpc<ClosingRow>("commercial_monthly_closing", {
          p_workspace_id: workspaceId,
          p_start_date: monthStartISO(from),
          p_end_date: monthEndISO(to),
          p_attribution: f.attribution,
          p_pipeline_ids: f.pipelines,
        }),
        ["won_count", "won_amount", "lost_count", "lost_amount"],
      ).map((r) => ({ ...r, month: ymOf(r.month) })),
  });
}

export interface DailyClosingRow {
  day: string;
  owner_id: string;
  won_count: number;
  won_amount: number;
  lost_count: number;
  lost_amount: number;
}

/** Fechamento dia a dia entre duas datas exatas (usado no gráfico "Fechamento diário"). */
export function useDailyClosing(workspaceId: string | undefined, startISO: string, endISO: string, f: Pick<CommercialFilters, "attribution" | "pipelines">) {
  return useQuery({
    queryKey: ["commercial", "daily-closing", workspaceId, startISO, endISO, f.attribution, f.pipelines],
    enabled: !!workspaceId,
    queryFn: async () =>
      num(
        await rpc<DailyClosingRow>("commercial_daily_closing", {
          p_workspace_id: workspaceId,
          p_start_date: startISO,
          p_end_date: endISO,
          p_attribution: f.attribution,
          p_pipeline_ids: f.pipelines,
        }),
        ["won_count", "won_amount", "lost_count", "lost_amount"],
      ),
  });
}

/** Fechamento agregado (com detalhe por dono) para um intervalo exato — usado pros KPIs
 * do período atual/anterior quando um recorte por dia está ativo. Mesma RPC de useClosing,
 * mas recebe as datas já prontas em vez de derivar de um mês. */
export function useClosingRange(workspaceId: string | undefined, startISO: string, endISO: string, f: Pick<CommercialFilters, "attribution" | "pipelines">) {
  return useQuery({
    queryKey: ["commercial", "closing-range", workspaceId, startISO, endISO, f.attribution, f.pipelines],
    enabled: !!workspaceId,
    queryFn: async () =>
      num(
        await rpc<ClosingRow>("commercial_monthly_closing", {
          p_workspace_id: workspaceId,
          p_start_date: startISO,
          p_end_date: endISO,
          p_attribution: f.attribution,
          p_pipeline_ids: f.pipelines,
        }),
        ["won_count", "won_amount", "lost_count", "lost_amount"],
      ).map((r) => ({ ...r, month: ymOf(r.month) })),
  });
}

export interface CustomerRow {
  contact_id: string;
  customer_name: string;
  customer_email: string | null;
  owner_id: string;
  produto: string;
  deal_count: number;
  total_amount: number;
}

/** "Visão por cliente": quanto cada cliente pagou e o que comprou, no período. */
export function useCustomers(workspaceId: string | undefined, startISO: string, endISO: string, f: Pick<CommercialFilters, "attribution" | "pipelines">) {
  return useQuery({
    queryKey: ["commercial", "customers", workspaceId, startISO, endISO, f.attribution, f.pipelines],
    enabled: !!workspaceId,
    queryFn: async () =>
      num(
        await rpc<CustomerRow>("commercial_customers", {
          p_workspace_id: workspaceId,
          p_start_date: startISO,
          p_end_date: endISO,
          p_attribution: f.attribution,
          p_pipeline_ids: f.pipelines,
        }),
        ["deal_count", "total_amount"],
      ),
  });
}

export interface MeetingsMonthRow {
  month: string;
  total_count: number;
  past_count: number;
  completed_count: number;
  no_show_count: number;
  rescheduled_count: number;
  canceled_count: number;
  unrecorded_count: number;
}

export function useMeetingsMonthly(workspaceId: string | undefined, from: string, to: string, types: string[] | null) {
  return useQuery({
    queryKey: ["commercial", "meetings-monthly", workspaceId, from, to, types],
    enabled: !!workspaceId,
    queryFn: async () =>
      num(
        await rpc<MeetingsMonthRow>("commercial_meetings_monthly", {
          p_workspace_id: workspaceId,
          p_start_date: monthStartISO(from),
          p_end_date: monthEndISO(to),
          p_activity_types: types,
        }),
        ["total_count", "past_count", "completed_count", "no_show_count", "rescheduled_count", "canceled_count", "unrecorded_count"],
      ).map((r) => ({ ...r, month: ymOf(r.month) })),
  });
}

export interface MeetingOutcomeCounts {
  total_count: number;
  past_count: number;
  upcoming_count: number;
  completed_count: number;
  no_show_count: number;
  rescheduled_count: number;
  canceled_count: number;
  unrecorded_count: number;
}

const OUTCOME_KEYS: (keyof MeetingOutcomeCounts)[] = [
  "total_count", "past_count", "upcoming_count", "completed_count", "no_show_count", "rescheduled_count", "canceled_count", "unrecorded_count",
];

export interface ConductorRow extends MeetingOutcomeCounts {
  owner_id: string;
}

export function useMeetingsByConductor(workspaceId: string | undefined, f: CommercialFilters) {
  return useQuery({
    queryKey: ["commercial", "conductor", workspaceId, f.from, f.to, f.fromDay, f.toDay, f.activityTypes],
    enabled: !!workspaceId,
    queryFn: async () =>
      num(
        await rpc<ConductorRow>("commercial_meetings_by_conductor", {
          p_workspace_id: workspaceId,
          p_start_date: periodStartISO(f),
          p_end_date: periodEndISO(f),
          p_activity_types: f.activityTypes,
        }),
        OUTCOME_KEYS,
      ),
  });
}

export interface SchedulerRow extends MeetingOutcomeCounts {
  scheduler_user_id: string;
  scheduler_owner_id: string | null;
  for_others_count: number;
}

export function useMeetingsByScheduler(workspaceId: string | undefined, f: CommercialFilters, basis: DateBasis) {
  return useQuery({
    queryKey: ["commercial", "scheduler", workspaceId, f.from, f.to, f.fromDay, f.toDay, f.activityTypes, basis],
    enabled: !!workspaceId,
    queryFn: async () =>
      num(
        await rpc<SchedulerRow>("commercial_meetings_by_scheduler", {
          p_workspace_id: workspaceId,
          p_start_date: periodStartISO(f),
          p_end_date: periodEndISO(f),
          p_date_basis: basis,
          p_activity_types: f.activityTypes,
        }),
        [...OUTCOME_KEYS, "for_others_count"],
      ),
  });
}

export interface OpenPipelineRow {
  pipeline_id: string;
  stage_id: string;
  owner_id: string;
  close_month: string | null;
  open_count: number;
  open_amount: number;
  weighted_amount: number;
  without_amount_count: number;
}

export function useOpenPipeline(workspaceId: string | undefined, f: CommercialFilters) {
  return useQuery({
    queryKey: ["commercial", "open", workspaceId, f.attribution, f.pipelines],
    enabled: !!workspaceId,
    queryFn: async () =>
      num(
        await rpc<OpenPipelineRow>("commercial_open_pipeline", {
          p_workspace_id: workspaceId,
          p_attribution: f.attribution,
          p_pipeline_ids: f.pipelines,
        }),
        ["open_count", "open_amount", "weighted_amount", "without_amount_count"],
      ).map((r) => ({ ...r, close_month: r.close_month ? ymOf(r.close_month) : null })),
  });
}

export interface GoalRow {
  id: string;
  owner_id: string;
  month: string;
  revenue_target: number | null;
  deals_target: number | null;
  meetings_held_target: number | null;
  meetings_scheduled_target: number | null;
}

export function useGoals(workspaceId: string | undefined, from: string, to: string) {
  return useQuery({
    queryKey: ["commercial", "goals", workspaceId, from, to],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("commercial_goals")
        .select("id, owner_id, month, revenue_target, deals_target, meetings_held_target, meetings_scheduled_target")
        .eq("workspace_id", workspaceId!)
        .gte("month", `${from}-01`)
        .lte("month", `${to}-01`);
      if (error) throw error;
      return (data ?? []).map((g) => ({
        ...g,
        month: ymOf(g.month),
        revenue_target: g.revenue_target === null ? null : Number(g.revenue_target),
      })) as GoalRow[];
    },
  });
}

export interface SalesPipeline {
  id: string;
  label: string;
  countsAsSales: boolean;
}

export function useSalesPipelines(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["commercial", "pipelines", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const [pipes, settings] = await Promise.all([
        supabase.from("hubspot_pipelines").select("pipeline_id, label, display_order").eq("workspace_id", workspaceId!).order("display_order"),
        supabase.from("commercial_pipeline_settings").select("pipeline_id, counts_as_sales").eq("workspace_id", workspaceId!),
      ]);
      if (pipes.error) throw pipes.error;
      const excluded = new Set((settings.data ?? []).filter((s) => !s.counts_as_sales).map((s) => s.pipeline_id));
      return (pipes.data ?? []).map((p) => ({ id: p.pipeline_id, label: p.label, countsAsSales: !excluded.has(p.pipeline_id) })) as SalesPipeline[];
    },
  });
}

export function useMeetingTypes(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["commercial", "meeting-types", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data } = await supabase
        .from("hubspot_property_defs")
        .select("options")
        .eq("workspace_id", workspaceId!)
        .eq("object_type", "meetings")
        .eq("name", "hs_activity_type")
        .maybeSingle();
      const options = (data?.options ?? []) as { label: string; value: string; hidden?: boolean }[];
      return options.filter((o) => !o.hidden).map((o) => ({ value: o.value, label: o.label }));
    },
  });
}

// ---------------------------------------------------------------------------
// Agregações de apoio
// ---------------------------------------------------------------------------

export function sumBy<T>(rows: T[], pick: (r: T) => number): number {
  return rows.reduce((acc, r) => acc + pick(r), 0);
}

export interface SellerClosing {
  owner_id: string;
  won_count: number;
  won_amount: number;
  lost_count: number;
}

export function closingBySeller(rows: ClosingRow[]): SellerClosing[] {
  const map = new Map<string, SellerClosing>();
  for (const r of rows) {
    const cur = map.get(r.owner_id) ?? { owner_id: r.owner_id, won_count: 0, won_amount: 0, lost_count: 0 };
    cur.won_count += r.won_count;
    cur.won_amount += r.won_amount;
    cur.lost_count += r.lost_count;
    map.set(r.owner_id, cur);
  }
  return [...map.values()].sort((a, b) => b.won_amount - a.won_amount);
}

export interface GoalTotals {
  revenue: number | null;
  deals: number | null;
  held: number | null;
  scheduled: number | null;
}

/** Soma das metas do período por vendedor (um período de vários meses soma as metas mensais). */
export function goalsByOwner(goals: GoalRow[]): Map<string, GoalTotals> {
  const map = new Map<string, GoalTotals>();
  const add = (a: number | null, b: number | null) => (b === null ? a : (a ?? 0) + Number(b));
  for (const g of goals) {
    const cur = map.get(g.owner_id) ?? { revenue: null, deals: null, held: null, scheduled: null };
    map.set(g.owner_id, {
      revenue: add(cur.revenue, g.revenue_target),
      deals: add(cur.deals, g.deals_target),
      held: add(cur.held, g.meetings_held_target),
      scheduled: add(cur.scheduled, g.meetings_scheduled_target),
    });
  }
  return map;
}

// ---------------------------------------------------------------------------
// Nomes
// ---------------------------------------------------------------------------

export function ownerDisplay(owners: Record<string, string>, ownerId: string | null | undefined): string {
  if (!ownerId || ownerId === NO_OWNER) return "Sem dono atribuído";
  return owners[ownerId] ?? `Usuário ${ownerId}`;
}

export function ownerOptions(owners: Record<string, string>, ids?: Iterable<string>) {
  const list = ids ? [...new Set(ids)].filter((id) => id !== NO_OWNER) : Object.keys(owners);
  return list.map((id) => ({ id, name: ownerDisplay(owners, id) })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}
