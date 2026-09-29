import { createClient } from "npm:@supabase/supabase-js@2";
import { logIntegrationCall } from "../_shared/integrationLog.ts";
import {
  acquireIuliLock,
  IuliError,
  type IuliCaller,
  IuliRateLimited,
  iuliLockedUntil,
  OutOfBudget,
  releasedTools,
  releaseIuliLock,
  retryingCaller,
} from "../_shared/iuliMcp.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// Tempo máximo de consultas por execução. O que não couber fica vencido e a
// próxima rodada (cron a cada 15 min ou o botão "Atualizar") continua.
const BUDGET_MS = 100_000;
// Teto de chamadas por execução — ver MAX_CALLS em sync-iuli-records (cota da IULI).
const MAX_CALLS = 30;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// deno-lint-ignore no-explicit-any
type Payload = any;
type Caller = IuliCaller;
// deno-lint-ignore no-explicit-any
interface JobEnv { admin: any; integrationId: string }

interface Job {
  key: string;
  tool: string;
  args: Record<string, unknown>;
  ttl: number;
  transform?: (payload: Payload) => Payload;
  // Pra consultas que precisam paginar (assinaturas): faz as chamadas e devolve o payload final.
  run?: (call: Caller, env: JobEnv) => Promise<Payload>;
}

// ---------------------------------------------------------------------------
// Datas — tudo no fuso de São Paulo, igual ao resto do Farol
// ---------------------------------------------------------------------------

function todaySP(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

function monthRange(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start_date: `${ym}-01`, end_date: `${ym}-${String(last).padStart(2, "0")}` };
}

// Mês corrente muda o tempo todo; o anterior ainda recebe baixa/ajuste; os
// fechados quase não mudam.
function monthTtl(offset: number) {
  if (offset >= 0) return HOUR;
  if (offset === -1) return 6 * HOUR;
  return 7 * DAY;
}

// ---------------------------------------------------------------------------
// Limpeza de payload — não guarda CPF/CNPJ nem listas que a tela não usa
// ---------------------------------------------------------------------------

const stripItems = ({ itens: _itens, ...rest }: Payload) => rest;

function salesSummary(p: Payload) {
  return {
    ...p,
    top_clientes: (p.top_clientes ?? []).map(({ documento: _doc, ...c }: Payload) => c),
  };
}

function receivable(p: Payload, keepItems = false) {
  const { itens, ...rest } = p;
  if (!keepItems) return rest;
  return {
    ...rest,
    itens: (itens ?? []).map((i: Payload) => ({
      id: i.id,
      description: i.description,
      status: i.status,
      due_date: i.due_date,
      competencia: i.competencia,
      valor: i.valor,
      empresa: i.empresa,
      tem_nf: i.tem_nf,
    })),
  };
}

// Assinaturas: agregadas a partir de iuli_subscriptions (que sync-iuli-records
// mantém atualizada), sem chamar a IULI — paginar tudo aqui estourava o teto de
// chamadas numa empresa com ~6 mil assinaturas. Enquanto a primeira carga das
// assinaturas daquela empresa não terminou, fica em espera (NotReady) pra não
// mostrar um total parcial como se fosse o final.
class NotReady extends Error {}

