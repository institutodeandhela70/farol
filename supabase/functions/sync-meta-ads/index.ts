import { logIntegrationCall } from "../_shared/integrationLog.ts";
import { authorizeMetaCall, CORS_HEADERS, graphGet, json, type Json } from "../_shared/metaGraph.ts";

// Fase 2 — Meta Ads: estrutura (campanhas/conjuntos/anúncios), métricas diárias
// por anúncio e breakdowns por campanha.
//
// É retomável: cada execução trabalha até ~100s, grava o cursor em
// meta_sync_state e, se sobrou trabalho, se reinvoca sozinha (encadeamento).
// Ciclo completo = estrutura (só o que mudou desde o último ciclo) + insights
// (relê os últimos 28 dias porque a Meta atribui conversão com atraso) + breakdowns.
//
// body: { integration_id, background?: boolean, chain?: number, since?: "YYYY-MM-DD" }
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const BUDGET_MS = 100_000;
const MAX_CHAIN = 400;
const RELOAD_DAYS = 28;
const DEFAULT_SINCE = "2025-01-01";
const WINDOW_SIZES = [7, 3, 1];

const CAMPAIGN_STATUSES = ["ACTIVE", "PAUSED", "ARCHIVED"];
const ADSET_STATUSES = ["ACTIVE", "PAUSED", "ARCHIVED", "CAMPAIGN_PAUSED", "IN_PROCESS", "WITH_ISSUES"];
const AD_STATUSES = [
  "ACTIVE", "PAUSED", "ARCHIVED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "IN_PROCESS",
  "WITH_ISSUES", "PENDING_REVIEW", "DISAPPROVED", "PREAPPROVED", "PENDING_BILLING_INFO",
];

const STRUCTURE = {
  campaigns: {
    edge: "campaigns",
    limit: 200,
    statuses: CAMPAIGN_STATUSES,
    fields:
      "id,name,objective,status,effective_status,buying_type,bid_strategy,daily_budget,lifetime_budget,start_time,stop_time,created_time,updated_time",
  },
  adsets: {
    edge: "adsets",
    limit: 200,
    statuses: ADSET_STATUSES,
    fields:
      "id,campaign_id,name,status,effective_status,optimization_goal,billing_event,bid_strategy,destination_type,daily_budget,lifetime_budget,start_time,end_time,created_time,updated_time,targeting,promoted_object",
  },
  ads: {
    edge: "ads",
    limit: 100,
    statuses: AD_STATUSES,
    fields:
      "id,adset_id,campaign_id,name,status,effective_status,created_time,updated_time,creative{id,name,title,body,thumbnail_url,image_url,object_type,call_to_action_type,effective_object_story_id,instagram_permalink_url}",
  },
} as const;

type StructureDataset = keyof typeof STRUCTURE;

const INSIGHT_FIELDS =
  "campaign_id,adset_id,ad_id,spend,impressions,reach,clicks,inline_link_clicks,ctr,cpm,cpc,frequency,actions,action_values,purchase_roas,video_thruplay_watched_actions";
const BREAKDOWN_FIELDS = "campaign_id,spend,impressions,reach,clicks,inline_link_clicks,actions,action_values";

const BREAKDOWNS = {
  bd_placement: { name: "placement", params: "publisher_platform,platform_position", k1: "publisher_platform", k2: "platform_position" },
  bd_age_gender: { name: "age_gender", params: "age,gender", k1: "age", k2: "gender" },
  bd_region: { name: "region", params: "region", k1: "region", k2: null },
} as const;

type BreakdownDataset = keyof typeof BREAKDOWNS;

const num = (v: unknown) => (v === undefined || v === null || v === "" ? null : Number(v));
const cents = (v: unknown) => (v === undefined || v === null || v === "" ? null : Number(v) / 100);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return iso(x);
};

class RateLimited extends Error {}
class OutOfTime extends Error {}

