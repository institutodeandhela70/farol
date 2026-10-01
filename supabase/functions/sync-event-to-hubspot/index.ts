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

// Associação padrão "Deal to Contact" da HubSpot (associationTypeId 3) —
// mesmo tipo usado quando um Deal é criado já vinculado a um Contact pela UI.
const DEAL_TO_CONTACT_ASSOCIATION_TYPE_ID = 3;

interface ParticipantRow {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  hubspot_sync_status: string;
  approval_status: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  const startedAt = Date.now();
  let workspaceId: string | null = null;
  let integrationId: string | null = null;
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const log = (params: { status: "success" | "error"; statusCode: number; response?: unknown; errorMessage?: string }) =>
    logIntegrationCall(admin, {
      workspaceId,
      integrationId,
      provider: "hubspot",
      direction: "outbound",
      eventType: "sync-event-to-hubspot",
      durationMs: Date.now() - startedAt,
      ...params,
    });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      await log({ status: "error", statusCode: 401, errorMessage: "missing authorization" });
      return json({ error: "missing authorization" }, 401);
    }

    const { event_id, participant_ids } = await req.json();
    if (!event_id || !Array.isArray(participant_ids) || participant_ids.length === 0) {
      await log({ status: "error", statusCode: 400, errorMessage: "event_id and participant_ids required" });
      return json({ error: "event_id and participant_ids required" }, 400);
    }

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) {
      await log({ status: "error", statusCode: 401, errorMessage: `invalid session: ${userError?.message ?? "sem usuário"}` });
      return json({ error: "invalid session" }, 401);
    }

    const { data: event, error: eventError } = await admin
      .from("events")
      .select("id, workspace_id, name, hubspot_pipeline_id")
      .eq("id", event_id)
      .maybeSingle();
    if (eventError || !event) {
      await log({ status: "error", statusCode: 404, errorMessage: "event not found" });
      return json({ error: "event not found" }, 404);
    }
    workspaceId = event.workspace_id;

    if (!event.hubspot_pipeline_id) {
      await log({ status: "error", statusCode: 400, errorMessage: "event has no hubspot_pipeline_id configured" });
      return json({ error: "Este evento ainda não tem uma pipeline da HubSpot configurada." }, 400);
    }

    const { data: membership } = await admin
      .from("workspace_members")
      .select("id")
      .eq("workspace_id", event.workspace_id)
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
      .eq("workspace_id", event.workspace_id)
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

    const headers = {
      Authorization: `Bearer ${secret.api_key}`,
      "Content-Type": "application/json",
    };

    const { data: initialStage } = await admin
      .from("hubspot_pipeline_stages")
      .select("stage_id")
      .eq("workspace_id", event.workspace_id)
      .eq("pipeline_id", event.hubspot_pipeline_id)
      .order("display_order", { ascending: true })
      .limit(1)
      .maybeSingle();

    const { data: participants } = await admin
      .from("event_participants")
      .select("id, full_name, email, phone, hubspot_sync_status, approval_status")
      .eq("event_id", event_id)
      .in("id", participant_ids);

    const errors: { id: string; error: string }[] = [];
    let sent = 0;
    let skipped = 0;

    for (const participant of (participants ?? []) as ParticipantRow[]) {
      // Já enviado — nunca reprocessa. Sem isso, reenviar um participante sem
      // e-mail (que não tem como fazer upsert por e-mail na HubSpot) cria um
      // Contact duplicado a cada clique, em vez de atualizar o existente.
      // Pendente/rejeitado (cadastro externo da Fase 3) também nunca vai pra
      // HubSpot sozinho — só depois que alguém do time aprova.
      if (participant.hubspot_sync_status === "enviado" || participant.approval_status !== "aprovado") {
        skipped += 1;
        continue;
      }

      try {
        const { firstname, lastname } = splitName(participant.full_name);
        let contactId: string | null = null;

        if (participant.email) {
          const res = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/batch/upsert", {
            method: "POST",
            headers,
            body: JSON.stringify({
              inputs: [
                {
                  idProperty: "email",
                  id: participant.email,
                  properties: { email: participant.email, firstname, lastname, phone: participant.phone },
                },
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
            body: JSON.stringify({ properties: { firstname, lastname, phone: participant.phone } }),
          });
          if (!res.ok) throw new Error(`contact create failed: ${res.status} ${await res.text()}`);
          const body = await res.json();
          contactId = body?.id ?? null;
        }

        const dealRes = await fetch("https://api.hubapi.com/crm/v3/objects/deals", {
          method: "POST",
          headers,
          body: JSON.stringify({
            properties: {
              dealname: `${participant.full_name ?? "Participante"} — ${event.name}`,
              pipeline: event.hubspot_pipeline_id,
              ...(initialStage?.stage_id ? { dealstage: initialStage.stage_id } : {}),
            },
            associations: contactId
              ? [
                  {
                    to: { id: contactId },
                    types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: DEAL_TO_CONTACT_ASSOCIATION_TYPE_ID }],
                  },
                ]
              : [],
          }),
        });
        if (!dealRes.ok) throw new Error(`deal create failed: ${dealRes.status} ${await dealRes.text()}`);
        const dealBody = await dealRes.json();

        await admin
          .from("event_participants")
          .update({
            hubspot_contact_id: contactId,
            hubspot_deal_id: dealBody?.id ?? null,
            hubspot_sync_status: "enviado",
            hubspot_sync_error: null,
            hubspot_synced_at: new Date().toISOString(),
          })
          .eq("id", participant.id);

        sent += 1;
      } catch (err) {
        const message = String(err instanceof Error ? err.message : err);
        errors.push({ id: participant.id, error: message });
        await admin
          .from("event_participants")
          .update({ hubspot_sync_status: "erro", hubspot_sync_error: message })
          .eq("id", participant.id);
      }
    }

    await log({
      status: errors.length === 0 ? "success" : "error",
      statusCode: 200,
      response: { sent, skipped, errors },
      errorMessage: errors.length > 0 ? `${errors.length} participante(s) falharam` : undefined,
    });

    return json({ sent, skipped, errors });
  } catch (err) {
    await log({ status: "error", statusCode: 500, errorMessage: String(err) });
    return json({ error: String(err) }, 500);
  }
});
