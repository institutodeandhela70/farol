import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { saveIntegrationCredential } from "@/lib/integrations";
import { IuliIntegrationDialog } from "@/components/iuli/IuliIntegrationDialog";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type IntegrationStatus = "disconnected" | "connected" | "error";
type ProviderId = "asaas" | "hubla" | "hubspot" | "tmb" | "vsix" | "iuli" | "brevo";

interface IntegrationRow {
  id: string;
  status: IntegrationStatus;
  last_synced_at: string | null;
  last_error: string | null;
  sync_enabled: boolean;
  config: {
    environment?: "sandbox" | "production" | "dev" | "prod";
    key_preview?: string;
    instance_id?: string;
    last_diagnostics?: Diagnostics;
    last_diagnostics_at?: string;
    tools?: string[];
    sender_name?: string;
    sender_email?: string;
    reply_to?: string;
  };
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
  // IULI
  get_accounts_receivable: "Contas a receber",
  get_accounts_payable: "Contas a pagar",
  get_sales_summary: "Resumo de vendas (mês)",
  get_bank_balance: "Saldo bancário",
  get_cashflow: "Fluxo de caixa",
  get_dre: "DRE",
  get_dfc: "DFC",
  list_charges: "Cobranças",
  list_invoices: "Notas fiscais",
  list_sales: "Vendas",
  list_products: "Produtos",
  list_cost_centers: "Centros de custo",
  list_projects: "Projetos",
  list_subscriptions: "Assinaturas",
};

interface ProviderDef {
  id: ProviderId | "hotmart";
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
  { id: "tmb", name: "TMB", description: "Vendas parceladas via boleto.", color: "#F59E0B", letter: "T" },
  { id: "vsix", name: "VSIX", description: "Mensageria de WhatsApp.", color: "#25D366", letter: "V" },
  { id: "iuli", name: "IULI", description: "ERP financeiro — vendas, a receber, assinaturas.", color: "#2563EB", letter: "I" },
  { id: "brevo", name: "Brevo", description: "E-mail transacional — boas-vindas, reset de senha.", color: "#0B996E", letter: "B" },
  { id: "hotmart", name: "Hotmart", description: "Em breve.", color: "#64748B", letter: "H", comingSoon: true },
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
      .select("id, status, last_synced_at, last_error, sync_enabled, config")
      .eq("workspace_id", workspace.id)
      .eq("provider", "asaas")
      .maybeSingle();

    setIntegration(data as IntegrationRow | null);
    setEnvironment((data?.config?.environment as "sandbox" | "production") ?? "sandbox");
    setDiagnostics((data?.config?.last_diagnostics as Diagnostics) ?? null);
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
      .select("id, status, last_synced_at, last_error, sync_enabled, config")
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
  const [hubspotSyncing, setHubspotSyncing] = useState(false);

