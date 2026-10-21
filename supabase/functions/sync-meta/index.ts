import { createClient } from "npm:@supabase/supabase-js@2";
import { logIntegrationCall } from "../_shared/integrationLog.ts";
import { authorizeMetaCall, CORS_HEADERS, discoverAssets, json } from "../_shared/metaGraph.ts";

// Fase 1: cadastra as contas de anúncio e os perfis de Instagram que o token
// alcança, marcando quais o usuário quer sincronizar. Os dados de campanhas,
// insights e posts entram nas fases seguintes, lendo só as contas `enabled`.
//
// body: { integration_id, ad_account_ids?: string[], ig_account_ids?: string[] }
// Sem as listas, mantém a seleção atual (contas novas entram habilitadas).
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
      eventType: "sync",
      request: { integration_id: integrationId },
      durationMs: Date.now() - startedAt,
      ...params,
    });
  };

  const markError = async (message: string) => {
    if (!admin || !integrationId) return;
    await admin
      .from("integrations")
      .update({ status: "error", last_error: message.slice(0, 500) })
      .eq("id", integrationId);
    await log({ status: "error", statusCode: 500, errorMessage: message });
  };

  try {
    const body = await req.json().catch(() => ({}));
    integrationId = body?.integration_id ?? null;
    if (!integrationId) return json({ error: "integration_id required" }, 400);

    const auth = await authorizeMetaCall(req, integrationId, async (status, message, ws) => {
      workspaceId = ws;
      admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      await log({ status: "error", statusCode: status, errorMessage: message });
    });
    if (auth instanceof Response) return auth;

    admin = auth.admin;
    workspaceId = auth.integration.workspace_id;
    const { token, version } = auth;

    const selectedAds: string[] | null = Array.isArray(body?.ad_account_ids) ? body.ad_account_ids : null;
    const selectedIgs: string[] | null = Array.isArray(body?.ig_account_ids) ? body.ig_account_ids : null;

    const assets = await discoverAssets(token, version);
    const authFailure = assets.probes["me/adaccounts"]?.ok === false && assets.probes["me/businesses"]?.ok === false;
    if (authFailure) {
      await markError(`Falha ao listar contas na Meta: ${assets.probes["me/adaccounts"].error}`);
      return json({ error: "falha ao listar contas" }, 502);
    }

    const now = new Date().toISOString();

    // Habilitação atual (pra preservar a escolha quando não vier lista nova)
    const { data: currentAds } = await admin
      .from("meta_ad_accounts")
      .select("account_id, enabled")
      .eq("workspace_id", workspaceId);
    const { data: currentIgs } = await admin
      .from("meta_ig_accounts")
      .select("ig_user_id, enabled")
      .eq("workspace_id", workspaceId);
    const adEnabled = new Map<string, boolean>((currentAds ?? []).map((r: { account_id: string; enabled: boolean }) => [r.account_id, r.enabled]));
    const igEnabled = new Map<string, boolean>((currentIgs ?? []).map((r: { ig_user_id: string; enabled: boolean }) => [r.ig_user_id, r.enabled]));

    const adRows = assets.adAccounts.map((a) => ({
      workspace_id: workspaceId,
      integration_id: integrationId,
      account_id: a.id,
      name: a.name ?? null,
      currency: a.currency ?? null,
      timezone_name: a.timezone_name ?? null,
      account_status: a.account_status ?? null,
      business_id: a.business?.id ?? null,
      business_name: a.business?.name ?? null,
      // amount_spent vem em centavos (menor unidade da moeda), como string
      amount_spent: a.amount_spent != null ? Number(a.amount_spent) / 100 : null,
      enabled: selectedAds ? selectedAds.includes(a.id) : (adEnabled.get(a.id) ?? true),
      raw_payload: a,
      updated_at: now,
    }));

    const igRows = assets.igAccounts.map((ig) => ({
      workspace_id: workspaceId,
      integration_id: integrationId,
      ig_user_id: ig.id,
      username: ig.username ?? null,
      name: ig.name ?? null,
      followers_count: ig.followers_count ?? null,
      follows_count: ig.follows_count ?? null,
      media_count: ig.media_count ?? null,
      profile_picture_url: ig.profile_picture_url ?? null,
      page_id: ig.page_id ?? null,
      page_name: ig.page_name ?? null,
      enabled: selectedIgs ? selectedIgs.includes(ig.id) : (igEnabled.get(ig.id) ?? true),
      raw_payload: ig,
      updated_at: now,
    }));

    if (adRows.length) {
      const { error } = await admin.from("meta_ad_accounts").upsert(adRows, { onConflict: "workspace_id,account_id" });
      if (error) {
        await markError(`Erro ao gravar contas de anúncio: ${error.message}`);
        return json({ error: error.message }, 500);
      }
    }
    if (igRows.length) {
      const { error } = await admin.from("meta_ig_accounts").upsert(igRows, { onConflict: "workspace_id,ig_user_id" });
      if (error) {
        await markError(`Erro ao gravar contas de Instagram: ${error.message}`);
        return json({ error: error.message }, 500);
      }
    }

    await admin
      .from("integrations")
      .update({ status: "connected", last_synced_at: now, last_error: null })
      .eq("id", integrationId);

    const summary = {
      ad_accounts: adRows.length,
      ad_accounts_enabled: adRows.filter((r) => r.enabled).length,
      ig_accounts: igRows.length,
      ig_accounts_enabled: igRows.filter((r) => r.enabled).length,
    };
    await log({ status: "success", statusCode: 200, response: summary });
    return json(summary);
  } catch (err) {
    await markError(String(err));
    return json({ error: String(err) }, 500);
  }
});
