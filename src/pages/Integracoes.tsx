import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { saveIntegrationCredential } from "@/lib/integrations";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type IntegrationStatus = "disconnected" | "connected" | "error";
type ProviderId = "asaas" | "hubla" | "hubspot";

interface IntegrationRow {
  id: string;
  status: IntegrationStatus;
  last_synced_at: string | null;
  last_error: string | null;
  config: { environment?: "sandbox" | "production"; key_preview?: string };
}

type DiagnosticEntry = { ok: boolean; total?: number | null; totalCount?: number | null; status?: number; error?: string };
type Diagnostics = Record<string, DiagnosticEntry>;

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

const RESOURCE_LABEL: Record<string, string> = {
  // Asaas
  customers: "Clientes",
  payments: "Cobranças",
  subscriptions: "Assinaturas",
  installments: "Parcelamentos",
  transfers: "Transferências",
  anticipations: "Antecipações",
  pixAddressKeys: "Chaves Pix",
  financeBalance: "Saldo da conta",
  // HubSpot
  contacts: "Contatos",
  companies: "Empresas",
  deals: "Negócios",
  tickets: "Tickets",
  calls: "Chamadas",
  emails: "E-mails",
  meetings: "Reuniões",
  tasks: "Tarefas",
  notes: "Notas",
};

interface ProviderDef {
  id: ProviderId | "hotmart" | "tmb";
  name: string;
  description: string;
  color: string;
  letter: string;
  comingSoon?: boolean;
}

const PROVIDERS: ProviderDef[] = [
  { id: "asaas", name: "Asaas", description: "Cobranças e pagamentos.", color: "#0EA5A6", letter: "A" },
  { id: "hubla", name: "Hubla", description: "Vendas via webhook.", color: "#8B5CF6", letter: "H" },
  { id: "hubspot", name: "HubSpot", description: "CRM — contatos, negócios, tickets.", color: "#FF7A59", letter: "H" },
  { id: "hotmart", name: "Hotmart", description: "Em breve.", color: "#64748B", letter: "H", comingSoon: true },
  { id: "tmb", name: "TMB", description: "Em breve.", color: "#64748B", letter: "T", comingSoon: true },
];

function IconBadge({ color, letter }: { color: string; letter: string }) {
  return (
    <div
      className="flex size-10 shrink-0 items-center justify-center rounded-lg text-sm font-medium text-white"
      style={{ backgroundColor: color }}
    >
      {letter}
    </div>
  );
}

