import { supabase } from "@/lib/supabase";

interface SaveCredentialParams {
  workspaceId: string;
  provider: "asaas" | "hubla" | "hotmart" | "tmb" | "hubspot" | "vsix" | "iuli" | "brevo";
  config: Record<string, unknown>;
  secretValue: string;
  // Só a TMB usa isso hoje: ela tem duas credenciais distintas (Bearer token
  // da REST API em secretValue, valor do header do webhook aqui) — os demais
  // providers têm uma credencial só e não passam esse campo.
  webhookSecretValue?: string;
  // A IULI aceita várias conexões no mesmo workspace (uma por empresa, cada
  // uma com seu token). integrationId atualiza uma conexão específica;
  // forceNew cria mais uma; label é o nome que o usuário deu à empresa.
  integrationId?: string;
  forceNew?: boolean;
  label?: string;
}

interface SaveCredentialResult {
  integrationId: string | null;
  error: string | null;
}

// Grava (ou atualiza) a integração + o segredo dela, sem os dois bugs que já
// pegamos aqui: nunca faz upsert incluindo `id` contra um conflict target
// diferente da PK (troca o id de uma linha existente, quebra FK), e nunca faz
// upsert() numa tabela sem policy de SELECT (integration_secrets) — sempre
// update-then-insert simples nos dois casos.
export async function saveIntegrationCredential({
  workspaceId,
  provider,
  config,
  secretValue,
  webhookSecretValue,
  integrationId: targetId,
  forceNew,
  label,
}: SaveCredentialParams): Promise<SaveCredentialResult> {
  let integrationId = targetId;
  if (!integrationId && !forceNew) {
    const { data: existing } = await supabase
      .from("integrations")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("provider", provider)
      .maybeSingle();
    integrationId = existing?.id as string | undefined;
  }

  if (integrationId) {
    const { error } = await supabase
      .from("integrations")
      .update(label !== undefined ? { config, label } : { config })
      .eq("id", integrationId);
    if (error) return { integrationId: null, error: error.message };
  } else {
    integrationId = crypto.randomUUID();
    const { error } = await supabase
      .from("integrations")
      .insert({ id: integrationId, workspace_id: workspaceId, provider, config, ...(label !== undefined ? { label } : {}) });
    if (error) return { integrationId: null, error: error.message };
  }

  const secretRow: Record<string, string> = { api_key: secretValue };
  if (webhookSecretValue !== undefined) secretRow.webhook_secret = webhookSecretValue;

  const { error: updateSecretError } = await supabase
    .from("integration_secrets")
    .update(secretRow)
    .eq("integration_id", integrationId);
  if (updateSecretError) return { integrationId: null, error: updateSecretError.message };

  const { error: insertSecretError } = await supabase
    .from("integration_secrets")
    .insert({ integration_id: integrationId, ...secretRow });
  if (insertSecretError && insertSecretError.code !== "23505") {
    return { integrationId: null, error: insertSecretError.message };
  }

  return { integrationId, error: null };
}
