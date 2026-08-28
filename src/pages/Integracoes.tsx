import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

type IntegrationStatus = "disconnected" | "connected" | "error";

interface IntegrationRow {
  id: string;
  status: IntegrationStatus;
  last_synced_at: string | null;
  last_error: string | null;
  config: { environment?: "sandbox" | "production" };
}

const statusLabel: Record<IntegrationStatus, string> = {
  disconnected: "Desconectado",
  connected: "Conectado",
  error: "Erro",
};

const statusVariant: Record<IntegrationStatus, "secondary" | "default" | "destructive"> = {
  disconnected: "secondary",
  connected: "default",
  error: "destructive",
};

export default function Integracoes() {
  const { workspace } = useWorkspace();
  const [integration, setIntegration] = useState<IntegrationRow | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [environment, setEnvironment] = useState<"sandbox" | "production">("sandbox");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "error" | "success"; text: string } | null>(null);

  const loadIntegration = async () => {
    if (!workspace) return;
    const { data } = await supabase
      .from("integrations")
      .select("id, status, last_synced_at, last_error, config")
      .eq("workspace_id", workspace.id)
      .eq("provider", "asaas")
      .maybeSingle();

    setIntegration(data as IntegrationRow | null);
    setEnvironment((data?.config?.environment as "sandbox" | "production") ?? "sandbox");
    setLoading(false);
  };

  useEffect(() => {
    loadIntegration();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace?.id]);

  const handleConnect = async () => {
    if (!workspace) return;
    if (!apiKey.trim()) {
      setFeedback({ type: "error", text: "Cole a API key do Asaas antes de conectar." });
      return;
    }

    setSaving(true);
    setFeedback(null);

    // Nunca fazer upsert incluindo `id` contra um conflict target diferente da PK:
    // se já existir linha para (workspace_id, provider), isso tenta trocar o id dela,
    // o que quebra a FK de integration_secrets assim que um segredo já foi salvo.
    // Por isso: primeiro tenta achar a linha existente, só gera id novo se não achar.
    const { data: existing } = await supabase
      .from("integrations")
      .select("id")
      .eq("workspace_id", workspace.id)
      .eq("provider", "asaas")
      .maybeSingle();

    let integrationId = existing?.id as string | undefined;

    if (integrationId) {
      const { error: updateError } = await supabase
        .from("integrations")
        .update({ config: { environment } })
        .eq("id", integrationId);

      if (updateError) {
        setSaving(false);
        setFeedback({ type: "error", text: updateError.message });
        return;
      }
    } else {
      integrationId = crypto.randomUUID();
      const { error: insertError } = await supabase.from("integrations").insert({
        id: integrationId,
        workspace_id: workspace.id,
        provider: "asaas",
        config: { environment },
      });

      if (insertError) {
        setSaving(false);
        setFeedback({ type: "error", text: insertError.message });
        return;
      }
    }

    // integration_secrets não tem policy de SELECT (de propósito — só a Edge Function lê).
    // upsert() sempre pede RETURNING nesse client/setup, o que quebra por RLS numa tabela
    // sem SELECT. Por isso: UPDATE simples primeiro (sem-op se a linha não existir) e um
    // INSERT simples depois — se a linha já existia, o INSERT esbarra em conflito de chave
    // (23505), o que é esperado (o UPDATE já cuidou dela) e é ignorado.
    const trimmedKey = apiKey.trim();

    const { error: updateSecretError } = await supabase
      .from("integration_secrets")
      .update({ api_key: trimmedKey })
      .eq("integration_id", integrationId);

    if (updateSecretError) {
      setSaving(false);
      setFeedback({ type: "error", text: updateSecretError.message });
      return;
    }

    const { error: insertSecretError } = await supabase
      .from("integration_secrets")
      .insert({ integration_id: integrationId, api_key: trimmedKey });

    if (insertSecretError && insertSecretError.code !== "23505") {
      setSaving(false);
      setFeedback({ type: "error", text: insertSecretError.message });
      return;
    }

    setApiKey("");
    await handleSync(integrationId);
    setSaving(false);
  };

  const handleSync = async (integrationId?: string) => {
    const id = integrationId ?? integration?.id;
    if (!id) return;

    setSaving(true);
    setFeedback(null);

    const { data, error } = await supabase.functions.invoke("sync-asaas", {
      body: { integration_id: id },
    });

    setSaving(false);

    // A fonte de verdade é o status gravado pela Edge Function no banco, não só o
    // objeto de erro do invoke (que pode não refletir corretamente respostas não-2xx
    // da função em todas as versões do client).
    const { data: refreshed } = await supabase
      .from("integrations")
      .select("status, last_error")
      .eq("id", id)
      .maybeSingle();

    if (error || refreshed?.status === "error") {
      setFeedback({
        type: "error",
        text: refreshed?.last_error
          ? `Falha ao sincronizar: ${refreshed.last_error}`
          : "Falha ao sincronizar. Confira a API key e o ambiente.",
      });
    } else {
      setFeedback({ type: "success", text: `Sincronizado: ${data?.synced ?? 0} cobrança(s).` });
    }

    await loadIntegration();
  };

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Carregando...</div>;
  }

  return (
    <div className="p-6">
      <h1 className="text-xl font-medium">Integrações</h1>
      <p className="mt-1 text-sm text-muted-foreground">Conecte as fontes de dados do workspace.</p>

      <div className="mt-6 max-w-md rounded-lg border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Asaas</h2>
          {integration && (
            <Badge variant={statusVariant[integration.status]}>{statusLabel[integration.status]}</Badge>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">Cobranças e pagamentos.</p>

        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="asaas-env">Ambiente</Label>
            <select
              id="asaas-env"
              value={environment}
              onChange={(e) => setEnvironment(e.target.value as "sandbox" | "production")}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="sandbox">Sandbox</option>
              <option value="production">Produção</option>
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="asaas-key">API key</Label>
            <Input
              id="asaas-key"
              type="password"
              placeholder={integration ? "•••••••• (já salva — cole uma nova pra trocar)" : "Cole a API key do Asaas"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>

          {feedback && (
            <p className={feedback.type === "error" ? "text-sm text-destructive" : "text-sm text-primary"}>
              {feedback.text}
            </p>
          )}

          {integration?.last_synced_at && (
            <p className="text-xs text-muted-foreground">
              Última sincronização: {new Date(integration.last_synced_at).toLocaleString("pt-BR")}
            </p>
          )}

          <div className="flex gap-2">
            <Button onClick={handleConnect} disabled={saving}>
              {integration ? "Salvar e sincronizar" : "Conectar"}
            </Button>
            {integration?.status === "connected" && (
              <Button variant="outline" onClick={() => handleSync()} disabled={saving}>
                Sincronizar agora
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
