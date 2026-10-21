import { logIntegrationCall } from "../_shared/integrationLog.ts";
import {
  authorizeMetaCall,
  CORS_HEADERS,
  discoverAssets,
  graphGet,
  graphGetAll,
  json,
} from "../_shared/metaGraph.ts";

// Fase 0: mostra o que o token da Meta alcança — tipo/validade, permissões,
// contas de anúncio e perfis de Instagram — pra decidir o que dá pra sincronizar.
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
      eventType: "diagnose",
      request: { integration_id: integrationId },
      durationMs: Date.now() - startedAt,
      ...params,
    });
  };

  try {
    const body = await req.json().catch(() => ({}));
    integrationId = body?.integration_id ?? null;
    if (!integrationId) return json({ error: "integration_id required" }, 400);

    const auth = await authorizeMetaCall(req, integrationId, async (status, message, ws) => {
      workspaceId = ws;
      // admin ainda não existe se falhou antes; cria só pro log
      const { createClient } = await import("npm:@supabase/supabase-js@2");
      admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      await log({ status: "error", statusCode: status, errorMessage: message });
    });
    if (auth instanceof Response) return auth;

    admin = auth.admin;
    workspaceId = auth.integration.workspace_id;
    const { token, version } = auth;

    const [me, perms, debug] = await Promise.all([
      graphGet("/me", token, version, { fields: "id,name" }),
      graphGetAll("/me/permissions", token, version),
      graphGet("/debug_token", token, version, { input_token: token }),
    ]);

    if (!me.ok) {
      const msg = `Token recusado pela Meta: ${me.error}`;
      await admin
        .from("integrations")
        .update({ status: "error", last_error: msg.slice(0, 500) })
        .eq("id", integrationId);
      await log({ status: "error", statusCode: me.status || 400, errorMessage: msg });
      return json({ error: msg }, 400);
    }

    const assets = await discoverAssets(token, version);

    const tokenInfo = debug.ok
      ? {
          type: debug.data?.data?.type ?? null,
          app_id: debug.data?.data?.app_id ?? null,
          application: debug.data?.data?.application ?? null,
          is_valid: debug.data?.data?.is_valid ?? null,
          // 0 = não expira (System User)
          expires_at: debug.data?.data?.expires_at ?? null,
          data_access_expires_at: debug.data?.data?.data_access_expires_at ?? null,
          scopes: debug.data?.data?.scopes ?? [],
        }
      : { error: debug.error };

    const permissions = perms.ok
      ? (perms.data ?? []).map((p: { permission: string; status: string }) => ({ permission: p.permission, status: p.status }))
      : [];

    const adAccounts = assets.adAccounts.map((a) => ({
      account_id: a.id,
      name: a.name ?? null,
      currency: a.currency ?? null,
      account_status: a.account_status ?? null,
      business_name: a.business?.name ?? null,
    }));
    const igAccounts = assets.igAccounts.map((ig) => ({
      ig_user_id: ig.id,
      username: ig.username ?? null,
      name: ig.name ?? null,
      followers_count: ig.followers_count ?? null,
      page_name: ig.page_name ?? null,
    }));

    const result = {
      api_version: version,
      me: me.data,
      token: tokenInfo,
      permissions,
      probes: assets.probes,
      ad_accounts: adAccounts,
      ig_accounts: igAccounts,
    };

    await admin
      .from("integrations")
      .update({
        config: {
          ...auth.integration.config,
          last_diagnostics: {
            ad_accounts: { ok: true, total: adAccounts.length },
            ig_accounts: { ok: true, total: igAccounts.length },
          },
          last_diagnostics_at: new Date().toISOString(),
        },
      })
      .eq("id", integrationId);

    await log({
      status: "success",
      statusCode: 200,
      response: { token: tokenInfo, permissions: permissions.length, ad_accounts: adAccounts.length, ig_accounts: igAccounts.length, probes: assets.probes },
    });
    return json(result);
  } catch (err) {
    await log({ status: "error", statusCode: 500, errorMessage: String(err) });
    return json({ error: String(err) }, 500);
  }
});