// Códigos de limite de uso da Graph API / Marketing API / BUC
function isRateLimit(error?: string) {
  return !!error && /code (4|17|32|613|80000|80001|80002|80003|80004|80005|80006|80008|80014)\b/.test(error);
}
function isTooMuchData(error?: string) {
  return !!error && (/reduce the amount of data/i.test(error) || /code 1\b/.test(error));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const startedAt = Date.now();
  let workspaceId: string | null = null;
  let integrationId: string | null = null;
  // deno-lint-ignore no-explicit-any
  let admin: any = null;

  const log = async (params: { status: "success" | "error"; statusCode: number; response?: unknown; errorMessage?: string }) => {
    if (!admin) return;
    await logIntegrationCall(admin, {
      workspaceId,
      integrationId,
      provider: "meta",
      direction: "outbound",
      eventType: "sync_ads",
      request: { integration_id: integrationId },
      durationMs: Date.now() - startedAt,
      ...params,
    });
  };

  try {
    const body = await req.json().catch(() => ({}));
    integrationId = body?.integration_id ?? null;
    if (!integrationId) return json({ error: "integration_id required" }, 400);
    const chain: number = Number(body?.chain ?? 0);

    const auth = await authorizeMetaCall(req, integrationId, async (status, message, ws) => {
      workspaceId = ws;
      const { createClient } = await import("npm:@supabase/supabase-js@2");
      admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      await log({ status: "error", statusCode: status, errorMessage: message });
    });
    if (auth instanceof Response) return auth;
    admin = auth.admin;
    workspaceId = auth.integration.workspace_id;

    const since: string =
      /^\d{4}-\d{2}-\d{2}$/.test(body?.since ?? "") ? body.since : ((auth.integration.config.backfill_since as string) ?? DEFAULT_SINCE);

    const job = async () => {
      // Trava: uma execução por integração
      const nowIso = new Date().toISOString();
      const lockUntil = new Date(Date.now() + 3 * 60_000).toISOString();
      await admin.from("meta_sync_locks").upsert({ integration_id: integrationId, locked_until: "1970-01-01T00:00:00Z" }, { onConflict: "integration_id", ignoreDuplicates: true });
      const { data: got } = await admin
        .from("meta_sync_locks")
        .update({ locked_until: lockUntil })
        .eq("integration_id", integrationId)
        .lt("locked_until", nowIso)
        .select("integration_id");
      if (!got?.length) return { skipped: "já existe uma sincronização em andamento" };

      let result: Record<string, unknown> = {};
      try {
        result = await runSync({ admin, workspaceId: workspaceId!, integrationId: integrationId!, token: auth.token, version: auth.version, since, startedAt, force: body?.force === true });
      } finally {
        await admin.from("meta_sync_locks").update({ locked_until: "1970-01-01T00:00:00Z" }).eq("integration_id", integrationId);
      }

      const done = result.done === true;
      if (!done && !result.rate_limited && chain < MAX_CHAIN) {
        const internal = Deno.env.get("FAROL_INTERNAL_TOKEN");
        if (internal) {
          await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/sync-meta-ads`, {
            method: "POST",
            headers: { Authorization: `Bearer ${internal}`, "Content-Type": "application/json" },
            body: JSON.stringify({ integration_id: integrationId, background: true, chain: chain + 1, since }),
          }).catch(() => {});
        }
      }

      await admin
        .from("integrations")
        .update(result.error ? { status: "error", last_error: String(result.error).slice(0, 500) } : { status: "connected", last_error: null, last_synced_at: new Date().toISOString() })
        .eq("id", integrationId);
      await log(result.error ? { status: "error", statusCode: 500, errorMessage: String(result.error), response: result } : { status: "success", statusCode: 200, response: { ...result, chain } });
      return result;
    };

    if (body?.background === true && typeof EdgeRuntime !== "undefined") {
      EdgeRuntime.waitUntil(job().catch((e) => log({ status: "error", statusCode: 500, errorMessage: String(e) })));
      return json({ started: true }, 202);
    }
    return json(await job());
  } catch (err) {
    await log({ status: "error", statusCode: 500, errorMessage: String(err) });
    return json({ error: String(err) }, 500);
  }
});

interface Ctx {
  // deno-lint-ignore no-explicit-any
  admin: any;
  workspaceId: string;
  integrationId: string;
  token: string;
  version: string;
  since: string;
  startedAt: number;
  force: boolean;
}

const outOfTime = (ctx: Ctx) => Date.now() - ctx.startedAt > BUDGET_MS;

async function runSync(ctx: Ctx): Promise<Record<string, unknown>> {
  const { data: accounts } = await ctx.admin
    .from("meta_ad_accounts")
    .select("account_id, name")
    .eq("workspace_id", ctx.workspaceId)
    .eq("integration_id", ctx.integrationId)
    .eq("enabled", true)
    .order("account_id");
  if (!accounts?.length) return { done: true, note: "nenhuma conta de anúncio habilitada" };

  const summary: Record<string, number> = {};
  const bump = (k: string, n: number) => (summary[k] = (summary[k] ?? 0) + n);
  let pending = false;

  try {
    for (const acc of accounts) {
      for (const ds of Object.keys(STRUCTURE) as StructureDataset[]) {
        const finished = await syncStructure(ctx, acc.account_id, ds, (n) => bump(ds, n));
        if (!finished) pending = true;
      }
      const insightsDone = await syncInsights(ctx, acc.account_id, "insights", (n) => bump("insights", n));
      if (!insightsDone) pending = true;
      for (const ds of Object.keys(BREAKDOWNS) as BreakdownDataset[]) {
        const finished = await syncInsights(ctx, acc.account_id, ds, (n) => bump(ds, n));
        if (!finished) pending = true;
      }
    }
  } catch (e) {
    if (e instanceof OutOfTime) return { done: false, ...summary };
    if (e instanceof RateLimited) return { done: false, rate_limited: true, note: e.message, ...summary };
    return { done: false, error: e instanceof Error ? e.message : String(e), ...summary };
  }
  return { done: !pending, ...summary };
}

async function getState(ctx: Ctx, accountId: string, dataset: string) {
  const { data } = await ctx.admin
    .from("meta_sync_state")
    .select("*")
    .eq("integration_id", ctx.integrationId)
    .eq("account_id", accountId)
    .eq("dataset", dataset)
    .maybeSingle();
  return data as Record<string, Json> | null;
}

async function saveState(ctx: Ctx, accountId: string, dataset: string, patch: Record<string, unknown>, addRows = 0) {
  const prev = await getState(ctx, accountId, dataset);
  await ctx.admin.from("meta_sync_state").upsert(
    {
      ...(prev ?? {}),
      ...patch,
      workspace_id: ctx.workspaceId,
      integration_id: ctx.integrationId,
      account_id: accountId,
      dataset,
      rows_loaded: Number(prev?.rows_loaded ?? 0) + addRows,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "integration_id,account_id,dataset" },
  );
}

/**
 * Dataset já concluído neste ciclo? As continuações encadeadas acontecem em minutos;
 * o próximo ciclo (cron de 3h, ou clique manual com force) recomeça tudo.
 */
async function alreadyDoneThisCycle(ctx: Ctx, accountId: string, dataset: string) {
  if (ctx.force) return false;
  const st = await getState(ctx, accountId, dataset);
  if (!st || st.cursor_date || st.cycle_started_at || !st.completed_at) return false;
  return Date.now() - new Date(st.completed_at as string).getTime() < 2 * 3600_000;
}

async function upsertBatches(ctx: Ctx, table: string, rows: Record<string, unknown>[], onConflict: string) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await ctx.admin.from(table).upsert(rows.slice(i, i + 500), { onConflict });
    if (error) throw new Error(`Erro ao gravar ${table}: ${error.message}`);
  }
}

/** Estrutura: pagina por cursor `after`; só traz o que mudou desde o último ciclo (updated_time). Devolve true se o ciclo terminou. */
async function syncStructure(ctx: Ctx, accountId: string, ds: StructureDataset, count: (n: number) => void): Promise<boolean> {
  const cfg = STRUCTURE[ds];
  if (await alreadyDoneThisCycle(ctx, accountId, ds)) return true;
  let state = await getState(ctx, accountId, ds);

  if (!state?.cycle_started_at) {
    await saveState(ctx, accountId, ds, { cycle_started_at: new Date().toISOString(), after_cursor: null, last_error: null });
    state = await getState(ctx, accountId, ds);
  }
  const syncedAt: string | null = state?.synced_at ?? null;

  for (;;) {
    if (outOfTime(ctx)) throw new OutOfTime();

    const params: Record<string, string> = {
      fields: cfg.fields,
      limit: String(cfg.limit),
      effective_status: JSON.stringify(cfg.statuses),
    };
    if (state?.after_cursor) params.after = state.after_cursor as string;
    if (syncedAt) {
      // 1h de folga pra não perder alterações na borda do ciclo anterior
      const unix = Math.floor(new Date(syncedAt).getTime() / 1000) - 3600;
      params.filtering = JSON.stringify([{ field: "updated_time", operator: "GREATER_THAN", value: unix }]);
    }

    const r = await graphGet(`/${accountId}/${cfg.edge}`, ctx.token, ctx.version, params);
    if (!r.ok) {
      await saveState(ctx, accountId, ds, { last_error: r.error?.slice(0, 500) });
      if (isRateLimit(r.error)) throw new RateLimited(r.error!);
      throw new Error(`${ds} ${accountId}: ${r.error}`);
    }

    const items: Json[] = r.data?.data ?? [];
    const now = new Date().toISOString();
    if (items.length) {
      if (ds === "campaigns") {
        await upsertBatches(ctx, "meta_campaigns", items.map((c) => ({
          workspace_id: ctx.workspaceId, account_id: accountId, campaign_id: c.id, name: c.name ?? null,
          objective: c.objective ?? null, status: c.status ?? null, effective_status: c.effective_status ?? null,
          buying_type: c.buying_type ?? null, bid_strategy: c.bid_strategy ?? null,
          daily_budget: cents(c.daily_budget), lifetime_budget: cents(c.lifetime_budget),
          start_time: c.start_time ?? null, stop_time: c.stop_time ?? null,
          created_time: c.created_time ?? null, updated_time: c.updated_time ?? null,
          raw_payload: c, synced_at: now,
        })), "workspace_id,campaign_id");
      } else if (ds === "adsets") {
        await upsertBatches(ctx, "meta_adsets", items.map((a) => ({
          workspace_id: ctx.workspaceId, account_id: accountId, adset_id: a.id, campaign_id: a.campaign_id ?? null,
          name: a.name ?? null, status: a.status ?? null, effective_status: a.effective_status ?? null,
          optimization_goal: a.optimization_goal ?? null, billing_event: a.billing_event ?? null,
          bid_strategy: a.bid_strategy ?? null, destination_type: a.destination_type ?? null,
          daily_budget: cents(a.daily_budget), lifetime_budget: cents(a.lifetime_budget),
          start_time: a.start_time ?? null, end_time: a.end_time ?? null,
          created_time: a.created_time ?? null, updated_time: a.updated_time ?? null,
          targeting: a.targeting ?? null, promoted_object: a.promoted_object ?? null, synced_at: now,
        })), "workspace_id,adset_id");
      } else {
        await upsertBatches(ctx, "meta_ads", items.map((a) => {
          const c = a.creative ?? {};
          return {
            workspace_id: ctx.workspaceId, account_id: accountId, ad_id: a.id, adset_id: a.adset_id ?? null,
            campaign_id: a.campaign_id ?? null, name: a.name ?? null, status: a.status ?? null,
            effective_status: a.effective_status ?? null, created_time: a.created_time ?? null,
            updated_time: a.updated_time ?? null, creative_id: c.id ?? null, creative_name: c.name ?? null,
            creative_title: c.title ?? null, creative_body: c.body ?? null,
            creative_thumbnail_url: c.thumbnail_url ?? null, creative_image_url: c.image_url ?? null,
            creative_object_type: c.object_type ?? null, creative_call_to_action: c.call_to_action_type ?? null,
            effective_object_story_id: c.effective_object_story_id ?? null,
            instagram_permalink_url: c.instagram_permalink_url ?? null, raw_payload: a, synced_at: now,
          };
        }), "workspace_id,ad_id");
      }
      count(items.length);
    }

    const next = r.data?.paging?.next ? (r.data?.paging?.cursors?.after as string | undefined) : undefined;
    if (!next) {
      await saveState(ctx, accountId, ds, { after_cursor: null, cycle_started_at: null, synced_at: state?.cycle_started_at, completed_at: new Date().toISOString(), last_error: null }, items.length);
      return true;
    }
    await saveState(ctx, accountId, ds, { after_cursor: next }, items.length);
    state = { ...state, after_cursor: next };
  }
}

/** Insights (por anúncio/dia ou breakdown por campanha/dia), em janelas de 7 dias. Devolve true se o ciclo terminou. */
async function syncInsights(ctx: Ctx, accountId: string, ds: "insights" | BreakdownDataset, count: (n: number) => void): Promise<boolean> {
  const today = iso(new Date());
  if (await alreadyDoneThisCycle(ctx, accountId, ds)) return true;
  const state = await getState(ctx, accountId, ds);

  let cursor: string | null = state?.cursor_date ?? null;
  if (!cursor) {
    // ciclo novo: continua do último dia carregado relendo a janela de atribuição
    cursor = state?.loaded_through ? addDays(state.loaded_through as string, -(RELOAD_DAYS - 1)) : ctx.since;
    if (cursor < ctx.since) cursor = ctx.since;
  }

  while (cursor <= today) {
    if (outOfTime(ctx)) throw new OutOfTime();

    let end = cursor;
    let rows: Json[] | null = null;
    let lastError: string | undefined;
    for (const size of WINDOW_SIZES) {
      end = addDays(cursor, size - 1);
      if (end > today) end = today;
      const params: Record<string, string> = {
        level: ds === "insights" ? "ad" : "campaign",
        time_increment: "1",
        time_range: JSON.stringify({ since: cursor, until: end }),
        fields: ds === "insights" ? INSIGHT_FIELDS : BREAKDOWN_FIELDS,
        limit: "500",
      };
      if (ds !== "insights") params.breakdowns = BREAKDOWNS[ds].params;
      const r = await fetchAllPages(`/${accountId}/insights`, ctx, params, ctx.startedAt);
      if (r.ok) {
        rows = r.data!;
        break;
      }
      lastError = r.error;
      if (isRateLimit(r.error)) {
        await saveState(ctx, accountId, ds, { last_error: r.error?.slice(0, 500) });
        throw new RateLimited(r.error!);
      }
      if (!isTooMuchData(r.error)) break;
    }
    if (!rows) {
      await saveState(ctx, accountId, ds, { last_error: lastError?.slice(0, 500) });
      throw new Error(`${ds} ${accountId} ${cursor}..${end}: ${lastError}`);
    }

    const now = new Date().toISOString();
    if (ds === "insights") {
      const out = rows.map((i) => ({
        workspace_id: ctx.workspaceId, account_id: accountId, ad_id: i.ad_id, date: i.date_start,
        campaign_id: i.campaign_id ?? null, adset_id: i.adset_id ?? null,
        spend: num(i.spend), impressions: num(i.impressions), reach: num(i.reach), clicks: num(i.clicks),
        link_clicks: num(i.inline_link_clicks), ctr: num(i.ctr), cpm: num(i.cpm), cpc: num(i.cpc),
        frequency: num(i.frequency), actions: i.actions ?? null, action_values: i.action_values ?? null,
        extra: i.purchase_roas || i.video_thruplay_watched_actions
          ? { purchase_roas: i.purchase_roas ?? null, video_thruplay_watched_actions: i.video_thruplay_watched_actions ?? null }
          : null,
        synced_at: now,
      })).filter((r) => r.ad_id);
      await upsertBatches(ctx, "meta_ad_insights_daily", out, "workspace_id,ad_id,date");
      count(out.length);
    } else {
      const b = BREAKDOWNS[ds];
      // linhas repetidas na mesma chave (ex.: valores nulos) são somadas pra não violar a PK
      const merged = new Map<string, Record<string, unknown>>();
      for (const i of rows) {
        if (!i.campaign_id) continue;
        const k1 = String(i[b.k1] ?? "");
        const k2 = b.k2 ? String(i[b.k2] ?? "") : "";
        const key = `${i.campaign_id}|${i.date_start}|${k1}|${k2}`;
        if (merged.has(key)) continue;
        merged.set(key, {
          workspace_id: ctx.workspaceId, account_id: accountId, campaign_id: i.campaign_id, date: i.date_start,
          breakdown: b.name, key1: k1, key2: k2, spend: num(i.spend), impressions: num(i.impressions),
          reach: num(i.reach), clicks: num(i.clicks), link_clicks: num(i.inline_link_clicks),
          actions: i.actions ?? null, action_values: i.action_values ?? null, synced_at: now,
        });
      }
      await upsertBatches(ctx, "meta_insights_breakdowns", [...merged.values()], "workspace_id,campaign_id,date,breakdown,key1,key2");
      count(merged.size);
    }

    cursor = addDays(end, 1);
    await saveState(ctx, accountId, ds, { cursor_date: cursor <= today ? cursor : null, last_error: null }, rows.length);
  }

  await saveState(ctx, accountId, ds, { cursor_date: null, loaded_through: today, completed_at: new Date().toISOString(), last_error: null });
  return true;
}

/** Lê todas as páginas de /insights respeitando o orçamento de tempo. */
async function fetchAllPages(path: string, ctx: Ctx, params: Record<string, string>, startedAt: number) {
  const items: Json[] = [];
  const first = await graphGet(path, ctx.token, ctx.version, params);
  if (!first.ok) return { ok: false as const, error: first.error, data: undefined };
  let page = first.data;
  for (let i = 0; i < 200; i++) {
    if (Array.isArray(page?.data)) items.push(...page.data);
    const next = page?.paging?.next;
    if (!next) break;
    if (Date.now() - startedAt > BUDGET_MS + 40_000) throw new OutOfTime();
    const res = await fetch(next);
    const b = await res.json().catch(() => null);
    if (!res.ok) {
      const e = b?.error;
      return { ok: false as const, error: `${e?.message ?? `HTTP ${res.status}`}${e?.code ? ` (code ${e.code})` : ""}`, data: undefined };
    }
    page = b;
  }
  return { ok: true as const, error: undefined, data: items };
}
