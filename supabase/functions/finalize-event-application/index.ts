import { createClient } from "npm:@supabase/supabase-js@2";
import { logIntegrationCall } from "../_shared/integrationLog.ts";

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

function splitName(fullName: string | null) {
  const trimmed = (fullName ?? "").trim();
  if (!trimmed) return { firstname: null, lastname: null };
  const [firstname, ...rest] = trimmed.split(/\s+/);
  return { firstname, lastname: rest.length > 0 ? rest.join(" ") : null };
}

const DEAL_TO_CONTACT_ASSOCIATION_TYPE_ID = 3;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  const startedAt = Date.now();
  let workspaceId: string | null = null;
  let integrationId: string | null = null;
  let applicationId: string | null = null;
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const log = (params: { status: "success" | "error"; statusCode: number; response?: unknown; errorMessage?: string }) =>
    logIntegrationCall(admin, {
      workspaceId,
      integrationId,
      provider: "hubspot",
      direction: "outbound",
      eventType: "finalize-event-application",
      durationMs: Date.now() - startedAt,
      ...params,
    });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      await log({ status: "error", statusCode: 401, errorMessage: "missing authorization" });
      return json({ error: "missing authorization" }, 401);
    }

    const { application_id } = await req.json();
    if (!application_id) {
      await log({ status: "error", statusCode: 400, errorMessage: "application_id required" });
      return json({ error: "application_id required" }, 400);
    }
    applicationId = application_id;

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) {
      await log({ status: "error", statusCode: 401, errorMessage: `invalid session: ${userError?.message ?? "sem usuário"}` });
      return json({ error: "invalid session" }, 401);
    }

    const { data: application, error: applicationError } = await admin
      .from("event_applications")
      .select(
        "id, workspace_id, event_id, participant_id, full_name, email, phone, hubla_product_name, amount, hubspot_deal_id",
      )
      .eq("id", application_id)
      .maybeSingle();
    if (applicationError || !application) {
      await log({ status: "error", statusCode: 404, errorMessage: "application not found" });
      return json({ error: "application not found" }, 404);
    }
    workspaceId = application.workspace_id;

    const { data: event } = await admin
      .from("events")
      .select("id, name, hubspot_pipeline_id")
      .eq("id", application.event_id)
      .maybeSingle();
    if (!event?.hubspot_pipeline_id) {
      await log({ status: "error", statusCode: 400, errorMessage: "event has no hubspot_pipeline_id configured" });
      return json({ error: "Este evento ainda não tem uma pipeline da HubSpot configurada." }, 400);
    }

    const { data: membership } = await admin
      .from("workspace_members")
      .select("id")
      .eq("workspace_id", application.workspace_id)
      .eq("user_id", userData.user.id)
      .eq("is_active", true)
      .maybeSingle();
    if (!membership) {
      await log({ status: "error", statusCode: 403, errorMessage: "forbidden: usuário não é membro ativo do workspace" });
      return json({ error: "forbidden" }, 403);
    }

    const { data: integration } = await admin
      .from("integrations")
      .select("id")
      .eq("workspace_id", application.workspace_id)
      .eq("provider", "hubspot")
      .maybeSingle();
    if (!integration) {
      await log({ status: "error", statusCode: 400, errorMessage: "hubspot integration not configured" });
      return json({ error: "HubSpot não está conectada neste workspace." }, 400);
    }
    integrationId = integration.id;

    const { data: secret } = await admin
      .from("integration_secrets")
      .select("api_key")
      .eq("integration_id", integration.id)
      .maybeSingle();
    if (!secret) {
      await log({ status: "error", statusCode: 400, errorMessage: "no api key saved" });
      return json({ error: "Credencial da HubSpot não encontrada." }, 400);
    }

    const headers = { Authorization: `Bearer ${secret.api_key}`, "Content-Type": "application/json" };

    // Etapa de fechamento = a última etapa da pipeline (maior display_order) —
    // mais robusto que casar pelo nome ("Ganho"/"Negócio Fechado" variam entre
    // pipelines) já que a última etapa é sempre a de fechamento por convenção
    // do próprio funil configurado na HubSpot.
    const { data: closingStage } = await admin
      .from("hubspot_pipeline_stages")
      .select("stage_id")
      .eq("workspace_id", application.workspace_id)
      .eq("pipeline_id", event.hubspot_pipeline_id)
      .order("display_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Reaproveita o Contact já sincronizado do participante (Fase 2), se
    // houver — evita criar um segundo Contact pra mesma pessoa.
    let contactId: string | null = null;
    if (application.participant_id) {
      const { data: participant } = await admin
        .from("event_participants")
        .select("hubspot_contact_id")
        .eq("id", application.participant_id)
        .maybeSingle();
      contactId = participant?.hubspot_contact_id ?? null;
    }

    if (!contactId) {
      const { firstname, lastname } = splitName(application.full_name);
      if (application.email) {
        const res = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/batch/upsert", {
          method: "POST",
          headers,
          body: JSON.stringify({
            inputs: [
              { idProperty: "email", id: application.email, properties: { email: application.email, firstname, lastname, phone: application.phone } },
            ],
          }),
        });
        if (!res.ok) throw new Error(`contact upsert failed: ${res.status} ${await res.text()}`);
        const body = await res.json();
        contactId = body?.results?.[0]?.id ?? null;
      } else {
        const res = await fetch("https://api.hubapi.com/crm/v3/objects/contacts", {
          method: "POST",
          headers,
          body: JSON.stringify({ properties: { firstname, lastname, phone: application.phone } }),
        });
        if (!res.ok) throw new Error(`contact create failed: ${res.status} ${await res.text()}`);
        const body = await res.json();
        contactId = body?.id ?? null;
      }
    }

    const dealProperties = {
      dealname: `${application.full_name ?? "Aplicação"} — ${application.hubla_product_name ?? event.name}`,
      pipeline: event.hubspot_pipeline_id,
      ...(closingStage?.stage_id ? { dealstage: closingStage.stage_id } : {}),
      ...(application.amount != null ? { amount: String(application.amount) } : {}),
    };

    let dealId = application.hubspot_deal_id as string | null;
    if (dealId) {
      const res = await fetch(`https://api.hubapi.com/crm/v3/objects/deals/${dealId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ properties: dealProperties }),
      });
      if (!res.ok) throw new Error(`deal update failed: ${res.status} ${await res.text()}`);
    } else {
      const res = await fetch("https://api.hubapi.com/crm/v3/objects/deals", {
        method: "POST",
        headers,
        body: JSON.stringify({
          properties: dealProperties,
          associations: contactId
            ? [{ to: { id: contactId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: DEAL_TO_CONTACT_ASSOCIATION_TYPE_ID }] }]
            : [],
        }),
      });
      if (!res.ok) throw new Error(`deal create failed: ${res.status} ${await res.text()}`);
      const body = await res.json();
      dealId = body?.id ?? null;
    }

    if (application.participant_id && contactId) {
      await admin
        .from("event_participants")
        .update({ hubspot_contact_id: contactId, hubspot_sync_status: "enviado", hubspot_synced_at: new Date().toISOString() })
        .eq("id", application.participant_id)
        .is("hubspot_contact_id", null);
    }

    await admin
      .from("event_applications")
      .update({
        hubspot_deal_id: dealId,
        hubspot_sync_status: "enviado",
        hubspot_sync_error: null,
        hubspot_synced_at: new Date().toISOString(),
      })
      .eq("id", application.id);

    await log({ status: "success", statusCode: 200, response: { dealId, contactId } });
    return json({ dealId, contactId });
  } catch (err) {
    const message = String(err instanceof Error ? err.message : err);
    if (applicationId) {
      await admin
        .from("event_applications")
        .update({ hubspot_sync_status: "erro", hubspot_sync_error: message })
        .eq("id", applicationId);
    }
    await log({ status: "error", statusCode: 500, errorMessage: message });
    return json({ error: message }, 500);
  }
});
