// deno-lint-ignore no-explicit-any
type Admin = any;

export interface LogIntegrationCallParams {
  workspaceId: string | null;
  integrationId: string | null;
  provider: "asaas" | "hubla" | "hotmart" | "tmb" | "hubspot" | "vsix" | "iuli" | "brevo";
  direction: "inbound" | "outbound";
  eventType: string;
  status: "success" | "error";
  statusCode?: number | null;
  request?: unknown;
  response?: unknown;
  errorMessage?: string | null;
  durationMs?: number | null;
}

// Nunca deve derrubar a chamada real da integração — se o insert do log falhar
// (ex: constraint, rede), só ignora e segue o fluxo normal.
export async function logIntegrationCall(admin: Admin, params: LogIntegrationCallParams) {
  try {
    await admin.from("integration_logs").insert({
      workspace_id: params.workspaceId,
      integration_id: params.integrationId,
      provider: params.provider,
      direction: params.direction,
      event_type: params.eventType,
      status: params.status,
      status_code: params.statusCode ?? null,
      request_payload: params.request ?? null,
      response_payload: params.response ?? null,
      error_message: params.errorMessage ?? null,
      duration_ms: params.durationMs ?? null,
    });
  } catch {
    // ignora — logging não pode ser ponto de falha da integração de verdade.
  }
}