  const loadHubspotIntegration = async () => {
    if (!workspace) return;
    const { data } = await supabase
      .from("integrations")
      .select("id, status, last_synced_at, last_error, sync_enabled, config")
      .eq("workspace_id", workspace.id)
      .eq("provider", "hubspot")
      .maybeSingle();
    setHubspotIntegration(data as IntegrationRow | null);
    setHubspotDiagnostics((data?.config?.last_diagnostics as Diagnostics) ?? null);
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

  const handleSyncHubspot = async () => {
    if (!hubspotIntegration) return;
    setHubspotSyncing(true);
    setHubspotFeedback(null);

    const { data, error } = await supabase.functions.invoke("sync-hubspot", {
      body: { integration_id: hubspotIntegration.id },
    });

    setHubspotSyncing(false);
    await loadHubspotIntegration();

    if (error || data?.error) {
      setHubspotFeedback({ type: "error", text: data?.error ?? "Falha ao sincronizar." });
    } else {
      setHubspotFeedback({ type: "success", text: `Sincronizado: ${data?.synced ?? 0} registro(s).` });
    }
  };

  // --- TMB ---
  const [tmbIntegration, setTmbIntegration] = useState<IntegrationRow | null>(null);
  const [tmbToken, setTmbToken] = useState("");
  const [tmbWebhookSecret, setTmbWebhookSecret] = useState("");
  const [tmbSaving, setTmbSaving] = useState(false);
  const [tmbSyncing, setTmbSyncing] = useState(false);
  const [tmbFeedback, setTmbFeedback] = useState<{ type: "error" | "success"; text: string } | null>(null);

  const tmbWebhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tmb-webhook`;

  const loadTmbIntegration = async () => {
    if (!workspace) return;
    const { data } = await supabase
      .from("integrations")
      .select("id, status, last_synced_at, last_error, sync_enabled, config")
      .eq("workspace_id", workspace.id)
      .eq("provider", "tmb")
      .maybeSingle();
    setTmbIntegration(data as IntegrationRow | null);
  };

  useEffect(() => {
    loadTmbIntegration();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace?.id]);

  const handleSaveTmb = async () => {
    if (!workspace) return;
    if (!tmbToken.trim() || !tmbWebhookSecret.trim()) {
      setTmbFeedback({ type: "error", text: "Preencha o Bearer token da API e o valor do header do webhook." });
      return;
    }

    setTmbSaving(true);
    setTmbFeedback(null);

    const trimmedToken = tmbToken.trim();
    const { integrationId, error } = await saveIntegrationCredential({
      workspaceId: workspace.id,
      provider: "tmb",
      config: { key_preview: trimmedToken.slice(-4) },
      secretValue: trimmedToken,
      webhookSecretValue: tmbWebhookSecret.trim(),
    });

    if (error || !integrationId) {
      setTmbSaving(false);
      setTmbFeedback({ type: "error", text: error ?? "Falha ao salvar." });
      return;
    }

    setTmbToken("");
    setTmbWebhookSecret("");
    await handleSyncTmb(integrationId);
    setTmbSaving(false);
  };

  const handleSyncTmb = async (integrationId?: string) => {
    const id = integrationId ?? tmbIntegration?.id;
    if (!id) return;

    setTmbSyncing(true);
    setTmbFeedback(null);

    const { data, error } = await supabase.functions.invoke("sync-tmb", {
      body: { integration_id: id },
    });

    setTmbSyncing(false);
    await loadTmbIntegration();

    if (error || data?.error) {
      setTmbFeedback({ type: "error", text: data?.error ?? "Falha ao sincronizar." });
    } else {
      setTmbFeedback({ type: "success", text: `Sincronizado: ${data?.synced ?? 0} pedido(s).` });
    }
  };

  // --- VSIX ---
  const [vsixIntegration, setVsixIntegration] = useState<IntegrationRow | null>(null);
  const [vsixApiKey, setVsixApiKey] = useState("");
  const [vsixEnvironment, setVsixEnvironment] = useState<"dev" | "prod">("dev");
  const [vsixInstanceId, setVsixInstanceId] = useState("");
  const [vsixSaving, setVsixSaving] = useState(false);
  const [vsixFeedback, setVsixFeedback] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [vsixTestPhone, setVsixTestPhone] = useState("");
  const [vsixTestText, setVsixTestText] = useState("Olá! Esse é um teste da integração do Farol com o VSIX.");
  const [vsixTesting, setVsixTesting] = useState(false);

  const loadVsixIntegration = async () => {
    if (!workspace) return;
    const { data } = await supabase
      .from("integrations")
      .select("id, status, last_synced_at, last_error, sync_enabled, config")
      .eq("workspace_id", workspace.id)
      .eq("provider", "vsix")
      .maybeSingle();
    const row = data as IntegrationRow | null;
    setVsixIntegration(row);
    setVsixEnvironment(row?.config?.environment === "prod" ? "prod" : "dev");
    setVsixInstanceId(row?.config?.instance_id ?? "");
  };

  useEffect(() => {
    loadVsixIntegration();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace?.id]);

  const handleSaveVsix = async () => {
    if (!workspace) return;
    if (!vsixInstanceId.trim()) {
      setVsixFeedback({ type: "error", text: "Cole o ID da instância de WhatsApp antes de salvar." });
      return;
    }
    if (!vsixApiKey.trim() && !vsixIntegration) {
      setVsixFeedback({ type: "error", text: "Cole a chave da API do VSIX antes de salvar." });
      return;
    }

    setVsixSaving(true);
    setVsixFeedback(null);

    const trimmedKey = vsixApiKey.trim();
    const config: Record<string, unknown> = {
      environment: vsixEnvironment,
      instance_id: vsixInstanceId.trim(),
    };
    if (trimmedKey) config.key_preview = trimmedKey.slice(-4);
    else if (vsixIntegration?.config.key_preview) config.key_preview = vsixIntegration.config.key_preview;

    if (!trimmedKey) {
      // Só mudou ambiente/instância, mantém a chave já salva — não passa
      // secretValue vazio, senão sobrescreve a credencial com string vazia.
      const { error } = await supabase.from("integrations").update({ config }).eq("id", vsixIntegration!.id);
      setVsixSaving(false);
      if (error) {
        setVsixFeedback({ type: "error", text: error.message });
        return;
      }
      setVsixFeedback({ type: "success", text: "Configuração salva." });
      await loadVsixIntegration();
      return;
    }

    const { error } = await saveIntegrationCredential({
      workspaceId: workspace.id,
      provider: "vsix",
      config,
      secretValue: trimmedKey,
    });

    setVsixSaving(false);

    if (error) {
      setVsixFeedback({ type: "error", text: error });
      return;
    }

    setVsixApiKey("");
    setVsixFeedback({ type: "success", text: "Integração salva." });
    await loadVsixIntegration();
  };

  const handleTestVsix = async () => {
    if (!vsixIntegration) return;
    if (!vsixTestPhone.trim() || !vsixTestText.trim()) {
      setVsixFeedback({ type: "error", text: "Preencha telefone e texto pra mandar o teste." });
      return;
    }

    setVsixTesting(true);
    setVsixFeedback(null);

    const { data, error } = await supabase.functions.invoke("send-vsix-message", {
      body: {
        integration_id: vsixIntegration.id,
        to: { type: "phone", value: vsixTestPhone.trim() },
        type: "text",
        text: vsixTestText.trim(),
        idempotency_key: crypto.randomUUID(),
      },
    });

    setVsixTesting(false);
    await loadVsixIntegration();

    if (error || data?.error) {
      setVsixFeedback({ type: "error", text: `Falha ao enviar: ${data?.error?.message ?? data?.error ?? error?.message}` });
    } else {
      setVsixFeedback({ type: "success", text: `Mensagem enviada (id ${data?.message_id ?? "—"}).` });
    }
  };

  // --- IULI (uma conexão por empresa — ver IuliIntegrationDialog) ---
  const [iuliIntegration, setIuliIntegration] = useState<IntegrationRow | null>(null);

  // --- Brevo ---
  const [brevoIntegration, setBrevoIntegration] = useState<IntegrationRow | null>(null);
  const [brevoApiKey, setBrevoApiKey] = useState("");
  const [brevoSenderName, setBrevoSenderName] = useState("Farol ID");
  const [brevoSenderEmail, setBrevoSenderEmail] = useState("");
  const [brevoReplyTo, setBrevoReplyTo] = useState("");
  const [brevoSaving, setBrevoSaving] = useState(false);
  const [brevoFeedback, setBrevoFeedback] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [brevoTestEmail, setBrevoTestEmail] = useState("");
  const [brevoTesting, setBrevoTesting] = useState(false);

  const loadBrevoIntegration = async () => {
    if (!workspace) return;
    const { data } = await supabase
      .from("integrations")
      .select("id, status, last_synced_at, last_error, sync_enabled, config")
      .eq("workspace_id", workspace.id)
      .eq("provider", "brevo")
      .maybeSingle();
    const row = data as IntegrationRow | null;
    setBrevoIntegration(row);
    setBrevoSenderName(row?.config?.sender_name ?? "Farol ID");
    setBrevoSenderEmail(row?.config?.sender_email ?? "");
    setBrevoReplyTo(row?.config?.reply_to ?? "");
  };

  useEffect(() => {
    loadBrevoIntegration();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace?.id]);

  const handleSaveBrevo = async () => {
    if (!workspace) return;
    if (!brevoSenderEmail.trim()) {
      setBrevoFeedback({ type: "error", text: "Informe o e-mail do remetente antes de salvar." });
      return;
    }
    if (!brevoApiKey.trim() && !brevoIntegration) {
      setBrevoFeedback({ type: "error", text: "Cole a API key do Brevo antes de conectar." });
      return;
    }

    setBrevoSaving(true);
    setBrevoFeedback(null);

    const trimmedKey = brevoApiKey.trim();
    const config: Record<string, unknown> = {
      sender_name: brevoSenderName.trim() || "Farol ID",
      sender_email: brevoSenderEmail.trim(),
      reply_to: brevoReplyTo.trim() || undefined,
    };
    if (trimmedKey) config.key_preview = trimmedKey.slice(-4);
    else if (brevoIntegration?.config.key_preview) config.key_preview = brevoIntegration.config.key_preview;

    if (!trimmedKey) {
      // Só mudou remetente/reply-to, mantém a chave já salva.
      const { error } = await supabase.from("integrations").update({ config }).eq("id", brevoIntegration!.id);
      setBrevoSaving(false);
      if (error) {
        setBrevoFeedback({ type: "error", text: error.message });
        return;
      }
      setBrevoFeedback({ type: "success", text: "Configuração salva." });
      await loadBrevoIntegration();
      return;
    }

    const { error } = await saveIntegrationCredential({
      workspaceId: workspace.id,
      provider: "brevo",
      config,
      secretValue: trimmedKey,
    });

    setBrevoSaving(false);

    if (error) {
      setBrevoFeedback({ type: "error", text: error });
      return;
    }

    setBrevoApiKey("");
    setBrevoFeedback({ type: "success", text: "Integração salva." });
    await loadBrevoIntegration();
  };

  const handleTestBrevo = async () => {
    if (!brevoIntegration) return;
    if (!brevoTestEmail.trim()) {
      setBrevoFeedback({ type: "error", text: "Informe um e-mail de destino pra mandar o teste." });
      return;
    }

    setBrevoTesting(true);
    setBrevoFeedback(null);

    const { data, error } = await supabase.functions.invoke("send-test-email", {
      body: { integration_id: brevoIntegration.id, to_email: brevoTestEmail.trim() },
    });

    setBrevoTesting(false);
    await loadBrevoIntegration();

    if (error || data?.error) {
      setBrevoFeedback({ type: "error", text: `Falha ao enviar: ${data?.error ?? error?.message}` });
    } else {
      setBrevoFeedback({ type: "success", text: `E-mail de teste enviado para ${brevoTestEmail.trim()}.` });
    }
  };

  const handleToggleSync = async (integrationId: string, current: boolean, reload: () => Promise<void>) => {
    await supabase.from("integrations").update({ sync_enabled: !current }).eq("id", integrationId);
    await reload();
  };

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Carregando...</div>;
  }

  const integrationByProvider: Record<ProviderId, IntegrationRow | null> = {
    asaas: integration,
    hubla: hublaIntegration,
    hubspot: hubspotIntegration,
    tmb: tmbIntegration,
    vsix: vsixIntegration,
    iuli: iuliIntegration,
    brevo: brevoIntegration,
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
            <div className="flex items-center gap-2">
              <DialogTitle>Asaas</DialogTitle>
              {integration && <Badge variant={statusVariant[integration.status]}>{statusLabel[integration.status]}</Badge>}
            </div>
            <DialogDescription>Cobranças e pagamentos.</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            {integration && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={integration.sync_enabled}
                  onChange={() => handleToggleSync(integration.id, integration.sync_enabled, loadIntegration)}
                />
                Sincronização automática diária ativada
              </label>
            )}

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
            <div className="flex items-center gap-2">
              <DialogTitle>Hubla</DialogTitle>
              {hublaIntegration && (
                <Badge variant={statusVariant[hublaIntegration.status]}>{statusLabel[hublaIntegration.status]}</Badge>
              )}
            </div>
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
            <div className="flex items-center gap-2">
              <DialogTitle>HubSpot</DialogTitle>
              {hubspotIntegration && (
                <Badge variant={statusVariant[hubspotIntegration.status]}>{statusLabel[hubspotIntegration.status]}</Badge>
              )}
            </div>
            <DialogDescription>CRM — contatos, empresas, negócios, tickets.</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            {hubspotIntegration && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={hubspotIntegration.sync_enabled}
                  onChange={() =>
                    handleToggleSync(hubspotIntegration.id, hubspotIntegration.sync_enabled, loadHubspotIntegration)
                  }
                />
                Sincronização automática diária ativada
              </label>
            )}

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

            <div className="flex gap-2">
              <Button onClick={handleSaveHubspotToken} disabled={hubspotSaving}>
                {hubspotIntegration ? "Salvar token" : "Conectar"}
              </Button>
              {hubspotIntegration?.status === "connected" && (
                <Button variant="outline" onClick={handleSyncHubspot} disabled={hubspotSyncing}>
                  {hubspotSyncing ? "Sincronizando..." : "Sincronizar agora"}
                </Button>
              )}
            </div>

            {hubspotIntegration && (
              <Button variant="outline" onClick={() => handleDiagnoseHubspot()} disabled={hubspotDiagnosing}>
                {hubspotDiagnosing ? "Consultando..." : "Ver o que a conta HubSpot tem de dados"}
              </Button>
            )}

            {hubspotDiagnostics && <DiagnosticsTable diagnostics={hubspotDiagnostics} />}
          </div>
        </DialogContent>
      </Dialog>

      {/* --- Modal TMB --- */}
      <Dialog open={openDialog === "tmb"} onOpenChange={(o) => setOpenDialog(o ? "tmb" : null)}>
        <DialogContent>
          <DialogHeader>
            <div className="flex items-center gap-2">
              <DialogTitle>TMB</DialogTitle>
              {tmbIntegration && (
                <Badge variant={statusVariant[tmbIntegration.status]}>{statusLabel[tmbIntegration.status]}</Badge>
              )}
            </div>
            <DialogDescription>Vendas parceladas via boleto — webhook (Vendas, Financeiro, Etapas do Checkout) + API REST.</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            {tmbIntegration && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={tmbIntegration.sync_enabled}
                  onChange={() => handleToggleSync(tmbIntegration.id, tmbIntegration.sync_enabled, loadTmbIntegration)}
                />
                Sincronização automática diária ativada
              </label>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tmb-webhook-url">URL do webhook (cole nas 3 seções do painel da TMB: Vendas, Financeiro e Etapas do Checkout)</Label>
              <Input id="tmb-webhook-url" readOnly value={tmbWebhookUrl} onFocus={(e) => e.target.select()} />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tmb-webhook-header">Nome do header (configure exatamente assim nas 3 seções)</Label>
              <Input id="tmb-webhook-header" readOnly value="x-tmb-token" onFocus={(e) => e.target.select()} />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tmb-webhook-secret">Valor do header (cole o mesmo valor nas 3 seções)</Label>
              <div className="flex gap-2">
                <Input
                  id="tmb-webhook-secret"
                  type="text"
                  placeholder={tmbIntegration ? "Clique em Gerar pra trocar o atual" : "Clique em Gerar pra criar um valor"}
                  value={tmbWebhookSecret}
                  onChange={(e) => setTmbWebhookSecret(e.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setTmbWebhookSecret(crypto.randomUUID().replace(/-/g, ""))}
                >
                  Gerar
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Depois de gerar, copie esse valor e cole no campo "Valor" das 3 configurações de webhook no painel da TMB.
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tmb-token">Bearer token da API (Portal do Produtor → Produtos → TMB API)</Label>
              <Input
                id="tmb-token"
                type="password"
                placeholder={tmbIntegration ? "Cole um novo token pra trocar o atual" : "Cole o Bearer token da TMB"}
                value={tmbToken}
                onChange={(e) => setTmbToken(e.target.value)}
              />
              {tmbIntegration?.config.key_preview && (
                <p className="text-xs text-muted-foreground">Token salvo: •••• {tmbIntegration.config.key_preview}</p>
              )}
            </div>

            {tmbFeedback && (
              <p className={tmbFeedback.type === "error" ? "text-sm text-destructive" : "text-sm text-primary"}>
                {tmbFeedback.text}
              </p>
            )}

            {tmbIntegration?.last_synced_at && (
              <p className="text-xs text-muted-foreground">
                Última atualização: {new Date(tmbIntegration.last_synced_at).toLocaleString("pt-BR")}
              </p>
            )}

            <div className="flex gap-2">
              <Button onClick={handleSaveTmb} disabled={tmbSaving}>
                {tmbIntegration ? "Salvar credenciais" : "Conectar"}
              </Button>
              {tmbIntegration && (
                <Button variant="outline" onClick={() => handleSyncTmb()} disabled={tmbSyncing}>
                  {tmbSyncing ? "Sincronizando..." : "Sincronizar agora"}
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* --- Modal VSIX --- */}
      <Dialog open={openDialog === "vsix"} onOpenChange={(o) => setOpenDialog(o ? "vsix" : null)}>
        <DialogContent>
          <DialogHeader>
            <div className="flex items-center gap-2">
              <DialogTitle>VSIX</DialogTitle>
              {vsixIntegration && <Badge variant={statusVariant[vsixIntegration.status]}>{statusLabel[vsixIntegration.status]}</Badge>}
            </div>
            <DialogDescription>Mensageria de WhatsApp — por aqui o Farol dispara as mensagens dos eventos.</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="vsix-env">Ambiente</Label>
              <select
                id="vsix-env"
                value={vsixEnvironment}
                onChange={(e) => setVsixEnvironment(e.target.value as "dev" | "prod")}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="dev">Desenvolvimento (dev.vsix.ia.br)</option>
                <option value="prod">Produção (www.vsix.ia.br)</option>
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="vsix-instance">ID da instância de WhatsApp</Label>
              <Input
                id="vsix-instance"
                placeholder="uuid da instância (Configurações > Integração API no VSIX)"
                value={vsixInstanceId}
                onChange={(e) => setVsixInstanceId(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="vsix-key">Chave da API</Label>
              <Input
                id="vsix-key"
                type="password"
                placeholder={vsixIntegration ? "Cole uma nova chave pra trocar a atual" : "Cole a chave vsix_live_... ou vsix_test_..."}
                value={vsixApiKey}
                onChange={(e) => setVsixApiKey(e.target.value)}
              />
              {vsixIntegration?.config.key_preview && (
                <p className="text-xs text-muted-foreground">Chave salva: •••• {vsixIntegration.config.key_preview}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Use uma chave <code>vsix_test_...</code> pra testar sem enviar mensagem de verdade.
              </p>
            </div>

            {vsixFeedback && (
              <p className={vsixFeedback.type === "error" ? "text-sm text-destructive" : "text-sm text-primary"}>
                {vsixFeedback.text}
              </p>
            )}

            {vsixIntegration?.last_synced_at && (
              <p className="text-xs text-muted-foreground">
                Última mensagem enviada: {new Date(vsixIntegration.last_synced_at).toLocaleString("pt-BR")}
              </p>
            )}

            <Button onClick={handleSaveVsix} disabled={vsixSaving}>
              {vsixSaving ? "Salvando..." : vsixIntegration ? "Salvar" : "Conectar"}
            </Button>

            {vsixIntegration && (
              <div className="mt-2 flex flex-col gap-3 border-t border-border pt-3">
                <p className="text-sm font-medium">Enviar mensagem de teste</p>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="vsix-test-phone">Telefone (com DDI)</Label>
                  <Input
                    id="vsix-test-phone"
                    placeholder="+5561999990000"
                    value={vsixTestPhone}
                    onChange={(e) => setVsixTestPhone(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="vsix-test-text">Texto</Label>
                  <textarea
                    id="vsix-test-text"
                    value={vsixTestText}
                    onChange={(e) => setVsixTestText(e.target.value)}
                    className="min-h-16 rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>
                <Button variant="outline" onClick={handleTestVsix} disabled={vsixTesting}>
                  {vsixTesting ? "Enviando..." : "Enviar teste"}
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* --- Modal IULI --- */}
      <IuliIntegrationDialog
        workspaceId={workspace?.id}
        open={openDialog === "iuli"}
        onOpenChange={(o) => setOpenDialog(o ? "iuli" : null)}
        onSummaryChange={(summary) => setIuliIntegration(summary as IntegrationRow | null)}
        renderDiagnostics={(d) => <DiagnosticsTable diagnostics={d} />}
      />

      {/* --- Modal Brevo --- */}
      <Dialog open={openDialog === "brevo"} onOpenChange={(o) => setOpenDialog(o ? "brevo" : null)}>
        <DialogContent>
          <DialogHeader>
            <div className="flex items-center gap-2">
              <DialogTitle>Brevo</DialogTitle>
              {brevoIntegration && (
                <Badge variant={statusVariant[brevoIntegration.status]}>{statusLabel[brevoIntegration.status]}</Badge>
              )}
            </div>
            <DialogDescription>
              E-mail transacional — boas-vindas com senha temporária, reset de senha e convites de equipe.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="brevo-sender-name">Nome do remetente</Label>
              <Input
                id="brevo-sender-name"
                placeholder="Farol ID"
                value={brevoSenderName}
                onChange={(e) => setBrevoSenderName(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="brevo-sender-email">E-mail do remetente</Label>
              <Input
                id="brevo-sender-email"
                type="email"
                placeholder="contato@seudominio.com.br"
                value={brevoSenderEmail}
                onChange={(e) => setBrevoSenderEmail(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Precisa ser um remetente/domínio verificado na sua conta Brevo.</p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="brevo-reply-to">Reply-to (opcional)</Label>
              <Input
                id="brevo-reply-to"
                type="email"
                placeholder="suporte@seudominio.com.br"
                value={brevoReplyTo}
                onChange={(e) => setBrevoReplyTo(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="brevo-key">API key</Label>
              <Input
                id="brevo-key"
                type="password"
                placeholder={brevoIntegration ? "Cole uma nova chave pra trocar a atual" : "Cole a API key do Brevo (xkeysib-...)"}
                value={brevoApiKey}
                onChange={(e) => setBrevoApiKey(e.target.value)}
              />
              {brevoIntegration?.config.key_preview && (
                <p className="text-xs text-muted-foreground">Chave salva: •••• {brevoIntegration.config.key_preview}</p>
              )}
            </div>

            {brevoFeedback && (
              <p className={brevoFeedback.type === "error" ? "text-sm text-destructive" : "text-sm text-primary"}>
                {brevoFeedback.text}
              </p>
            )}

            {brevoIntegration?.last_synced_at && (
              <p className="text-xs text-muted-foreground">
                Último teste enviado: {new Date(brevoIntegration.last_synced_at).toLocaleString("pt-BR")}
              </p>
            )}

            <Button onClick={handleSaveBrevo} disabled={brevoSaving}>
              {brevoSaving ? "Salvando..." : brevoIntegration ? "Salvar" : "Conectar"}
            </Button>

            {brevoIntegration && (
              <div className="mt-2 flex flex-col gap-3 border-t border-border pt-3">
                <p className="text-sm font-medium">Enviar e-mail de teste</p>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="brevo-test-email">E-mail de destino</Label>
                  <Input
                    id="brevo-test-email"
                    type="email"
                    placeholder="voce@exemplo.com"
                    value={brevoTestEmail}
                    onChange={(e) => setBrevoTestEmail(e.target.value)}
                  />
                </div>
                <Button variant="outline" onClick={handleTestBrevo} disabled={brevoTesting}>
                  {brevoTesting ? "Enviando..." : "Enviar teste"}
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
