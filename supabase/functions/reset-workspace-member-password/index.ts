import { createClient } from "npm:@supabase/supabase-js@2";
import { logIntegrationCall } from "../_shared/integrationLog.ts";
import { sendViaBrevo } from "../_shared/email-admin.ts";
import { generateTempPassword } from "../_shared/tempPassword.ts";

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
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const log = (params: { status: "success" | "error"; statusCode: number; response?: unknown; errorMessage?: string; request?: unknown }) =>
    logIntegrationCall(admin, {
      workspaceId,
      integrationId: null,
      provider: "brevo",
      direction: "outbound",
      eventType: "reset-workspace-member-password",
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
    const { workspace_id, user_id } = body ?? {};
    if (!workspace_id || !user_id) {
      await log({ status: "error", statusCode: 400, errorMessage: "payload inválido — confira workspace_id e user_id" });
      return json({ error: "payload inválido — confira workspace_id e user_id" }, 400);
    }
    workspaceId = workspace_id;

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) {
      await log({ status: "error", statusCode: 401, errorMessage: `invalid session: ${userError?.message ?? "sem usuário"}` });
      return json({ error: "invalid session" }, 401);
    }

    if (user_id === userData.user.id) {
      await log({ status: "error", statusCode: 400, errorMessage: "não é possível resetar a própria senha por aqui" });
      return json({ error: "Pra trocar a sua própria senha, use as configurações da sua conta." }, 400);
    }

    const { data: callerMembership } = await admin
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspace_id)
      .eq("user_id", userData.user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (!callerMembership || !["owner", "admin"].includes(callerMembership.role)) {
      await log({ status: "error", statusCode: 403, errorMessage: "forbidden: só owner/admin do workspace pode resetar senha" });
      return json({ error: "forbidden" }, 403);
    }

    const { data: targetMembership } = await admin
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspace_id)
      .eq("user_id", user_id)
      .eq("is_active", true)
      .maybeSingle();

    if (!targetMembership) {
      await log({ status: "error", statusCode: 404, errorMessage: "membro não encontrado neste workspace" });
      return json({ error: "Membro não encontrado neste workspace." }, 404);
    }

    // Guarda contra escalada: ninguém reseta a senha do owner por aqui, e um
    // admin não reseta a senha de outro admin (só o owner pode).
    if (targetMembership.role === "owner") {
      await log({ status: "error", statusCode: 403, errorMessage: "não é possível resetar a senha do proprietário do workspace" });
      return json({ error: "Não é possível resetar a senha do proprietário do workspace." }, 403);
    }
    if (targetMembership.role === "admin" && callerMembership.role !== "owner") {
      await log({ status: "error", statusCode: 403, errorMessage: "só o proprietário pode resetar a senha de um admin" });
      return json({ error: "Só o proprietário do workspace pode resetar a senha de um admin." }, 403);
    }

    const { data: targetUser, error: targetUserError } = await admin.auth.admin.getUserById(user_id);
    if (targetUserError || !targetUser?.user?.email) {
      await log({ status: "error", statusCode: 404, errorMessage: "usuário não encontrado" });
      return json({ error: "Usuário não encontrado." }, 404);
    }

    const temporaryPassword = generateTempPassword();
    const { error: updateError } = await admin.auth.admin.updateUserById(user_id, { password: temporaryPassword });
    if (updateError) {
      await log({ status: "error", statusCode: 500, errorMessage: updateError.message });
      return json({ error: updateError.message }, 500);
    }

    await admin.from("profiles").update({ must_change_password: true }).eq("id", user_id);

    const fullName = (targetUser.user.user_metadata?.full_name as string | undefined) ?? targetUser.user.email;
    const loginUrl = req.headers.get("origin") ?? Deno.env.get("APP_URL") ?? "http://localhost:8095";

    const emailResult = await sendViaBrevo({
      admin,
      workspaceId: workspace_id,
      toEmail: targetUser.user.email,
      toName: fullName,
      templateKey: "password-reset",
      variables: {
        name: fullName,
        email: targetUser.user.email,
        temporaryPassword,
        loginUrl: `${loginUrl}/auth`,
      },
    });

    await log({ status: "success", statusCode: 200, response: { user_id, email_sent: emailResult.ok } });

    return json({
      temporary_password: temporaryPassword,
      email_sent: emailResult.ok,
      email_error: emailResult.ok ? undefined : emailResult.error,
    });
  } catch (err) {
    const message = String(err instanceof Error ? err.message : err);
    await log({ status: "error", statusCode: 500, errorMessage: message });
    return json({ error: message }, 500);
  }
});
