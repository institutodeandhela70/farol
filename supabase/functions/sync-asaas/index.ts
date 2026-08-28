import { createClient } from "npm:@supabase/supabase-js@2";

const ASAAS_BASE_URL: Record<string, string> = {
  sandbox: "https://api-sandbox.asaas.com/v3",
  production: "https://api.asaas.com/v3",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
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

    const asaasRes = await fetch(`${baseUrl}/payments?limit=100`, {
      headers: {
        access_token: secret.api_key,
        "User-Agent": "FarolID",
        "Content-Type": "application/json",
      },
    });

    if (!asaasRes.ok) {
      const errText = await asaasRes.text();
      const storedError = `HTTP ${asaasRes.status} (${environment}): ${errText || "sem corpo de resposta"}`;
      await admin
        .from("integrations")
        .update({ status: "error", last_error: storedError.slice(0, 500) })
        .eq("id", integration_id);
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
      if (upsertError) throw upsertError;
    }

    await admin
      .from("integrations")
      .update({ status: "connected", last_synced_at: new Date().toISOString(), last_error: null })
      .eq("id", integration_id);

    return json({ synced: charges.length });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
