import { createClient } from "npm:@supabase/supabase-js@2";

const ASAAS_BASE_URL: Record<string, string> = {
  sandbox: "https://api-sandbox.asaas.com/v3",
  production: "https://api.asaas.com/v3",
};

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

// Endpoints de listagem (paginados, resposta { data: [...], totalCount }) e
// endpoints de objeto único (resposta direta), pra sondar o que tem dado de verdade.
const LIST_ENDPOINTS = [
  { key: "customers", path: "/customers?limit=1" },
  { key: "payments", path: "/payments?limit=1" },
  { key: "subscriptions", path: "/subscriptions?limit=1" },
  { key: "installments", path: "/installments?limit=1" },
  { key: "transfers", path: "/transfers?limit=1" },
  { key: "anticipations", path: "/anticipations?limit=1" },
  { key: "pixAddressKeys", path: "/pix/addressKeys" },
];

const OBJECT_ENDPOINTS = [{ key: "financeBalance", path: "/finance/balance" }];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "missing authorization" }, 401);

    const { integration_id } = await req.json();
    if (!integration_id) return json({ error: "integration_id required" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ error: "invalid session" }, 401);

    const { data: integration, error: integrationError } = await admin
      .from("integrations")
      .select("id, workspace_id, config")
      .eq("id", integration_id)
      .single();
    if (integrationError || !integration) return json({ error: "integration not found" }, 404);

    const { data: membership } = await admin
      .from("workspace_members")
      .select("id")
      .eq("workspace_id", integration.workspace_id)
      .eq("user_id", userData.user.id)
      .eq("is_active", true)
      .maybeSingle();
    if (!membership) return json({ error: "forbidden" }, 403);

    const { data: secret, error: secretError } = await admin
      .from("integration_secrets")
      .select("api_key")
      .eq("integration_id", integration_id)
      .maybeSingle();
    if (secretError || !secret) return json({ error: "no api key saved" }, 400);

    const environment = integration.config?.environment === "production" ? "production" : "sandbox";
    const baseUrl = ASAAS_BASE_URL[environment];
    const headers = {
      access_token: secret.api_key,
      "User-Agent": "FarolID",
      "Content-Type": "application/json",
    };

    const results: Record<string, unknown> = {};

    await Promise.all(
      LIST_ENDPOINTS.map(async ({ key, path }) => {
        try {
          const res = await fetch(`${baseUrl}${path}`, { headers });
          if (!res.ok) {
            results[key] = { ok: false, status: res.status, error: (await res.text()).slice(0, 300) };
            return;
          }
          const body = await res.json();
          results[key] = {
            ok: true,
            totalCount: body.totalCount ?? (Array.isArray(body.data) ? body.data.length : null),
            sample: Array.isArray(body.data) ? body.data[0] ?? null : null,
          };
        } catch (err) {
          results[key] = { ok: false, error: String(err) };
        }
      }),
    );

    await Promise.all(
      OBJECT_ENDPOINTS.map(async ({ key, path }) => {
        try {
          const res = await fetch(`${baseUrl}${path}`, { headers });
          if (!res.ok) {
            results[key] = { ok: false, status: res.status, error: (await res.text()).slice(0, 300) };
            return;
          }
          results[key] = { ok: true, data: await res.json() };
        } catch (err) {
          results[key] = { ok: false, error: String(err) };
        }
      }),
    );

    // Guarda uma versão enxuta (sem amostra completa dos registros) pra
    // reaparecer ao reabrir a tela, sem precisar rodar de novo.
    const slimResults: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(results)) {
      const v = value as { ok: boolean; totalCount?: unknown; status?: number; error?: string };
      slimResults[key] = { ok: v.ok, totalCount: v.totalCount ?? null, status: v.status, error: v.error };
    }
    await admin
      .from("integrations")
      .update({
        config: {
          ...integration.config,
          last_diagnostics: slimResults,
          last_diagnostics_at: new Date().toISOString(),
        },
      })
      .eq("id", integration_id);

    return json({ environment, results });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
