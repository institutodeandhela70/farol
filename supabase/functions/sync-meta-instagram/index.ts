import { createClient } from "npm:@supabase/supabase-js@2";
import { logIntegrationCall } from "../_shared/integrationLog.ts";
import { authorizeMetaCall, CORS_HEADERS, graphGet, json, type Json } from "../_shared/metaGraph.ts";

// Fase 3 — Instagram: perfil, métricas diárias da conta, posts/reels/stories (+ insights),
// demografia da audiência e comentários.
//
// Retomável como o sync-meta-ads: ~100s por execução, cursor em meta_sync_state
// (dataset "ig_*", account_id = ig_user_id) e encadeamento sozinho enquanto sobrar trabalho.
// body: { integration_id, background?, chain?, force?, since?: "YYYY-MM-DD" }
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const BUDGET_MS = 100_000;
const MAX_CHAIN = 400;
const DEFAULT_SINCE = "2025-01-01";
const ACCOUNT_RELOAD_DAYS = 3; // a Meta pode atrasar métricas em até 48h
const DAY_CONCURRENCY = 4;
const MEDIA_CONCURRENCY = 4;

const MEDIA_FIELDS =
  "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,shortcode,timestamp,like_count,comments_count,is_shared_to_feed,children{id}";

const ACCOUNT_METRICS = ["reach", "views", "likes", "comments", "shares", "saves", "replies", "reposts", "total_interactions", "accounts_engaged"];

const FEED_METRICS = "reach,views,likes,comments,shares,saved,total_interactions,reposts,follows,profile_visits";
const FEED_FALLBACK = "reach,likes,comments,shares,saved,total_interactions";
const REEL_METRICS = "reach,views,likes,comments,shares,saved,total_interactions,reposts,ig_reels_avg_watch_time,ig_reels_video_view_total_time";
const REEL_FALLBACK = "reach,views,likes,comments,shares,saved,total_interactions";
const STORY_METRICS = "reach,views,shares,total_interactions,replies,follows,profile_visits,reposts";
const STORY_FALLBACK = "reach,views,replies,shares,total_interactions";

const num = (v: unknown) => (v === undefined || v === null || v === "" ? null : Number(v));
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return iso(x);
};
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

class RateLimited extends Error {}
class OutOfTime extends Error {}

