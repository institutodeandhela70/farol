import { createClient } from "npm:@supabase/supabase-js@2";

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

// Objetos padrão do CRM da HubSpot que checamos via /search (que devolve
// "total" sem precisar paginar tudo, diferente do /objects simples).
const OBJECT_TYPES = ["contacts", "companies", "deals", "tickets", "calls", "emails", "meetings", "tasks", "notes"];

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

    const headers = {
      Authorization: `Bearer ${secret.api_key}`,
      "Content-Type": "application/json",
    };

    const results: Record<string, unknown> = {};

    await Promise.all(
      OBJECT_TYPES.map(async (objectType) => {
        try {
          const res = await fetch(`https://api.hubapi.com/crm/v3/objects/${objectType}/search`, {
            method: "POST",
            headers,
            body: JSON.stringify({ limit: 1, filterGroups: [] }),
          });
          if (!res.ok) {
            results[objectType] = { ok: false, status: res.status, error: (await res.text()).slice(0, 300) };
            return;
          }
          const body = await res.json();
          results[objectType] = {
            ok: true,
            total: body.total ?? null,
            sample: body.results?.[0] ?? null,
          };
        } catch (err) {
          results[objectType] = { ok: false, error: String(err) };
        }
      }),
    );

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
                : "Nenhum recurso respondeu.",
            }),
        config: { ...integration.config, last_diagnostics: results, last_diagnostics_at: new Date().toISOString() },
      })
      .eq("id", integration_id);

    return json({ results });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