async function allSubscriptions(_call: Caller, env: JobEnv) {
  const { data: state } = await env.admin
    .from("iuli_sync_state")
    .select("total_expected")
    .eq("integration_id", env.integrationId)
    .eq("task", "subscriptions:full")
    .maybeSingle();
  const { count: stored } = await env.admin
    .from("iuli_subscriptions")
    .select("iuli_id", { count: "exact", head: true })
    .eq("integration_id", env.integrationId)
    .is("removed_at", null);
  // Pronto = o Farol já guardou pelo menos o total que a IULI informou.
  if (!state?.total_expected || Number(stored ?? 0) < Number(state.total_expected)) throw new NotReady();

  const items: Payload[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await env.admin
      .from("iuli_subscriptions")
      .select("iuli_id, status, ciclo, valor, valor_mensalizado, forma_pagamento, origem, criada_em, cliente, produto")
      .eq("integration_id", env.integrationId)
      .is("removed_at", null)
      .order("iuli_id")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    items.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  const group = (keyOf: (i: Payload) => string) => {
    const map = new Map<string, { key: string; qtd: number; valor_mensalizado: number; valor: number }>();
    for (const i of items) {
      const k = keyOf(i) || "(vazio)";
      const g = map.get(k) ?? { key: k, qtd: 0, valor_mensalizado: 0, valor: 0 };
      g.qtd += 1;
      g.valor_mensalizado += Number(i.valor_mensalizado ?? 0);
      g.valor += Number(i.valor ?? 0);
      map.set(k, g);
    }
    return [...map.values()].sort((a, b) => b.valor_mensalizado - a.valor_mensalizado);
  };

  // Mesmo formato do por_status da IULI (mrr = soma do valor mensalizado, regra da IULI).
  const porStatus = group((i) => String(i.status ?? "")).map((g) => ({
    status: g.key,
    qtd: g.qtd,
    valor_contratado_total: g.valor,
    mrr: g.valor_mensalizado,
  }));

  return {
    por_status: porStatus,
    total_encontrado: items.length,
    por_produto: group((i) => i.produto),
    por_ciclo: group((i) => i.ciclo),
    por_forma_pagamento: group((i) => String(i.forma_pagamento ?? "")),
    por_origem: group((i) => String(i.origem ?? "")),
    por_status_item: group((i) => String(i.status ?? "")),
    por_mes_criacao: group((i) => String(i.criada_em ?? "").slice(0, 7)).sort((a, b) => a.key.localeCompare(b.key)),
    recentes: [...items]
      .sort((a, b) => String(b.criada_em).localeCompare(String(a.criada_em)))
      .slice(0, 15)
      .map((i) => ({ id: i.iuli_id, cliente: i.cliente, produto: i.produto, valor: i.valor, ciclo: i.ciclo, status: i.status, criada_em: i.criada_em })),
  };
}

// ---------------------------------------------------------------------------
// Plano de consultas — a ordem é a prioridade quando o snapshot ainda não existe
// ---------------------------------------------------------------------------

function buildPlan(): Job[] {
  const today = todaySP();
  const ym = today.slice(0, 7);
  const jobs: Job[] = [];

  // Visão geral primeiro: é o que a tela inicial precisa.
  jobs.push({ key: "ar:overview", tool: "get_accounts_receivable", args: { status: "pending", limit: 10 }, ttl: HOUR, transform: (p) => receivable(p, true) });
  jobs.push({ key: "sales_month:" + ym, tool: "get_sales_summary", args: { ...monthRange(ym), limit: 10 }, ttl: HOUR, transform: salesSummary });
  jobs.push({ key: "sales_status_month:" + ym, tool: "list_sales", args: { ...monthRange(ym), limit: 1 }, ttl: HOUR, transform: stripItems });
  jobs.push({ key: "invoices:all", tool: "list_invoices", args: { limit: 1 }, ttl: HOUR, transform: stripItems });
  jobs.push({ key: "subscriptions:all", tool: "list_subscriptions", args: { fonte: "iuli_subscriptions" }, ttl: HOUR, run: allSubscriptions });
  jobs.push({ key: "charges:all", tool: "list_charges", args: { limit: 20 }, ttl: HOUR });

  // Contas a receber por mês de vencimento: 12 meses pra trás, 6 pra frente.
  for (let offset = -12; offset <= 6; offset++) {
    const m = addMonths(ym, offset);
    jobs.push({
      key: "ar_month:" + m,
      tool: "get_accounts_receivable",
      args: { status: "all", ...monthRange(m), limit: 1 },
      ttl: offset < -1 ? DAY : HOUR,
      transform: (p) => receivable(p),
    });
  }

  // Aging do que está sem baixa, por faixa de vencimento.
  const buckets: [string, string, string][] = [
    ["vencido_365_mais", "2000-01-01", addDays(today, -366)],
    ["vencido_181_365", addDays(today, -365), addDays(today, -181)],
    ["vencido_91_180", addDays(today, -180), addDays(today, -91)],
    ["vencido_31_90", addDays(today, -90), addDays(today, -31)],
    ["vencido_1_30", addDays(today, -30), addDays(today, -1)],
    ["a_vencer_0_30", today, addDays(today, 30)],
    ["a_vencer_31_90", addDays(today, 31), addDays(today, 90)],
    ["a_vencer_91_180", addDays(today, 91), addDays(today, 180)],
    ["a_vencer_180_mais", addDays(today, 181), "2099-12-31"],
  ];
  for (const [name, start_date, end_date] of buckets) {
    jobs.push({
      key: "ar_aging:" + name,
      tool: "get_accounts_receivable",
      args: { status: "pending", start_date, end_date, limit: 1 },
      ttl: HOUR,
      transform: (p) => receivable(p),
    });
  }

  jobs.push({ key: "invoices:denied", tool: "list_invoices", args: { status: "negada", limit: 20 }, ttl: HOUR });
  for (let offset = 0; offset >= -12; offset--) {
    const m = addMonths(ym, offset);
    jobs.push({ key: "invoices_month:" + m, tool: "list_invoices", args: { ...monthRange(m), limit: 1 }, ttl: monthTtl(offset), transform: stripItems });
  }

  jobs.push({ key: "projects", tool: "list_projects", args: {}, ttl: DAY });
  jobs.push({ key: "cost_centers", tool: "list_cost_centers", args: {}, ttl: DAY });
  jobs.push({ key: "products", tool: "list_products", args: { limit: 100 }, ttl: DAY });

  // Vendas: as consultas mais lentas da IULI (~5s cada) ficam por último.
  jobs.push({ key: "sales_status:all", tool: "list_sales", args: { limit: 1 }, ttl: 6 * HOUR, transform: stripItems });
  jobs.push({
    key: "sales_summary:12m",
    tool: "get_sales_summary",
    args: { start_date: monthRange(addMonths(ym, -11)).start_date, end_date: today, limit: 15 },
    ttl: 6 * HOUR,
    transform: salesSummary,
  });
  jobs.push({
    key: "sales_summary:ytd",
    tool: "get_sales_summary",
    args: { start_date: `${ym.slice(0, 4)}-01-01`, end_date: today, limit: 15 },
    ttl: 6 * HOUR,
    transform: salesSummary,
  });
  for (let offset = -1; offset >= -12; offset--) {
    const m = addMonths(ym, offset);
    jobs.push({ key: "sales_month:" + m, tool: "get_sales_summary", args: { ...monthRange(m), limit: 10 }, ttl: monthTtl(offset), transform: salesSummary });
    jobs.push({ key: "sales_status_month:" + m, tool: "list_sales", args: { ...monthRange(m), limit: 1 }, ttl: monthTtl(offset), transform: stripItems });
  }

  return jobs;
}

function runJob(call: Caller, job: Job, env: JobEnv): Promise<Payload> {
  return job.run ? job.run(call, env) : call(job.tool, job.args);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  const startedAt = Date.now();
  let workspaceId: string | null = null;
  let integrationId: string | null = null;
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const log = (params: { status: "success" | "error"; statusCode: number; response?: unknown; errorMessage?: string }) =>
    logIntegrationCall(admin, {
      workspaceId,
      integrationId,
      provider: "iuli",
      direction: "outbound",
      eventType: "sync",
      request: { integration_id: integrationId },
      durationMs: Date.now() - startedAt,
      ...params,
    });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      await log({ status: "error", statusCode: 401, errorMessage: "missing authorization" });
      return json({ error: "missing authorization" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const { integration_id, force } = body as { integration_id?: string; force?: boolean };
    if (!integration_id) {
      await log({ status: "error", statusCode: 400, errorMessage: "integration_id required" });
      return json({ error: "integration_id required" }, 400);
    }
    integrationId = integration_id;

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const internalToken = Deno.env.get("FAROL_INTERNAL_TOKEN");
    const bearer = authHeader.replace(/^Bearer\s+/i, "");
    const isTrustedInternalCall = !!internalToken && bearer === internalToken;

    const { data: integration, error: integrationError } = await admin
      .from("integrations")
      .select("id, workspace_id, config")
      .eq("id", integration_id)
      .eq("provider", "iuli")
      .single();
    if (integrationError || !integration) {
      await log({ status: "error", statusCode: 404, errorMessage: "integration not found" });
      return json({ error: "integration not found" }, 404);
    }
    workspaceId = integration.workspace_id;

    if (!isTrustedInternalCall) {
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData, error: userError } = await userClient.auth.getUser();
      if (userError || !userData.user) {
        await log({ status: "error", statusCode: 401, errorMessage: `invalid session: ${userError?.message ?? "sem usuário"}` });
        return json({ error: "invalid session" }, 401);
      }

      const { data: membership } = await admin
        .from("workspace_members")
        .select("id")
        .eq("workspace_id", integration.workspace_id)
        .eq("user_id", userData.user.id)
        .eq("is_active", true)
        .maybeSingle();
      if (!membership) {
        await log({ status: "error", statusCode: 403, errorMessage: "forbidden: usuário não é membro ativo do workspace" });
        return json({ error: "forbidden" }, 403);
      }
    }

    // Cron, botão "Atualizar" e sync-iuli-records não podem rodar juntos — a
    // IULI recusaria as consultas paralelas com 429.
    if (!(await acquireIuliLock(admin, integration_id, integration.workspace_id, BUDGET_MS + 60_000))) {
      return json({ busy: true, refreshed: 0, remaining: null, locked_until: await iuliLockedUntil(admin, integration_id) });
    }

    let pauseUntil: Date | undefined;
    const releaseLock = async (extra: Record<string, unknown> = {}) => {
      await releaseIuliLock(admin, integration_id, pauseUntil);
      if (Object.keys(extra).length) await admin.from("integrations").update(extra).eq("id", integration_id);
    };

    const { data: secret } = await admin
      .from("integration_secrets")
      .select("api_key")
      .eq("integration_id", integration_id)
      .maybeSingle();
    if (!secret) {
      await releaseLock();
      await log({ status: "error", statusCode: 400, errorMessage: "no api key saved" });
      return json({ error: "no api key saved" }, 400);
    }

    // Só o que o token desta empresa libera (ex: sem list_invoices, sem as consultas de notas).
    const tools = await releasedTools(admin, integration_id, secret.api_key, integration.config);
    const plan = buildPlan().filter((job) => !tools || tools.has(job.tool));
    const { data: existing } = await admin
      .from("iuli_snapshots")
      .select("key, expires_at, fetched_at")
      .eq("integration_id", integration_id);
    const byKey = new Map((existing ?? []).map((s) => [s.key, s]));

    // Prioridade: nunca buscado (na ordem do plano) → vencido há mais tempo.
    const now = Date.now();
    const pending = plan
      .map((job, order) => ({ job, order, snap: byKey.get(job.key) }))
      .filter(({ snap }) => force || !snap?.fetched_at || new Date(snap.expires_at).getTime() <= now)
      .sort((a, b) => {
        const aNew = !a.snap?.fetched_at, bNew = !b.snap?.fetched_at;
        if (aNew !== bNew) return aNew ? -1 : 1;
        if (aNew) return a.order - b.order;
        return new Date(a.snap!.expires_at).getTime() - new Date(b.snap!.expires_at).getTime();
      });

    const call = retryingCaller(secret.api_key, startedAt + BUDGET_MS, MAX_CALLS);
    let refreshed = 0;
    const errors: { key: string; error: string }[] = [];
    for (const { job } of pending) {
      if (Date.now() - startedAt > BUDGET_MS) break;
      const jobStarted = Date.now();
      const row = {
        workspace_id: integration.workspace_id,
        integration_id,
        key: job.key,
        tool: job.tool,
        args: job.args,
        updated_at: new Date().toISOString(),
      };
      try {
        const raw = await runJob(call, job, { admin, integrationId: integration_id });
        const payload = job.transform ? job.transform(raw) : raw;
        await admin.from("iuli_snapshots").upsert(
          {
            ...row,
            payload,
            error: null,
            fetched_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + job.ttl).toISOString(),
            duration_ms: Date.now() - jobStarted,
          },
          { onConflict: "integration_id,key" },
        );
        refreshed++;
      } catch (err) {
        if (err instanceof OutOfBudget) break;
        if (err instanceof NotReady) continue;
        if (err instanceof IuliRateLimited) {
          pauseUntil = new Date(Date.now() + err.waitMs);
          break;
        }
        const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
        errors.push({ key: job.key, error: message });
        // Mantém o payload anterior (se houver) e tenta de novo em 10 min.
        const prev = byKey.get(job.key);
        if (prev) {
          await admin
            .from("iuli_snapshots")
            .update({ error: message, expires_at: new Date(Date.now() + 10 * MINUTE).toISOString(), updated_at: row.updated_at })
            .eq("integration_id", integration_id)
            .eq("key", job.key);
        } else {
          await admin.from("iuli_snapshots").insert({ ...row, error: message, expires_at: new Date(Date.now() + 10 * MINUTE).toISOString() });
        }
        // Token inválido: não adianta seguir.
        if (err instanceof IuliError && (err.status === 401 || err.status === 403)) break;
      }
    }

    const remaining = pending.length - refreshed - errors.length;
    const allFailed = refreshed === 0 && errors.length > 0;
    await releaseLock(
      allFailed
        ? { status: "error", last_error: `${errors[0].key}: ${errors[0].error}` }
        : refreshed > 0
          ? { status: "connected", last_synced_at: new Date().toISOString(), last_error: null }
          : {},
    );

    const result = { refreshed, errors, remaining, planned: plan.length, paused_until: pauseUntil?.toISOString() ?? null };
    await log({
      status: allFailed ? "error" : "success",
      statusCode: 200,
      response: result,
      errorMessage: allFailed ? errors[0].error : undefined,
    });
    return json(result);
  } catch (err) {
    await log({ status: "error", statusCode: 500, errorMessage: String(err) });
    return json({ error: String(err) }, 500);
  }
});
