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

const ASSIGNABLE_ROLES = ["admin", "manager", "vendedor"] as const;
type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

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
      eventType: "create-team-member",
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
    const { workspace_id, email, full_name, role } = body ?? {};

    if (!workspace_id || !email || !full_name || !ASSIGNABLE_ROLES.includes(role)) {
      await log({
        status: "error",
        statusCode: 400,
        errorMessage: "payload inválido — confira workspace_id, email, full_name e role (admin/manager/vendedor)",
      });
      return json({ error: "payload inválido — confira workspace_id, email, full_name e role (admin/manager/vendedor)" }, 400);
    }
    workspaceId = workspace_id;

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) {
      await log({ status: "error", statusCode: 401, errorMessage: `invalid session: ${userError?.message ?? "sem usuário"}` });
      return json({ error: "invalid session" }, 401);
    }

    const { data: callerMembership } = await admin
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspace_id)
      .eq("user_id", userData.user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (!callerMembership || !["owner", "admin"].includes(callerMembership.role)) {
      await log({ status: "error", statusCode: 403, errorMessage: "forbidden: só owner/admin do workspace pode cadastrar usuários" });
      return json({ error: "forbidden" }, 403);
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const temporaryPassword = generateTempPassword();

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: normalizedEmail,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: { full_name },
    });

    if (createError || !created?.user) {
      const isDuplicate = /already.*registered|already.*exists/i.test(createError?.message ?? "");
      const message = isDuplicate
        ? "Já existe uma conta com esse e-mail no Farol ID."
        : createError?.message ?? "Falha ao criar o usuário.";
      await log({ status: "error", statusCode: isDuplicate ? 409 : 500, errorMessage: message });
      return json({ error: message }, isDuplicate ? 409 : 500);
    }

    const newUserId = created.user.id;

    const { error: profileError } = await admin
      .from("profiles")
      .update({ full_name, must_change_password: true })
      .eq("id", newUserId);
    if (profileError) {
      // Não bloqueia o cadastro por causa disso — o trigger já cria o profile
      // com o full_name; only must_change_password ficaria pendente aqui.
      console.error("[create-team-member-with-password] falha ao marcar must_change_password", profileError);
    }

    const { error: memberError } = await admin.from("workspace_members").insert({
      workspace_id,
      user_id: newUserId,
      role: role as AssignableRole,
      invited_by: userData.user.id,
      joined_at: new Date().toISOString(),
    });

    if (memberError) {
      // Rollback best-effort: não deixa um usuário órfão (sem vínculo com workspace nenhum).
      await admin.auth.admin.deleteUser(newUserId).catch(() => {});
      await log({ status: "error", statusCode: 500, errorMessage: `falha ao vincular ao workspace: ${memberError.message}` });
      return json({ error: `Falha ao vincular ao workspace: ${memberError.message}` }, 500);
    }

    const loginUrl = req.headers.get("origin") ?? Deno.env.get("APP_URL") ?? "http://localhost:8095";
    const emailResult = await sendViaBrevo({
      admin,
      workspaceId: workspace_id,
      toEmail: normalizedEmail,
      toName: full_name,
      templateKey: "welcome-team-member",
      variables: {
        name: full_name,
        email: normalizedEmail,
        temporaryPassword,
        loginUrl: `${loginUrl}/auth`,
      },
    });

    await log({
      status: "success",
      statusCode: 200,
      response: { user_id: newUserId, email_sent: emailResult.ok },
    });

    return json({
      user_id: newUserId,
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