function isRateLimit(error?: string) {
  return !!error && /code (4|17|32|613|80000|80001|80002|80003|80004|80005|80006|80008|80014)\b/.test(error);
}

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
      eventType: "sync_instagram",
      request: { integration_id: integrationId },
      durationMs: Date.now() - startedAt,
      ...params,
    });
  };

  try {
    const body = await req.json().catch(() => ({}));
    integrationId = body?.integration_id ?? null;
    if (!integrationId) return json({ error: "integration_id required" }, 400);
    const chain = Number(body?.chain ?? 0);

    const auth = await authorizeMetaCall(req, integrationId, async (status, message, ws) => {
      workspaceId = ws;
      admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      await log({ status: "error", statusCode: status, errorMessage: message });
    });
    if (auth instanceof Response) return auth;
    admin = auth.admin;
    workspaceId = auth.integration.workspace_id;

    const since: string = /^\d{4}-\d{2}-\d{2}$/.test(body?.since ?? "")
      ? body.since
      : ((auth.integration.config.ig_backfill_since as string) ?? DEFAULT_SINCE);

    const job = async () => {
      const nowIso = new Date().toISOString();
      await admin.from("meta_ig_sync_locks").upsert({ integration_id: integrationId, locked_until: "1970-01-01T00:00:00Z" }, { onConflict: "integration_id", ignoreDuplicates: true });
      const { data: got } = await admin
        .from("meta_ig_sync_locks")
        .update({ locked_until: new Date(Date.now() + 3 * 60_000).toISOString() })
        .eq("integration_id", integrationId)
        .lt("locked_until", nowIso)
        .select("integration_id");
      if (!got?.length) return { skipped: "já existe uma sincronização do Instagram em andamento" };

      let result: Record<string, unknown> = {};
      try {
        result = await runSync({ admin, workspaceId: workspaceId!, integrationId: integrationId!, token: auth.token, version: auth.version, since, startedAt, force: body?.force === true });
      } finally {
        await admin.from("meta_ig_sync_locks").update({ locked_until: "1970-01-01T00:00:00Z" }).eq("integration_id", integrationId);
      }

      if (result.done !== true && !result.rate_limited && !result.error && chain < MAX_CHAIN) {
        const internal = Deno.env.get("FAROL_INTERNAL_TOKEN");
        if (internal) {
          await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/sync-meta-instagram`, {
            method: "POST",
            headers: { Authorization: `Bearer ${internal}`, "Content-Type": "application/json" },
            body: JSON.stringify({ integration_id: integrationId, background: true, chain: chain + 1, since }),
          }).catch(() => {});
        }
      }
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

async function runSync(ctx: Ctx): Promise<Record<string, unknown>> {
  const { data: accounts } = await ctx.admin
    .from("meta_ig_accounts")
    .select("ig_user_id, username")
    .eq("workspace_id", ctx.workspaceId)
    .eq("integration_id", ctx.integrationId)
    .eq("enabled", true)
    .order("ig_user_id");
  if (!accounts?.length) return { done: true, note: "nenhum perfil de Instagram habilitado" };

  const summary: Record<string, number> = {};
  const bump = (k: string) => (n: number) => {
    summary[k] = (summary[k] ?? 0) + n;
  };
  let pending = false;
  let limitedNote: string | null = null;

  try {
    for (const acc of accounts) {
      const ig = acc.ig_user_id as string;
      try {
        // ordem: o que expira ou muda mais rápido primeiro
        const steps: [string, () => Promise<boolean>][] = [
          ["ig_profile", () => syncProfile(ctx, ig, bump("profile"))],
          ["ig_stories", () => syncStories(ctx, ig, bump("stories"))],
          ["ig_media_list", () => syncMediaList(ctx, ig, bump("media"))],
          ["ig_media_insights", () => syncMediaInsights(ctx, ig, bump("media_insights"))],
          ["ig_account_insights", () => syncAccountInsights(ctx, ig, bump("account_days"))],
          ["ig_audience", () => syncAudience(ctx, ig, bump("audience"))],
          ["ig_comments", () => syncComments(ctx, ig, bump("comments"))],
        ];
        for (const [, run] of steps) {
          if (!(await run())) pending = true;
        }
      } catch (e) {
        if (!(e instanceof RateLimited)) throw e;
        pending = true;
        limitedNote = `${ig}: ${e.message}`;
      }
    }
  } catch (e) {
    if (e instanceof OutOfTime) return { done: false, ...summary };
    return { done: false, error: e instanceof Error ? e.message : String(e), ...summary };
  }
  if (limitedNote) return { done: false, rate_limited: true, note: limitedNote, ...summary };
  return { done: !pending, ...summary };
}

// ---------------------------------------------------------------------------
// Estado / utilitários
// ---------------------------------------------------------------------------

async function getState(ctx: Ctx, igId: string, dataset: string) {
  const { data } = await ctx.admin
    .from("meta_sync_state")
    .select("*")
    .eq("integration_id", ctx.integrationId)
    .eq("account_id", igId)
    .eq("dataset", dataset)
    .maybeSingle();
  return data as Record<string, Json> | null;
}

async function saveState(ctx: Ctx, igId: string, dataset: string, patch: Record<string, unknown>, addRows = 0) {
  const prev = await getState(ctx, igId, dataset);
  await ctx.admin.from("meta_sync_state").upsert(
    {
      ...(prev ?? {}),
      ...patch,
      workspace_id: ctx.workspaceId,
      integration_id: ctx.integrationId,
      account_id: igId,
      dataset,
      rows_loaded: Number(prev?.rows_loaded ?? 0) + addRows,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "integration_id,account_id,dataset" },
  );
}

/** Concluído neste ciclo? (continuações encadeadas acontecem em minutos). */
async function doneRecently(ctx: Ctx, igId: string, dataset: string, hours: number) {
  if (ctx.force) return false;
  const st = await getState(ctx, igId, dataset);
  if (!st || st.cursor_date || st.cycle_started_at || !st.completed_at) return false;
  return new Date(st.completed_at as string).getTime() > Date.now() - hours * 3600_000;
}

async function complete(ctx: Ctx, igId: string, dataset: string, patch: Record<string, unknown> = {}, rows = 0) {
  await saveState(ctx, igId, dataset, { cursor_date: null, after_cursor: null, cycle_started_at: null, completed_at: new Date().toISOString(), last_error: null, ...patch }, rows);
}

async function upsertBatches(ctx: Ctx, table: string, rows: Record<string, unknown>[], onConflict: string) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await ctx.admin.from(table).upsert(rows.slice(i, i + 500), { onConflict });
    if (error) throw new Error(`Erro ao gravar ${table}: ${error.message}`);
  }
}

/** Chamada à Graph API com tratamento de limite de uso; erros comuns viram exceção legível. */
async function call(ctx: Ctx, igId: string, dataset: string, path: string, params: Record<string, string>) {
  const r = await graphGet(path, ctx.token, ctx.version, params);
  if (!r.ok) {
    await saveState(ctx, igId, dataset, { last_error: r.error?.slice(0, 500) });
    if (isRateLimit(r.error)) throw new RateLimited(r.error!);
  }
  return r;
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

const metricValue = (m: Json): number | null => num(m?.values?.[0]?.value ?? m?.total_value?.value);

// ---------------------------------------------------------------------------
// Perfil (snapshot diário de seguidores)
// ---------------------------------------------------------------------------

async function syncProfile(ctx: Ctx, igId: string, count: (n: number) => void): Promise<boolean> {
  if (await doneRecently(ctx, igId, "ig_profile", 1)) return true;
  const r = await call(ctx, igId, "ig_profile", `/${igId}`, { fields: "username,name,followers_count,follows_count,media_count,profile_picture_url" });
  if (!r.ok) throw new Error(`perfil ${igId}: ${r.error}`);
  const p = r.data;
  await upsertBatches(ctx, "meta_ig_profile_daily", [
    { workspace_id: ctx.workspaceId, ig_user_id: igId, date: iso(new Date()), followers_count: num(p.followers_count), follows_count: num(p.follows_count), media_count: num(p.media_count) },
  ], "workspace_id,ig_user_id,date");
  await ctx.admin
    .from("meta_ig_accounts")
    .update({ followers_count: num(p.followers_count), follows_count: num(p.follows_count), media_count: num(p.media_count), username: p.username ?? undefined, name: p.name ?? undefined, profile_picture_url: p.profile_picture_url ?? undefined, updated_at: new Date().toISOString() })
    .eq("workspace_id", ctx.workspaceId)
    .eq("ig_user_id", igId);
  count(1);
  await complete(ctx, igId, "ig_profile", {}, 1);
  return true;
}

// ---------------------------------------------------------------------------
// Posts e reels: lista (metadados) e insights
// ---------------------------------------------------------------------------

function mediaRow(ctx: Ctx, igId: string, m: Json, now: string) {
  return {
    workspace_id: ctx.workspaceId,
    ig_user_id: igId,
    media_id: m.id,
    product_type: m.media_product_type ?? null,
    media_type: m.media_type ?? null,
    caption: m.caption ?? null,
    permalink: m.permalink ?? null,
    shortcode: m.shortcode ?? null,
    media_url: m.media_url ?? null,
    thumbnail_url: m.thumbnail_url ?? null,
    posted_at: m.timestamp ?? null,
    like_count: num(m.like_count),
    comments_count: num(m.comments_count),
    is_shared_to_feed: m.is_shared_to_feed ?? null,
    children_count: m.children?.data?.length ?? null,
    updated_at: now,
  };
}

/** Lista /media (mais novo → mais antigo). Ciclos seguintes param quando uma página inteira já é conhecida. */
async function syncMediaList(ctx: Ctx, igId: string, count: (n: number) => void): Promise<boolean> {
  if (await doneRecently(ctx, igId, "ig_media_list", 2)) return true;
  let state = await getState(ctx, igId, "ig_media_list");
  if (!state?.cycle_started_at) {
    await saveState(ctx, igId, "ig_media_list", { cycle_started_at: new Date().toISOString(), after_cursor: null });
    state = await getState(ctx, igId, "ig_media_list");
  }
  const firstEver = !state?.completed_at;

  for (;;) {
    if (outOfTime(ctx)) throw new OutOfTime();
    const params: Record<string, string> = { fields: MEDIA_FIELDS, limit: "50" };
    if (state?.after_cursor) params.after = state.after_cursor as string;
    const r = await call(ctx, igId, "ig_media_list", `/${igId}/media`, params);
    if (!r.ok) throw new Error(`media ${igId}: ${r.error}`);

    const items: Json[] = r.data?.data ?? [];
    const now = new Date().toISOString();
    let allKnown = items.length > 0;
    if (items.length) {
      const { data: known } = await ctx.admin
        .from("meta_ig_media")
        .select("media_id")
        .eq("workspace_id", ctx.workspaceId)
        .in("media_id", items.map((m) => m.id));
      const knownIds = new Set((known ?? []).map((k: { media_id: string }) => k.media_id));
      allKnown = items.every((m) => knownIds.has(m.id));
      await upsertBatches(ctx, "meta_ig_media", items.map((m) => mediaRow(ctx, igId, m, now)), "workspace_id,media_id");
      count(items.length);
    }

    const next = r.data?.paging?.next ? (r.data?.paging?.cursors?.after as string | undefined) : undefined;
    if (!next || (!firstEver && allKnown)) {
      await complete(ctx, igId, "ig_media_list", {}, items.length);
      return true;
    }
    await saveState(ctx, igId, "ig_media_list", { after_cursor: next }, items.length);
    state = { ...state, after_cursor: next };
  }
}

function parseInsights(data: Json[] | undefined) {
  const out: Record<string, number | null> = {};
  for (const m of data ?? []) out[m.name] = metricValue(m);
  return out;
}

async function fetchMediaInsights(ctx: Ctx, igId: string, mediaId: string, productType: string | null) {
  const isReel = productType === "REELS";
  const isStory = productType === "STORY";
  const primary = isStory ? STORY_METRICS : isReel ? REEL_METRICS : FEED_METRICS;
  const fallback = isStory ? STORY_FALLBACK : isReel ? REEL_FALLBACK : FEED_FALLBACK;
  // Alguns posts antigos (vídeos de 2023, por exemplo) só aceitam um subconjunto das métricas:
  // tenta do mais completo pro mais básico, sem registrar erro de tentativa intermediária.
  const tiers = [primary, fallback, "reach,saved", "reach"];
  let last = await graphGet(`/${mediaId}/insights`, ctx.token, ctx.version, { metric: tiers[0] });
  for (let i = 1; !last.ok && i < tiers.length; i++) {
    if (isRateLimit(last.error)) break;
    last = await graphGet(`/${mediaId}/insights`, ctx.token, ctx.version, { metric: tiers[i] });
  }
  if (!last.ok && isRateLimit(last.error)) {
    await saveState(ctx, igId, "ig_media_insights", { last_error: last.error?.slice(0, 500) });
    throw new RateLimited(last.error!);
  }
  return last;
}

function insightColumns(v: Record<string, number | null>) {
  return {
    reach: v.reach ?? null,
    views: v.views ?? null,
    likes: v.likes ?? null,
    comments: v.comments ?? null,
    shares: v.shares ?? null,
    saved: v.saved ?? null,
    total_interactions: v.total_interactions ?? null,
    reposts: v.reposts ?? null,
    follows: v.follows ?? null,
    profile_visits: v.profile_visits ?? null,
    replies: v.replies ?? null,
    avg_watch_time_ms: v.ig_reels_avg_watch_time ?? null,
    total_watch_time_ms: v.ig_reels_video_view_total_time ?? null,
  };
}

/** Insights por post/reel. Recentes atualizam sempre; antigos só de vez em quando. Erros não repetem por 14 dias. */
async function syncMediaInsights(ctx: Ctx, igId: string, count: (n: number) => void): Promise<boolean> {
  if (await doneRecently(ctx, igId, "ig_media_insights", 2)) return true;
  await saveState(ctx, igId, "ig_media_insights", { cycle_started_at: new Date().toISOString() });

  const filter = [
    "insights_synced_at.is.null",
    `and(posted_at.gt.${hoursAgo(48)},insights_synced_at.lt.${hoursAgo(3)})`,
    `and(posted_at.gt.${hoursAgo(24 * 30)},insights_synced_at.lt.${hoursAgo(24)})`,
    `insights_synced_at.lt.${hoursAgo(24 * 14)}`,
  ].join(",");

  for (;;) {
    if (outOfTime(ctx)) throw new OutOfTime();
    const { data: batch, error } = await ctx.admin
      .from("meta_ig_media")
      .select("media_id, product_type")
      .eq("workspace_id", ctx.workspaceId)
      .eq("ig_user_id", igId)
      .neq("product_type", "STORY")
      .or(filter)
      .order("posted_at", { ascending: false })
      .limit(80);
    if (error) throw new Error(`Erro ao ler fila de insights: ${error.message}`);
    if (!batch?.length) break;

    let done = 0;
    await pool(batch as { media_id: string; product_type: string | null }[], MEDIA_CONCURRENCY, async (m) => {
      if (outOfTime(ctx)) return;
      const r = await fetchMediaInsights(ctx, igId, m.media_id, m.product_type);
      const patch: Record<string, unknown> = r.ok
        ? { ...insightColumns(parseInsights(r.data?.data)), insights_error: null }
        : { insights_error: (r.error ?? "erro").slice(0, 300) };
      patch.insights_synced_at = new Date().toISOString();
      await ctx.admin.from("meta_ig_media").update(patch).eq("workspace_id", ctx.workspaceId).eq("media_id", m.media_id);
      done++;
    });
    count(done);
    await saveState(ctx, igId, "ig_media_insights", {}, done);
  }
  await complete(ctx, igId, "ig_media_insights");
  return true;
}

// ---------------------------------------------------------------------------
// Stories (só existem na API por 24h — captura enquanto estão no ar)
// ---------------------------------------------------------------------------

async function syncStories(ctx: Ctx, igId: string, count: (n: number) => void): Promise<boolean> {
  if (await doneRecently(ctx, igId, "ig_stories", 1.5)) return true;
  await saveState(ctx, igId, "ig_stories", { cycle_started_at: new Date().toISOString() });

  const r = await call(ctx, igId, "ig_stories", `/${igId}/stories`, { fields: MEDIA_FIELDS, limit: "100" });
  if (!r.ok) throw new Error(`stories ${igId}: ${r.error}`);
  const live: Json[] = r.data?.data ?? [];
  const now = new Date().toISOString();

  for (const s of live) {
    if (outOfTime(ctx)) throw new OutOfTime();
    const row: Record<string, unknown> = { ...mediaRow(ctx, igId, { ...s, media_product_type: "STORY" }, now), raw_payload: s };
    const ins = await fetchMediaInsights(ctx, igId, s.id, "STORY");
    if (ins.ok) {
      Object.assign(row, insightColumns(parseInsights(ins.data?.data)), { insights_error: null });
      const nav = await call(ctx, igId, "ig_stories", `/${s.id}/insights`, { metric: "navigation", breakdown: "story_navigation_action_type" });
      if (nav.ok) {
        const results = nav.data?.data?.[0]?.total_value?.breakdowns?.[0]?.results ?? [];
        row.story_navigation = Object.fromEntries(results.map((x: Json) => [x.dimension_values?.[0], x.value]));
      }
    } else {
      row.insights_error = (ins.error ?? "erro").slice(0, 300);
    }
    row.insights_synced_at = now;
    row.expired_at = null;
    await upsertBatches(ctx, "meta_ig_media", [row], "workspace_id,media_id");
    count(1);
  }

  // Quem estava no ar e sumiu da lista expirou.
  const liveIds = new Set(live.map((s) => s.id));
  const { data: openRows } = await ctx.admin
    .from("meta_ig_media")
    .select("media_id")
    .eq("workspace_id", ctx.workspaceId)
    .eq("ig_user_id", igId)
    .eq("product_type", "STORY")
    .is("expired_at", null);
  const gone = (openRows ?? []).map((x: { media_id: string }) => x.media_id).filter((id: string) => !liveIds.has(id));
  if (gone.length) {
    await ctx.admin.from("meta_ig_media").update({ expired_at: now }).eq("workspace_id", ctx.workspaceId).in("media_id", gone);
  }
  await complete(ctx, igId, "ig_stories", {}, live.length);
  return true;
}

// ---------------------------------------------------------------------------
// Métricas diárias da conta (um dia = since D, until D+1)
// ---------------------------------------------------------------------------

async function fetchAccountDay(ctx: Ctx, igId: string, day: string) {
  const range = { since: day, until: addDays(day, 1), period: "day", metric_type: "total_value" };
  const a = await call(ctx, igId, "ig_account_insights", `/${igId}/insights`, { ...range, metric: ACCOUNT_METRICS.join(",") });
  if (!a.ok) throw new Error(`insights da conta ${day}: ${a.error}`);
  const b = await call(ctx, igId, "ig_account_insights", `/${igId}/insights`, { ...range, metric: "follows_and_unfollows", breakdown: "follow_type" });

  const v: Record<string, number | null> = {};
  for (const m of a.data?.data ?? []) v[m.name] = num(m.total_value?.value);
  if (!Object.keys(v).length) return null;

  let net: number | null = null;
  let breakdown: Json = null;
  if (b.ok) {
    const results: Json[] = b.data?.data?.[0]?.total_value?.breakdowns?.[0]?.results ?? [];
    if (results.length) {
      breakdown = Object.fromEntries(results.map((x) => [x.dimension_values?.[0], x.value]));
      net = results.reduce((s, x) => s + Number(x.value ?? 0), 0);
    }
  }
  return {
    workspace_id: ctx.workspaceId, ig_user_id: igId, date: day,
    reach: v.reach ?? null, views: v.views ?? null, likes: v.likes ?? null, comments: v.comments ?? null,
    shares: v.shares ?? null, saves: v.saves ?? null, replies: v.replies ?? null, reposts: v.reposts ?? null,
    total_interactions: v.total_interactions ?? null, accounts_engaged: v.accounts_engaged ?? null,
    follows_net: net, follows_breakdown: breakdown, synced_at: new Date().toISOString(),
  };
}

async function syncAccountInsights(ctx: Ctx, igId: string, count: (n: number) => void): Promise<boolean> {
  if (await doneRecently(ctx, igId, "ig_account_insights", 2)) return true;
  const state = await getState(ctx, igId, "ig_account_insights");
  const last = addDays(iso(new Date()), -1); // dia fechado mais recente
  let cursor: string | null = state?.cursor_date ?? null;
  if (!cursor) {
    cursor = state?.loaded_through ? addDays(state.loaded_through as string, -(ACCOUNT_RELOAD_DAYS - 1)) : ctx.since;
    if (cursor < ctx.since) cursor = ctx.since;
  }

  while (cursor <= last) {
    if (outOfTime(ctx)) throw new OutOfTime();
    const days: string[] = [];
    for (let d = cursor; d <= last && days.length < DAY_CONCURRENCY; d = addDays(d, 1)) days.push(d);
    const rows: Record<string, unknown>[] = [];
    await pool(days, DAY_CONCURRENCY, async (d) => {
      const row = await fetchAccountDay(ctx, igId, d);
      if (row) rows.push(row);
    });
    await upsertBatches(ctx, "meta_ig_account_daily", rows, "workspace_id,ig_user_id,date");
    count(rows.length);
    cursor = addDays(days[days.length - 1], 1);
    await saveState(ctx, igId, "ig_account_insights", { cursor_date: cursor <= last ? cursor : null, last_error: null }, rows.length);
  }
  await complete(ctx, igId, "ig_account_insights", { loaded_through: last });
  return true;
}

// ---------------------------------------------------------------------------
// Demografia da audiência (foto do dia)
// ---------------------------------------------------------------------------

async function syncAudience(ctx: Ctx, igId: string, count: (n: number) => void): Promise<boolean> {
  if (await doneRecently(ctx, igId, "ig_audience", 20)) return true;
  const today = iso(new Date());
  const rows: Record<string, unknown>[] = [];

  for (const [metric, tag] of [["follower_demographics", "follower"], ["engaged_audience_demographics", "engaged"]] as const) {
    for (const breakdown of ["age", "gender", "city", "country"]) {
      if (outOfTime(ctx)) throw new OutOfTime();
      const r = await call(ctx, igId, "ig_audience", `/${igId}/insights`, { metric, metric_type: "total_value", period: "lifetime", breakdown, timeframe: "this_month" });
      if (!r.ok) continue; // engajados exige 100+ interações; demais falhas não derrubam o ciclo
      const results: Json[] = r.data?.data?.[0]?.total_value?.breakdowns?.[0]?.results ?? [];
      for (const x of results) {
        const key = (x.dimension_values ?? []).join("|");
        if (key) rows.push({ workspace_id: ctx.workspaceId, ig_user_id: igId, date: today, metric: tag, breakdown, key, value: num(x.value) });
      }
    }
  }
  await upsertBatches(ctx, "meta_ig_audience", rows, "workspace_id,ig_user_id,date,metric,breakdown,key");
  count(rows.length);
  await complete(ctx, igId, "ig_audience", {}, rows.length);
  return true;
}

// ---------------------------------------------------------------------------
// Comentários (posts cuja contagem mudou desde a última leitura; mais novos primeiro)
// ---------------------------------------------------------------------------

async function syncComments(ctx: Ctx, igId: string, count: (n: number) => void): Promise<boolean> {
  if (await doneRecently(ctx, igId, "ig_comments", 2)) return true;
  await saveState(ctx, igId, "ig_comments", { cycle_started_at: new Date().toISOString() });

  for (;;) {
    if (outOfTime(ctx)) throw new OutOfTime();
    const { data: queue, error } = await ctx.admin.rpc("meta_ig_media_needing_comments", { p_workspace_id: ctx.workspaceId, p_limit: 40 });
    if (error) throw new Error(`Erro ao ler fila de comentários: ${error.message}`);
    const mine = ((queue ?? []) as { media_id: string; ig_user_id: string; comments_count: number }[]).filter((q) => q.ig_user_id === igId);
    if (!mine.length) break;

    let handled = 0;
    await pool(mine, 3, async (m) => {
      if (outOfTime(ctx)) return;
      const rows: Record<string, unknown>[] = [];
      let after: string | undefined;
      let failed = false;
      let aborted = false;
      for (let page = 0; page < 200; page++) {
        // Post com muitos comentários pode passar do orçamento; dá uma folga e, se não der, deixa na fila.
        if (Date.now() - ctx.startedAt > BUDGET_MS + 35_000) {
          aborted = true;
          break;
        }
        const r = await call(ctx, igId, "ig_comments", `/${m.media_id}/comments`, {
          fields: "id,text,timestamp,like_count,replies{id,text,timestamp,like_count}",
          limit: "50",
          ...(after ? { after } : {}),
        });
        if (!r.ok) {
          failed = true;
          break;
        }
        for (const c of r.data?.data ?? []) {
          rows.push({ workspace_id: ctx.workspaceId, ig_user_id: igId, comment_id: c.id, media_id: m.media_id, parent_id: null, text: c.text ?? null, commented_at: c.timestamp ?? null, like_count: num(c.like_count) });
          for (const rep of c.replies?.data ?? []) {
            rows.push({ workspace_id: ctx.workspaceId, ig_user_id: igId, comment_id: rep.id, media_id: m.media_id, parent_id: c.id, text: rep.text ?? null, commented_at: rep.timestamp ?? null, like_count: num(rep.like_count) });
          }
        }
        after = r.data?.paging?.next ? (r.data?.paging?.cursors?.after as string | undefined) : undefined;
        if (!after) break;
      }
      if (rows.length) await upsertBatches(ctx, "meta_ig_comments", rows, "workspace_id,comment_id");
      if (aborted) return;
      // Falha parcial: marca como lido mesmo assim pra não travar a fila (a contagem muda de novo se houver comentário novo).
      await ctx.admin
        .from("meta_ig_media")
        .update({ comments_synced_count: m.comments_count, comments_synced_at: new Date().toISOString() })
        .eq("workspace_id", ctx.workspaceId)
        .eq("media_id", m.media_id);
      handled++;
      count(rows.length);
      if (failed) await saveState(ctx, igId, "ig_comments", { last_error: `comentários de ${m.media_id} incompletos` });
    });
    await saveState(ctx, igId, "ig_comments", {}, handled);
  }
  await complete(ctx, igId, "ig_comments");
  return true;
}
