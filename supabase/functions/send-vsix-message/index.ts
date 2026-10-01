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

const BASE_URL_BY_ENV: Record<string, string> = {
  dev: "https://dev.vsix.ia.br/api/v1",
  prod: "https://www.vsix.ia.br/api/v1",
};

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

  const log = (params: { status: "success" | "error"; statusCode: number; response?: unknown; errorMessage?: string; request?: unknown }) =>
    logIntegrationCall(admin, {
      workspaceId,
      integrationId,
      provider: "vsix",
      direction: "outbound",
      eventType: "send-message",
      durationMs: Date.now() - startedAt,
      ...params,
    });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      await log({ status: "error", statusCode: 401, errorMessage: "missing authorization" });
      return json({ error: "missing authorization" }, 401);
    }

    const body = await req.json();
    const { integration_id, to, text, template, idempotency_key } = body ?? {};
    const type = body?.type === "template" ? "template" : "text";

    if (!integration_id || !to?.type || !to?.value || (type === "text" && !text) || (type === "template" && !template?.name)) {
      await log({ status: "error", statusCode: 400, errorMessage: "payload inválido — confira integration_id, to e text/template" });
      return json({ error: "payload inválido — confira integration_id, to e text/template" }, 400);
    }
    integrationId = integration_id;

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) {
      await log({ status: "error", statusCode: 401, errorMessage: `invalid session: ${userError?.message ?? "sem usuário"}` });
      return json({ error: "invalid session" }, 401);
    }

    const { data: integration, error: integrationError } = await admin
      .from("integrations")
      .select("id, workspace_id, config")
      .eq("id", integration_id)
      .eq("provider", "vsix")
      .maybeSingle();
    if (integrationError || !integration) {
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
      await log({ status: "error", statusCode: 403, errorMessage: "forbidden: usuário não é membro ativo do workspace" });
      return json({ error: "forbidden" }, 403);
    }

    const instanceId = integration.config?.instance_id;
    if (!instanceId) {
      await log({ status: "error", statusCode: 400, errorMessage: "instance_id não configurado na integração" });
      return json({ error: "Configure o ID da instância de WhatsApp na integração antes de enviar." }, 400);
    }

    const environment = integration.config?.environment === "prod" ? "prod" : "dev";
    const baseUrl = BASE_URL_BY_ENV[environment];

    const { data: secret } = await admin
      .from("integration_secrets")
      .select("api_key")
      .eq("integration_id", integration_id)
      .maybeSingle();
    if (!secret) {
      await log({ status: "error", statusCode: 400, errorMessage: "no api key saved" });
      return json({ error: "Chave da API do VSIX não encontrada." }, 400);
    }

    const requestBody =
      type === "template"
        ? { instance_id: instanceId, to, type: "template", template }
        : { instance_id: instanceId, to, type: "text", text };

    const res = await fetch(`${baseUrl}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret.api_key}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotency_key || crypto.randomUUID(),
      },
      body: JSON.stringify(requestBody),
    });

    const responseBody = await res.json().catch(() => ({}));

    if (!res.ok) {
      await log({
        status: "error",
        statusCode: res.status,
        request: requestBody,
        response: responseBody,
        errorMessage: responseBody?.error?.message ?? `VSIX respondeu ${res.status}`,
      });
      return json({ error: responseBody?.error ?? { message: `VSIX respondeu ${res.status}` } }, res.status);
    }

    await admin
      .from("integrations")
      .update({ status: "connected", last_synced_at: new Date().toISOString(), last_error: null })
      .eq("id", integration_id);

    await log({ status: "success", statusCode: 200, request: requestBody, response: responseBody });
    return json(responseBody);
  } catch (err) {
    const message = String(err instanceof Error ? err.message : err);
    if (integrationId) {
      await admin.from("integrations").update({ status: "error", last_error: message }).eq("id", integrationId);
    }
    await log({ status: "error", statusCode: 500, errorMessage: message });
    return json({ error: message }, 500);
  }
});
