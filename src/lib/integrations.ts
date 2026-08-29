import { supabase } from "@/lib/supabase";

interface SaveCredentialParams {
  workspaceId: string;
  provider: "asaas" | "hubla" | "hotmart" | "tmb" | "hubspot";
  config: Record<string, unknown>;
  secretValue: string;
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
}: SaveCredentialParams): Promise<SaveCredentialResult> {
  const { data: existing } = await supabase
    .from("integrations")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("provider", provider)
    .maybeSingle();

  let integrationId = existing?.id as string | undefined;

  if (integrationId) {
    const { error } = await supabase.from("integrations").update({ config }).eq("id", integrationId);
    if (error) return { integrationId: null, error: error.message };
  } else {
    integrationId = crypto.randomUUID();
    const { error } = await supabase
      .from("integrations")
      .insert({ id: integrationId, workspace_id: workspaceId, provider, config });
    if (error) return { integrationId: null, error: error.message };
  }

  const { error: updateSecretError } = await supabase
    .from("integration_secrets")
    .update({ api_key: secretValue })
    .eq("integration_id", integrationId);
  if (updateSecretError) return { integrationId: null, error: updateSecretError.message };

  const { error: insertSecretError } = await supabase
    .from("integration_secrets")
    .insert({ integration_id: integrationId, api_key: secretValue });
  if (insertSecretError && insertSecretError.code !== "23505") {
    return { integrationId: null, error: insertSecretError.message };
  }

  return { integrationId, error: null };
}
