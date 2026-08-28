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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  let integrationId: string | undefined;

  const markError = async (message: string) => {
    if (!integrationId) return;
    await admin
      .from("integrations")
      .update({ status: "error", last_error: message.slice(0, 500) })
      .eq("id", integrationId);
  };

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "missing authorization" }, 401);

    const body = await req.json();
    integrationId = body?.integration_id;
    if (!integrationId) return json({ error: "integration_id required" }, 400);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) {
      await markError(`Sessão inválida ao sincronizar: ${userError?.message ?? "sem usuário"}`);
      return json({ error: "invalid session" }, 401);
    }

    const { data: integration, error: integrationError } = await admin
      .from("integrations")
      .select("id, workspace_id, config")
      .eq("id", integrationId)
      .single();
    if (integrationError || !integration) {
      return json({ error: "integration not found" }, 404);
    }

    const { data: membership } = await admin
      .from("workspace_members")
      .select("id")
      .eq("workspace_id", integration.workspace_id)
      .eq("user_id", userData.user.id)
      .eq("is_active", true)
      .maybeSingle();
    if (!membership) {
      await markError("Usuário não é membro ativo do workspace desta integração.");
      return json({ error: "forbidden" }, 403);
    }

    const { data: secret, error: secretError } = await admin
      .from("integration_secrets")
      .select("api_key")
      .eq("integration_id", integrationId)
      .maybeSingle();
    if (secretError || !secret) {
      await markError("Nenhuma API key salva para esta integração.");
      return json({ error: "no api key saved" }, 400);
    }

    const environment = integration.config?.environment === "production" ? "production" : "sandbox";
    const baseUrl = ASAAS_BASE_URL[environment];

    let asaasRes: Response;
    try {
      asaasRes = await fetch(`${baseUrl}/payments?limit=100`, {
        headers: {
          access_token: secret.api_key,
          "User-Agent": "FarolID",
          "Content-Type": "application/json",
        },
      });
    } catch (fetchErr) {
      await markError(`Falha de rede ao chamar a Asaas (${environment}): ${String(fetchErr)}`);
      return json({ error: "network error contacting asaas", detail: String(fetchErr) }, 502);
    }

    if (!asaasRes.ok) {
      const errText = await asaasRes.text();
      await markError(`HTTP ${asaasRes.status} (${environment}): ${errText || "sem corpo de resposta"}`);
      return json({ error: "asaas request failed", detail: errText }, 502);
    }

    const asaasData = await asaasRes.json();
    const charges = (asaasData.data ?? []).map((c: Record<string, unknown>) => ({
      workspace_id: integration.workspace_id,
      external_id: c.id,
      customer_name: c.customer ?? null,
      value: c.value ?? 0,
      status: c.status ?? "UNKNOWN",
      due_date: c.dueDate ?? null,
      payment_date: c.paymentDate ?? null,
      updated_at: new Date().toISOString(),
    }));

    if (charges.length > 0) {
      const { error: upsertError } = await admin
        .from("asaas_charges")
        .upsert(charges, { onConflict: "workspace_id,external_id" });
      if (upsertError) {
        await markError(`Falha ao gravar cobranças: ${upsertError.message}`);
        return json({ error: "failed to store charges", detail: upsertError.message }, 500);
      }
    }

    await admin
      .from("integrations")
      .update({ status: "connected", last_synced_at: new Date().toISOString(), last_error: null })
      .eq("id", integrationId);

    return json({ synced: charges.length });
  } catch (err) {
    await markError(`Erro inesperado: ${String(err)}`);
    return json({ error: String(err) }, 500);
  }
});
