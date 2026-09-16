// Disparo de WhatsApp via VSIX, compartilhado entre a Edge Function
// `send-event-whatsapp` (chamada pelo front) e `finalize-event-application`
// (chama direto, sem round-trip HTTP extra). Nada dispara sem
// `event_message_templates.enabled = true` — cada gatilho é opt-in por evento.
import { logIntegrationCall } from "./integrationLog.ts";

// deno-lint-ignore no-explicit-any
type Admin = any;

export type TriggerType = "participante_aprovado" | "ficha_preenchida" | "venda_finalizada";

const BASE_URL_BY_ENV: Record<string, string> = {
  dev: "https://dev.vsix.ia.br/api/v1",
  prod: "https://www.vsix.ia.br/api/v1",
};

function renderTemplate(template: string, vars: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => vars[key] ?? "");
}

export interface SendEventWhatsappParams {
  eventId: string;
  triggerType: TriggerType;
  participantId?: string;
  applicationId?: string;
}

export interface SendEventWhatsappResult {
  skipped?: boolean;
  reason?: string;
  sent?: boolean;
  message_id?: string;
  error?: string;
}

export async function sendEventWhatsapp(admin: Admin, params: SendEventWhatsappParams): Promise<SendEventWhatsappResult> {
  const startedAt = Date.now();
  const { eventId, triggerType } = params;

  const { data: event } = await admin.from("events").select("id, workspace_id, name").eq("id", eventId).maybeSingle();
  if (!event) return { skipped: true, reason: "event_not_found" };

  const log = (p: { status: "success" | "error"; statusCode: number; response?: unknown; errorMessage?: string; request?: unknown }) =>
    logIntegrationCall(admin, {
      workspaceId: event.workspace_id,
      integrationId: null,
      provider: "vsix",
      direction: "outbound",
      eventType: `trigger:${triggerType}`,
      durationMs: Date.now() - startedAt,
      ...p,
    });

  const { data: template } = await admin
    .from("event_message_templates")
    .select("enabled, message_template")
    .eq("event_id", eventId)
    .eq("trigger_type", triggerType)
    .maybeSingle();

  if (!template?.enabled || !template.message_template?.trim()) {
    return { skipped: true, reason: "trigger_disabled" };
  }

  // Dados da linha (participante ou aplicação) + variáveis disponíveis por
  // gatilho — cada trigger_type sabe de que tabela puxar e o que pode faltar.
  let name = "";
  let phone: string | null = null;
  let product = "";
  let amount = "";
  let targetTable: "event_participants" | "event_applications" | null = null;
  let targetId: string | null = null;

  if (triggerType === "participante_aprovado") {
    if (!params.participantId) return { skipped: true, reason: "missing_participant_id" };
    const { data: p } = await admin
      .from("event_participants")
      .select("id, full_name, phone")
      .eq("id", params.participantId)
      .maybeSingle();
    if (!p) return { skipped: true, reason: "participant_not_found" };
    name = p.full_name ?? "";
    phone = p.phone;
    targetTable = "event_participants";
    targetId = p.id;
  } else {
    if (!params.applicationId) return { skipped: true, reason: "missing_application_id" };
    const { data: a } = await admin
      .from("event_applications")
      .select("id, full_name, phone, hubla_product_name, amount")
      .eq("id", params.applicationId)
      .maybeSingle();
    if (!a) return { skipped: true, reason: "application_not_found" };
    name = a.full_name ?? "";
    phone = a.phone;
    product = a.hubla_product_name ?? "";
    amount = a.amount != null ? Number(a.amount).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "";
    targetTable = "event_applications";
    targetId = a.id;
  }

  if (!phone) {
    return { skipped: true, reason: "no_phone" };
  }

  const text = renderTemplate(template.message_template, { nome: name, evento: event.name, produto: product, valor: amount });

  const { data: integration } = await admin
    .from("integrations")
    .select("id, config")
    .eq("workspace_id", event.workspace_id)
    .eq("provider", "vsix")
    .maybeSingle();
  if (!integration?.config?.instance_id) {
    await log({ status: "error", statusCode: 400, errorMessage: "vsix not configured" });
    return { error: "VSIX não está conectado ou a instância não está configurada." };
  }

  const { data: secret } = await admin.from("integration_secrets").select("api_key").eq("integration_id", integration.id).maybeSingle();
  if (!secret) {
    await log({ status: "error", statusCode: 400, errorMessage: "no api key saved" });
    return { error: "Chave da API do VSIX não encontrada." };
  }

  const baseUrl = BASE_URL_BY_ENV[integration.config.environment === "prod" ? "prod" : "dev"];
  const requestBody = { instance_id: integration.config.instance_id, to: { type: "phone", value: phone }, type: "text", text };

  try {
    const res = await fetch(`${baseUrl}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret.api_key}`,
        "Content-Type": "application/json",
        // Determinístico por linha+gatilho: reprocessar o mesmo evento (ex:
        // retry de rede) nunca manda a mesma mensagem duas vezes.
        "Idempotency-Key": `${triggerType}:${targetId}`,
      },
      body: JSON.stringify(requestBody),
    });
    const responseBody = await res.json().catch(() => ({}));

    if (!res.ok) {
      const message = responseBody?.error?.message ?? `VSIX respondeu ${res.status}`;
      if (targetTable) await admin.from(targetTable).update({ whatsapp_status: "erro", whatsapp_sync_error: message }).eq("id", targetId);
      await log({ status: "error", statusCode: res.status, request: requestBody, response: responseBody, errorMessage: message });
      return { error: message };
    }

    if (targetTable) await admin.from(targetTable).update({ whatsapp_status: "enviado", whatsapp_sync_error: null }).eq("id", targetId);
    await log({ status: "success", statusCode: 200, request: requestBody, response: responseBody });
    return { sent: true, message_id: responseBody?.message_id };
  } catch (err) {
    const message = String(err instanceof Error ? err.message : err);
    if (targetTable) await admin.from(targetTable).update({ whatsapp_status: "erro", whatsapp_sync_error: message }).eq("id", targetId);
    await log({ status: "error", statusCode: 500, errorMessage: message });
    return { error: message };
  }
}