function DiagnosticsTable({ diagnostics }: { diagnostics: Diagnostics }) {
  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Recurso</th>
            <th className="px-3 py-2 font-medium">Tem dado?</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(diagnostics).map(([key, value]) => {
            const count = value.total ?? value.totalCount;
            return (
              <tr key={key} className="border-t border-border">
                <td className="px-3 py-2">{RESOURCE_LABEL[key] ?? key}</td>
                <td className="px-3 py-2">
                  {!value.ok ? `Erro (${value.status ?? "?"})` : count != null ? `${count} registro(s)` : "Sim"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function Integracoes() {
  const { workspace } = useWorkspace();
  const [loading, setLoading] = useState(true);
  const [openDialog, setOpenDialog] = useState<ProviderId | null>(null);

  // --- Asaas ---
  const [integration, setIntegration] = useState<IntegrationRow | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [environment, setEnvironment] = useState<"sandbox" | "production">("sandbox");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);

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

    const trimmedKey = apiKey.trim();
    const { integrationId, error } = await saveIntegrationCredential({
      workspaceId: workspace.id,
      provider: "asaas",
      config: { environment, key_preview: trimmedKey.slice(-4) },
      secretValue: trimmedKey,
    });

    if (error || !integrationId) {
      setSaving(false);
      setFeedback({ type: "error", text: error ?? "Falha ao salvar." });
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

  const handleDiagnose = async () => {
    if (!integration) return;
    setDiagnosing(true);
    setDiagnostics(null);

    const { data, error } = await supabase.functions.invoke("diagnose-asaas", {
      body: { integration_id: integration.id },
    });

    setDiagnosing(false);

    if (error || !data?.results) {
      setFeedback({ type: "error", text: "Falha ao rodar o diagnóstico." });
      return;
    }

    setDiagnostics(data.results);
  };

  // --- Hubla ---
  const [hublaIntegration, setHublaIntegration] = useState<IntegrationRow | null>(null);
  const [hublaToken, setHublaToken] = useState("");
  const [hublaSaving, setHublaSaving] = useState(false);
  const [hublaFeedback, setHublaFeedback] = useState<{ type: "error" | "success"; text: string } | null>(null);

  const webhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/hubla-webhook`;

  const loadHublaIntegration = async () => {
    if (!workspace) return;
    const { data } = await supabase
      .from("integrations")
      .select("id, status, last_synced_at, last_error, config")
      .eq("workspace_id", workspace.id)
      .eq("provider", "hubla")
      .maybeSingle();
    setHublaIntegration(data as IntegrationRow | null);
  };

  useEffect(() => {
    loadHublaIntegration();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace?.id]);

  const handleSaveHublaToken = async () => {
    if (!workspace) return;
    if (!hublaToken.trim()) {
      setHublaFeedback({ type: "error", text: "Cole o token do webhook da Hubla antes de salvar." });
      return;
    }

    setHublaSaving(true);
    setHublaFeedback(null);

    const trimmedToken = hublaToken.trim();
    const { error } = await saveIntegrationCredential({
      workspaceId: workspace.id,
      provider: "hubla",
      config: { key_preview: trimmedToken.slice(-4) },
      secretValue: trimmedToken,
    });

    setHublaSaving(false);

    if (error) {
      setHublaFeedback({ type: "error", text: error });
      return;
    }

    setHublaToken("");
    setHublaFeedback({
      type: "success",
      text: "Token salvo. Assim que a Hubla enviar a primeira venda, o status muda pra Conectado.",
    });
    await loadHublaIntegration();
  };

  // --- HubSpot ---
  const [hubspotIntegration, setHubspotIntegration] = useState<IntegrationRow | null>(null);
  const [hubspotToken, setHubspotToken] = useState("");
  const [hubspotSaving, setHubspotSaving] = useState(false);
  const [hubspotFeedback, setHubspotFeedback] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [hubspotDiagnostics, setHubspotDiagnostics] = useState<Diagnostics | null>(null);
  const [hubspotDiagnosing, setHubspotDiagnosing] = useState(false);

  const loadHubspotIntegration = async () => {
    if (!workspace) return;
    const { data } = await supabase
      .from("integrations")
      .select("id, status, last_synced_at, last_error, config")
      .eq("workspace_id", workspace.id)
      .eq("provider", "hubspot")
      .maybeSingle();
    setHubspotIntegration(data as IntegrationRow | null);
  };

  useEffect(() => {
    loadHubspotIntegration();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace?.id]);

  const handleSaveHubspotToken = async () => {
    if (!workspace) return;
    if (!hubspotToken.trim()) {
      setHubspotFeedback({ type: "error", text: "Cole o access token do app privado da HubSpot antes de salvar." });
      return;
    }

    setHubspotSaving(true);
    setHubspotFeedback(null);

    const trimmedToken = hubspotToken.trim();
    const { integrationId, error } = await saveIntegrationCredential({
      workspaceId: workspace.id,
      provider: "hubspot",
      config: { key_preview: trimmedToken.slice(-4) },
      secretValue: trimmedToken,
    });

    if (error || !integrationId) {
      setHubspotSaving(false);
      setHubspotFeedback({ type: "error", text: error ?? "Falha ao salvar." });
      return;
    }

    setHubspotToken("");
    await loadHubspotIntegration();
    await handleDiagnoseHubspot(integrationId);
    setHubspotSaving(false);
  };

  const handleDiagnoseHubspot = async (integrationId?: string) => {
    const id = integrationId ?? hubspotIntegration?.id;
    if (!id) return;
    setHubspotDiagnosing(true);
    setHubspotDiagnostics(null);

    const { data, error } = await supabase.functions.invoke("diagnose-hubspot", {
      body: { integration_id: id },
    });

    setHubspotDiagnosing(false);

    if (error || !data?.results) {
      setHubspotFeedback({ type: "error", text: "Falha ao rodar o diagnóstico." });
      return;
    }

    setHubspotDiagnostics(data.results);
    await loadHubspotIntegration();
  };

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Carregando...</div>;
  }

  const integrationByProvider: Record<ProviderId, IntegrationRow | null> = {
    asaas: integration,
    hubla: hublaIntegration,
    hubspot: hubspotIntegration,
  };

  const connectedProviders = PROVIDERS.filter(
    (p): p is ProviderDef & { id: ProviderId } => !p.comingSoon && !!integrationByProvider[p.id as ProviderId],
  );

  return (
    <div className="p-6">
      <h1 className="text-xl font-medium">Integrações</h1>
      <p className="mt-1 text-sm text-muted-foreground">Conecte as fontes de dados do workspace.</p>

      <h2 className="mt-8 text-sm font-medium text-muted-foreground">Integrações disponíveis</h2>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {PROVIDERS.map((provider) => {
          const row = provider.comingSoon ? null : integrationByProvider[provider.id as ProviderId];
          return (
            <div key={provider.id} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <IconBadge color={provider.color} letter={provider.letter} />
                  <div>
                    <p className="font-medium">{provider.name}</p>
                    <p className="text-xs text-muted-foreground">{provider.description}</p>
                  </div>
                </div>
              </div>
              {row && <Badge variant={statusVariant[row.status]}>{statusLabel[row.status]}</Badge>}
              <Button
                size="sm"
                variant={row ? "outline" : "default"}
                disabled={provider.comingSoon}
                onClick={() => setOpenDialog(provider.id as ProviderId)}
              >
                {provider.comingSoon ? "Em breve" : row ? "Configurar" : "Conectar"}
              </Button>
            </div>
          );
        })}
      </div>

      <h2 className="mt-8 text-sm font-medium text-muted-foreground">Minhas integrações</h2>
      {connectedProviders.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Nenhuma integração conectada ainda.</p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {connectedProviders.map((provider) => {
            const row = integrationByProvider[provider.id]!;
            return (
              <div
                key={provider.id}
                className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-center gap-3">
                  <IconBadge color={provider.color} letter={provider.letter} />
                  <div>
                    <p className="font-medium">{provider.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {row.last_synced_at
                        ? `Última atualização: ${new Date(row.last_synced_at).toLocaleString("pt-BR")}`
                        : "Ainda sem sincronização."}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={statusVariant[row.status]}>{statusLabel[row.status]}</Badge>
                  <Button size="sm" variant="outline" onClick={() => setOpenDialog(provider.id)}>
                    Configurar
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* --- Modal Asaas --- */}
      <Dialog open={openDialog === "asaas"} onOpenChange={(o) => setOpenDialog(o ? "asaas" : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Asaas</DialogTitle>
            <DialogDescription>Cobranças e pagamentos.</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
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
                placeholder={integration ? "Cole uma nova chave pra trocar a atual" : "Cole a API key do Asaas"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              {integration?.config.key_preview && (
                <p className="text-xs text-muted-foreground">Chave salva: •••• {integration.config.key_preview}</p>
              )}
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

            {integration && (
              <Button variant="outline" onClick={handleDiagnose} disabled={diagnosing}>
                {diagnosing ? "Consultando..." : "Ver o que a conta Asaas tem de dados"}
              </Button>
            )}

            {diagnostics && <DiagnosticsTable diagnostics={diagnostics} />}
          </div>
        </DialogContent>
      </Dialog>

      {/* --- Modal Hubla --- */}
      <Dialog open={openDialog === "hubla"} onOpenChange={(o) => setOpenDialog(o ? "hubla" : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hubla</DialogTitle>
            <DialogDescription>Vendas via webhook — a Hubla envia pra gente, não o contrário.</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="hubla-webhook-url">URL do webhook (cole no painel da Hubla)</Label>
              <Input id="hubla-webhook-url" readOnly value={webhookUrl} onFocus={(e) => e.target.select()} />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="hubla-token">Token do webhook</Label>
              <Input
                id="hubla-token"
                type="password"
                placeholder={hublaIntegration ? "Cole um novo token pra trocar o atual" : "Cole o token gerado no painel da Hubla"}
                value={hublaToken}
                onChange={(e) => setHublaToken(e.target.value)}
              />
              {hublaIntegration?.config.key_preview && (
                <p className="text-xs text-muted-foreground">
                  Token salvo: •••• {hublaIntegration.config.key_preview}
                </p>
              )}
            </div>

            {hublaFeedback && (
              <p className={hublaFeedback.type === "error" ? "text-sm text-destructive" : "text-sm text-primary"}>
                {hublaFeedback.text}
              </p>
            )}

            {hublaIntegration?.last_synced_at && (
              <p className="text-xs text-muted-foreground">
                Última venda recebida: {new Date(hublaIntegration.last_synced_at).toLocaleString("pt-BR")}
              </p>
            )}

            <Button onClick={handleSaveHublaToken} disabled={hublaSaving}>
              {hublaIntegration ? "Salvar token" : "Conectar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* --- Modal HubSpot --- */}
      <Dialog open={openDialog === "hubspot"} onOpenChange={(o) => setOpenDialog(o ? "hubspot" : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>HubSpot</DialogTitle>
            <DialogDescription>CRM — contatos, empresas, negócios, tickets.</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="hubspot-token">Access token do app privado</Label>
              <Input
                id="hubspot-token"
                type="password"
                placeholder={hubspotIntegration ? "Cole um novo token pra trocar o atual" : "Cole o access token da HubSpot"}
                value={hubspotToken}
                onChange={(e) => setHubspotToken(e.target.value)}
              />
              {hubspotIntegration?.config.key_preview && (
                <p className="text-xs text-muted-foreground">
                  Token salvo: •••• {hubspotIntegration.config.key_preview}
                </p>
              )}
            </div>

            {hubspotFeedback && (
              <p className={hubspotFeedback.type === "error" ? "text-sm text-destructive" : "text-sm text-primary"}>
                {hubspotFeedback.text}
              </p>
            )}

            {hubspotIntegration?.last_synced_at && (
              <p className="text-xs text-muted-foreground">
                Último diagnóstico: {new Date(hubspotIntegration.last_synced_at).toLocaleString("pt-BR")}
              </p>
            )}

            <Button onClick={handleSaveHubspotToken} disabled={hubspotSaving}>
              {hubspotIntegration ? "Salvar token" : "Conectar"}
            </Button>

            {hubspotIntegration && (
              <Button variant="outline" onClick={() => handleDiagnoseHubspot()} disabled={hubspotDiagnosing}>
                {hubspotDiagnosing ? "Consultando..." : "Ver o que a conta HubSpot tem de dados"}
              </Button>
            )}

            {hubspotDiagnostics && <DiagnosticsTable diagnostics={hubspotDiagnostics} />}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
