import { createClient } from "npm:@supabase/supabase-js@2";
import { logIntegrationCall } from "../_shared/integrationLog.ts";

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

const TIME_BUDGET_MS = 45_000;
const BATCH_SIZE = 100;

async function hubspotFetch(url: string, init?: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, init);
    if (res.status !== 429 || attempt >= 4) return res;
    await res.body?.cancel();
    const retryAfter = Number(res.headers.get("Retry-After"));
    const waitMs = retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

// Preenche hubspot_deals.contact_ids pros negócios que já existiam antes da
// sincronização de associações negócio↔contato ter sido ligada no sync-hubspot
// normal (esse aqui roda uma vez só, pra destravar o histórico; dali em diante
// o sync-hubspot incremental já mantém contact_ids em dia sozinho). Idempotente
// e retomável: só pega quem ainda está com contact_ids vazio, uma página de
// cada vez, então pode ser chamado de novo até não sobrar nada.
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
      provider: "hubspot",
      direction: "outbound",
      eventType: "backfill-deal-contacts",
      durationMs: Date.now() - startedAt,
      ...params,
    });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      await log({ status: "error", statusCode: 401, errorMessage: "missing authorization" });
      return json({ error: "missing authorization" }, 401);
    }

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) {
      await log({ status: "error", statusCode: 401, errorMessage: `invalid session: ${userError?.message ?? "sem usuário"}` });
      return json({ error: "invalid session" }, 401);
    }

    const { integration_id } = await req.json();
    if (!integration_id) {
      await log({ status: "error", statusCode: 400, errorMessage: "integration_id required" });
      return json({ error: "integration_id required" }, 400);
    }
    integrationId = integration_id;

    const { data: integration } = await admin
      .from("integrations")
      .select("id, workspace_id")
      .eq("id", integration_id)
      .eq("provider", "hubspot")
      .maybeSingle();
    if (!integration) {
      await log({ status: "error", statusCode: 404, errorMessage: "integration not found" });
      return json({ error: "integration not found" }, 404);
    }
    workspaceId = integration.workspace_id;

    const { data: membership } = await admin
      .from("workspace_members")
      .select("id")
      .eq("workspace_id", integration.workspace_id)
      .eq("user_id", userData.user.id)
      .eq("is_active", true)
      .maybeSingle();
    if (!membership) {
      await log({ status: "error", statusCode: 403, errorMessage: "forbidden" });
      return json({ error: "forbidden" }, 403);
    }

    const { data: secret } = await admin
      .from("integration_secrets")
      .select("api_key")
      .eq("integration_id", integration_id)
      .maybeSingle();
    if (!secret) {
      await log({ status: "error", statusCode: 400, errorMessage: "no api key saved" });
      return json({ error: "no api key saved" }, 400);
    }

    const headers = { Authorization: `Bearer ${secret.api_key}`, "Content-Type": "application/json" };

    let totalUpdated = 0;
    let lastError: string | null = null;

    while (Date.now() - startedAt < TIME_BUDGET_MS) {
      const { data: rows, error: selectError } = await admin
        .from("hubspot_deals")
        .select("id, hubspot_id")
        .eq("workspace_id", workspaceId)
        .eq("contact_ids", "{}")
        .limit(BATCH_SIZE);
      if (selectError) {
        lastError = `select: ${selectError.message}`;
        break;
      }
      if (!rows || rows.length === 0) break;

      const res = await hubspotFetch("https://api.hubapi.com/crm/v4/associations/deals/contacts/batch/read", {
        method: "POST",
        headers,
        body: JSON.stringify({ inputs: rows.map((r) => ({ id: r.hubspot_id })) }),
      });
      if (!res.ok) {
        lastError = `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`;
        break;
      }
      const body = await res.json();
      const results: { from: { id: string }; to: { toObjectId: number }[] }[] = body.results ?? [];
      const contactsByHubspotId = new Map<string, string[]>();
      for (const r of results) {
        contactsByHubspotId.set(r.from.id, (r.to ?? []).map((t) => String(t.toObjectId)));
      }

      // Negócio sem nenhum contato associado também precisa ser marcado (com um
      // array vazio não distinguível de "ainda não processado" — usa um valor
      // sentinela: um contact_id inválido "-" só pra sair do filtro contact_ids='{}').
      const updates = rows.map((row) => {
        const found = contactsByHubspotId.get(row.hubspot_id);
        return { id: row.id, contact_ids: found && found.length > 0 ? found : ["-"] };
      });
      const { data: updatedCount, error: rpcError } = await admin.rpc("bulk_set_deal_contact_ids", {
        p_workspace_id: workspaceId,
        p_updates: updates,
      });
      if (rpcError) {
        lastError = `bulk update: ${rpcError.message}`;
        break;
      }
      totalUpdated += updatedCount ?? 0;
    }

    await log({ status: lastError ? "error" : "success", statusCode: 200, response: { updated: totalUpdated }, errorMessage: lastError ?? undefined });
    return json({ updated: totalUpdated, error: lastError });
  } catch (err) {
    await log({ status: "error", statusCode: 500, errorMessage: String(err) });
    return json({ error: String(err) }, 500);
  }
});
