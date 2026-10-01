import { createClient } from "npm:@supabase/supabase-js@2";
import { logIntegrationCall } from "../_shared/integrationLog.ts";
import { IuliError, iuliCallTool, iuliListTools } from "../_shared/iuliMcp.ts";

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

// Só as tools de leitura. O token é escopado por tool no painel da IULI; se
// alguém liberar uma tool de escrita, o diagnóstico lista mas nunca chama.
function isReadTool(name: string) {
  return name.startsWith("list_") || name.startsWith("get_");
}

// Algumas tools exigem período — usa o mês corrente pra caber numa chamada leve.
function probeArgs(required: string[] = []) {
  const now = new Date();
  const args: Record<string, unknown> = { limit: 1 };
  if (required.includes("start_date")) {
    args.start_date = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  }
  if (required.includes("end_date")) args.end_date = now.toISOString().slice(0, 10);
  return args;
}

// Cada tool devolve o total com um nome diferente; pega o primeiro que existir
// ou, na falta, o tamanho da primeira lista do payload. Nunca guarda o dado em
// si — é financeiro, o diagnóstico só precisa saber se tem registro.
function extractCount(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  for (const key of ["total_encontrado", "quantidade", "total"]) {
    if (typeof p[key] === "number") return p[key] as number;
  }
  const firstArray = Object.values(p).find(Array.isArray);
  return firstArray ? (firstArray as unknown[]).length : null;
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
      eventType: "diagnose",
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

    const { integration_id } = await req.json();
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

    const { data: secret, error: secretError } = await admin
      .from("integration_secrets")
      .select("api_key")
      .eq("integration_id", integration_id)
      .maybeSingle();
    if (secretError || !secret) {
      await log({ status: "error", statusCode: 400, errorMessage: "no api key saved" });
      return json({ error: "no api key saved" }, 400);
    }

    let tools;
    try {
      tools = await iuliListTools(secret.api_key);
    } catch (err) {
      const status = err instanceof IuliError ? err.status : null;
      const message = `HTTP ${status ?? "?"}: ${err instanceof Error ? err.message : String(err)}`;
      await admin.from("integrations").update({ status: "error", last_error: message }).eq("id", integration_id);
      await log({ status: "error", statusCode: status ?? 502, errorMessage: message });
      return json({ error: message }, 200);
    }

    // Em fila, nunca em paralelo: a IULI só aceita uma consulta em andamento
    // por empresa e devolve 429 ("Há consultas demais em andamento") pras outras.
    const results: Record<string, unknown> = {};
    for (const tool of tools.filter((t) => isReadTool(t.name))) {
      try {
        const payload = await iuliCallTool(secret.api_key, tool.name, probeArgs(tool.inputSchema?.required));
        results[tool.name] = { ok: true, total: extractCount(payload) };
      } catch (err) {
        results[tool.name] = {
          ok: false,
          status: err instanceof IuliError ? err.status : undefined,
          error: (err instanceof Error ? err.message : String(err)).slice(0, 300),
        };
      }
    }

    const anySuccess = Object.values(results).some((r) => (r as { ok: boolean }).ok);
    const firstError = Object.values(results).find((r) => !(r as { ok: boolean }).ok) as
      | { status?: number; error?: string }
      | undefined;

    await admin
      .from("integrations")
      .update({
        ...(anySuccess
          ? { status: "connected", last_synced_at: new Date().toISOString(), last_error: null }
          : {
              status: "error",
              last_error: firstError
                ? `HTTP ${firstError.status ?? "?"}: ${firstError.error ?? "erro desconhecido"}`
                : "O token não libera nenhuma função de leitura.",
            }),
        config: {
          ...integration.config,
          tools: tools.map((t) => t.name),
          tools_checked_at: new Date().toISOString(),
          last_diagnostics: results,
          last_diagnostics_at: new Date().toISOString(),
        },
      })
      .eq("id", integration_id);

    await log({
      status: anySuccess ? "success" : "error",
      statusCode: 200,
      response: { tools: tools.map((t) => t.name), results },
      errorMessage: anySuccess ? undefined : "Nenhuma função respondeu.",
    });
    return json({ tools: tools.map((t) => t.name), results });
  } catch (err) {
    await log({ status: "error", statusCode: 500, errorMessage: String(err) });
    return json({ error: String(err) }, 500);
  }
});
