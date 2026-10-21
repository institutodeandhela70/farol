import { createClient } from "npm:@supabase/supabase-js@2";

export const DEFAULT_API_VERSION = "v23.0";

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// deno-lint-ignore no-explicit-any
export type Json = any;

export interface GraphResult<T = Json> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

function describeError(body: Json, fallback: string) {
  const e = body?.error;
  if (!e) return fallback;
  return `${e.message ?? fallback}${e.code ? ` (code ${e.code}${e.error_subcode ? `/${e.error_subcode}` : ""})` : ""}`;
}

/** GET único na Graph API. Nunca lança: devolve { ok:false, error } pro diagnóstico mostrar o motivo. */
export async function graphGet(
  path: string,
  token: string,
  version: string,
  params: Record<string, string> = {},
): Promise<GraphResult> {
  const url = new URL(`https://graph.facebook.com/${version}${path.startsWith("/") ? path : `/${path}`}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token);
  try {
    const res = await fetch(url);
    const body = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, status: res.status, error: describeError(body, `HTTP ${res.status}`) };
    return { ok: true, status: res.status, data: body };
  } catch (err) {
    return { ok: false, status: 0, error: String(err) };
  }
}

/** Segue paging.next até maxPages; devolve todos os itens de data[]. */
export async function graphGetAll(
  path: string,
  token: string,
  version: string,
  params: Record<string, string> = {},
  maxPages = 20,
): Promise<GraphResult<Json[]>> {
  const items: Json[] = [];
  const first = await graphGet(path, token, version, { limit: "100", ...params });
  if (!first.ok) return { ok: false, status: first.status, error: first.error };
  let page = first.data;
  for (let i = 0; i < maxPages; i++) {
    if (Array.isArray(page?.data)) items.push(...page.data);
    const next = page?.paging?.next;
    if (!next) break;
    try {
      const res = await fetch(next);
      const body = await res.json().catch(() => null);
      if (!res.ok) return { ok: false, status: res.status, error: describeError(body, `HTTP ${res.status}`), data: items };
      page = body;
    } catch (err) {
      return { ok: false, status: 0, error: String(err), data: items };
    }
  }
  return { ok: true, status: 200, data: items };
}

export interface AuthorizedMetaCall {
  // deno-lint-ignore no-explicit-any
  admin: any;
  integration: { id: string; workspace_id: string; config: Record<string, unknown> };
  token: string;
  version: string;
}

/**
 * Autentica a chamada (sessão de usuário membro do workspace OU token interno do cron),
 * carrega a integração e o token. Devolve uma Response em caso de falha.
 */
export async function authorizeMetaCall(
  req: Request,
  integrationId: string,
  onFail: (status: number, message: string, workspaceId: string | null) => Promise<void>,
): Promise<AuthorizedMetaCall | Response> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const fail = async (status: number, message: string, workspaceId: string | null = null) => {
    await onFail(status, message, workspaceId);
    return json({ error: message }, status);
  };

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return fail(401, "missing authorization");

  const { data: integration } = await admin
    .from("integrations")
    .select("id, workspace_id, provider, config")
    .eq("id", integrationId)
    .maybeSingle();
  if (!integration || integration.provider !== "meta") return fail(404, "integration not found");

  const internalToken = Deno.env.get("FAROL_INTERNAL_TOKEN");
  const isTrusted = !!internalToken && authHeader.replace(/^Bearer\s+/i, "") === internalToken;
  if (!isTrusted) {
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return fail(401, "invalid session", integration.workspace_id);
    const { data: membership } = await admin
      .from("workspace_members")
      .select("id")
      .eq("workspace_id", integration.workspace_id)
      .eq("user_id", userData.user.id)
      .eq("is_active", true)
      .maybeSingle();
    if (!membership) return fail(403, "forbidden: usuário não é membro ativo do workspace", integration.workspace_id);
  }

  const { data: secret } = await admin
    .from("integration_secrets")
    .select("api_key")
    .eq("integration_id", integrationId)
    .maybeSingle();
  if (!secret?.api_key) return fail(400, "no token saved", integration.workspace_id);

  const config = (integration.config ?? {}) as Record<string, unknown>;
  return {
    admin,
    integration: { id: integration.id, workspace_id: integration.workspace_id, config },
    token: secret.api_key,
    version: (config.api_version as string) || DEFAULT_API_VERSION,
  };
}

/**
 * Descobre tudo que o token alcança: contas de anúncio (diretas + via Business) e
 * contas de Instagram (via Páginas e via contas de anúncio). Cada sonda registra
 * ok/erro pra o diagnóstico mostrar o que o token consegue ou não ver.
 */
export const AD_ACCOUNT_FIELDS = "account_id,name,currency,timezone_name,account_status,amount_spent,business{id,name}";
export const IG_FIELDS = "id,username,name,followers_count,follows_count,media_count,profile_picture_url";

export async function discoverAssets(token: string, version: string) {
  const probes: Record<string, { ok: boolean; count?: number; error?: string }> = {};
  const adAccounts = new Map<string, Json>();
  const igAccounts = new Map<string, Json>();

  const record = (key: string, r: GraphResult<Json[]>) => {
    probes[key] = r.ok ? { ok: true, count: r.data?.length ?? 0 } : { ok: false, error: r.error };
  };

  const addAd = (a: Json, business?: Json) => {
    if (!a?.id) return;
    const id = a.id.startsWith("act_") ? a.id : `act_${a.account_id ?? a.id}`;
    const prev = adAccounts.get(id) ?? {};
    adAccounts.set(id, { ...prev, ...a, id, business: a.business ?? business ?? prev.business });
  };
  const addIg = (ig: Json, page?: Json) => {
    if (!ig?.id) return;
    const prev = igAccounts.get(ig.id) ?? {};
    igAccounts.set(ig.id, { ...prev, ...ig, page_id: page?.id ?? prev.page_id, page_name: page?.name ?? prev.page_name });
  };

  // Contas de anúncio diretas
  for (const [key, path] of [
    ["me/adaccounts", "/me/adaccounts"],
    ["me/assigned_ad_accounts", "/me/assigned_ad_accounts"],
  ] as const) {
    const r = await graphGetAll(path, token, version, { fields: AD_ACCOUNT_FIELDS });
    record(key, r);
    r.data?.forEach((a) => addAd(a));
  }

  // Businesses → contas de anúncio e páginas
  const biz = await graphGetAll("/me/businesses", token, version, { fields: "id,name" });
  record("me/businesses", biz);
  const pages = new Map<string, Json>();

  for (const [key, path] of [
    ["me/accounts", "/me/accounts"],
    ["me/assigned_pages", "/me/assigned_pages"],
  ] as const) {
    const r = await graphGetAll(path, token, version, { fields: "id,name" });
    record(key, r);
    r.data?.forEach((p) => pages.set(p.id, p));
  }

  for (const b of biz.data ?? []) {
    for (const edge of ["owned_ad_accounts", "client_ad_accounts"] as const) {
      const r = await graphGetAll(`/${b.id}/${edge}`, token, version, { fields: AD_ACCOUNT_FIELDS });
      record(`${b.name ?? b.id}/${edge}`, r);
      r.data?.forEach((a) => addAd(a, b));
    }
    for (const edge of ["owned_pages", "client_pages"] as const) {
      const r = await graphGetAll(`/${b.id}/${edge}`, token, version, { fields: "id,name" });
      record(`${b.name ?? b.id}/${edge}`, r);
      r.data?.forEach((p) => pages.set(p.id, p));
    }
    const igBiz = await graphGetAll(`/${b.id}/instagram_accounts`, token, version, { fields: IG_FIELDS });
    record(`${b.name ?? b.id}/instagram_accounts`, igBiz);
    igBiz.data?.forEach((ig) => addIg(ig));
  }

  // Páginas → Instagram profissional vinculado
  for (const p of pages.values()) {
    const r = await graphGet(`/${p.id}`, token, version, {
      fields: `instagram_business_account{${IG_FIELDS}}`,
    });
    probes[`page ${p.name ?? p.id}/instagram_business_account`] = r.ok
      ? { ok: true, count: r.data?.instagram_business_account ? 1 : 0 }
      : { ok: false, error: r.error };
    if (r.ok && r.data?.instagram_business_account) addIg(r.data.instagram_business_account, p);
  }

  return {
    probes,
    adAccounts: [...adAccounts.values()],
    igAccounts: [...igAccounts.values()],
    pages: [...pages.values()],
  };
}
