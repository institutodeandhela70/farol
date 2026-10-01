import { createClient } from "npm:@supabase/supabase-js@2";
import { logIntegrationCall } from "../_shared/integrationLog.ts";
import { sendViaBrevo } from "../_shared/email-admin.ts";

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
      provider: "brevo",
      direction: "outbound",
      eventType: "send-test-email",
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
    const { integration_id, to_email } = body ?? {};
    if (!integration_id || !to_email) {
      await log({ status: "error", statusCode: 400, errorMessage: "payload inválido — confira integration_id e to_email" });
      return json({ error: "payload inválido — confira integration_id e to_email" }, 400);
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
      .select("id, workspace_id, workspace:workspaces(name)")
      .eq("id", integration_id)
      .eq("provider", "brevo")
      .maybeSingle();
    if (integrationError || !integration) {
      await log({ status: "error", statusCode: 404, errorMessage: "integration not found" });
      return json({ error: "integration not found" }, 404);
    }
    workspaceId = integration.workspace_id;

    const { data: membership } = await admin
      .from("workspace_members")
      .select("id, role")
      .eq("workspace_id", integration.workspace_id)
      .eq("user_id", userData.user.id)
      .eq("is_active", true)
      .maybeSingle();
    if (!membership || !["owner", "admin"].includes(membership.role)) {
      await log({ status: "error", statusCode: 403, errorMessage: "forbidden: só owner/admin do workspace pode testar o envio" });
      return json({ error: "forbidden" }, 403);
    }

    const result = await sendViaBrevo({
      admin,
      workspaceId: integration.workspace_id,
      toEmail: to_email,
      templateKey: "integration-test",
      variables: {
        sentAt: new Date().toLocaleString("pt-BR"),
        workspaceName: integration.workspace?.name ?? "",
      },
    });

    if (!result.ok) {
      await admin.from("integrations").update({ status: "error", last_error: result.error }).eq("id", integration_id);
      await log({ status: "error", statusCode: 502, errorMessage: result.error });
      return json({ error: result.error }, 502);
    }

    await admin
      .from("integrations")
      .update({ status: "connected", last_synced_at: new Date().toISOString(), last_error: null })
      .eq("id", integration_id);

    await log({ status: "success", statusCode: 200, response: { to_email } });
    return json({ ok: true });
  } catch (err) {
    const message = String(err instanceof Error ? err.message : err);
    if (integrationId) {
      await admin.from("integrations").update({ status: "error", last_error: message }).eq("id", integrationId);
    }
    await log({ status: "error", statusCode: 500, errorMessage: message });
    return json({ error: message }, 500);
  }
});
