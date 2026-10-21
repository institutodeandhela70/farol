import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { saveIntegrationCredential } from "@/lib/integrations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Janela da Meta (Meta Ads + Instagram) em Integrações. Fluxo: cola o token do
// System User → diagnóstico (o que o token alcança) → escolhe quais contas de
// anúncio e perfis de Instagram sincronizar → sync-meta grava o cadastro.

type Status = "disconnected" | "connected" | "error";

export interface MetaIntegrationRow {
  id: string;
  status: Status;
  last_synced_at: string | null;
  last_error: string | null;
  sync_enabled: boolean;
  config: { key_preview?: string; api_version?: string };
}

interface AdAccountRow {
  account_id: string;
  name: string | null;
  currency: string | null;
  account_status: number | null;
  business_name: string | null;
  enabled?: boolean;
}

interface IgAccountRow {
  ig_user_id: string;
  username: string | null;
  name: string | null;
  followers_count: number | null;
  page_name: string | null;
  enabled?: boolean;
}

interface Diagnosis {
  api_version: string;
  me: { id: string; name?: string };
  token: {
    type?: string | null;
    is_valid?: boolean | null;
    expires_at?: number | null;
    data_access_expires_at?: number | null;
    scopes?: string[];
    error?: string;
  };
  permissions: { permission: string; status: string }[];
  probes: Record<string, { ok: boolean; count?: number; error?: string }>;
  ad_accounts: AdAccountRow[];
  ig_accounts: IgAccountRow[];
}

const STATUS_LABEL: Record<Status, string> = { disconnected: "Desconectado", connected: "Conectado", error: "Erro" };
const STATUS_VARIANT: Record<Status, "secondary" | "default" | "destructive"> = {
  disconnected: "secondary",
  connected: "default",
  error: "destructive",
};

// account_status da Graph API
const AD_STATUS: Record<number, string> = {
  1: "Ativa",
  2: "Desativada",
  3: "Pendente de pagamento",
  7: "Em análise de risco",
  8: "Período de carência",
  9: "Em período de carência",
  100: "Fechamento pendente",
  101: "Fechada",
  201: "Qualquer ativa",
  202: "Qualquer fechada",
};

const REQUIRED_PERMISSIONS = [
  "ads_read",
  "business_management",
  "instagram_basic",
  "instagram_manage_insights",
  "pages_show_list",
  "pages_read_engagement",
];

type Feedback = { type: "error" | "success"; text: string } | null;

function expiryLabel(expiresAt?: number | null) {
  if (expiresAt === 0) return "Não expira";
  if (!expiresAt) return "—";
  return new Date(expiresAt * 1000).toLocaleString("pt-BR");
}

export function MetaIntegrationDialog({
  workspaceId,
  open,
  onOpenChange,
  onSummaryChange,
}: {
  workspaceId: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSummaryChange: (row: MetaIntegrationRow | null) => void;
}) {
  const [integration, setIntegration] = useState<MetaIntegrationRow | null>(null);
  const [token, setToken] = useState("");
  const [apiVersion, setApiVersion] = useState("v23.0");
  const [busy, setBusy] = useState<"connect" | "diagnose" | "sync" | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);
  const [selAds, setSelAds] = useState<Set<string>>(new Set());
  const [selIgs, setSelIgs] = useState<Set<string>>(new Set());
  const [savedAds, setSavedAds] = useState<AdAccountRow[]>([]);
  const [savedIgs, setSavedIgs] = useState<IgAccountRow[]>([]);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    const { data } = await supabase
      .from("integrations")
      .select("id, status, last_synced_at, last_error, sync_enabled, config")
      .eq("workspace_id", workspaceId)
      .eq("provider", "meta")
      .maybeSingle();
    const row = data as MetaIntegrationRow | null;
    setIntegration(row);
    onSummaryChange(row);
    if (row?.config?.api_version) setApiVersion(row.config.api_version);

    if (row) {
      const [{ data: ads }, { data: igs }] = await Promise.all([
        supabase
          .from("meta_ad_accounts")
          .select("account_id, name, currency, account_status, business_name, enabled")
          .eq("workspace_id", workspaceId)
          .order("name"),
        supabase
          .from("meta_ig_accounts")
          .select("ig_user_id, username, name, followers_count, page_name, enabled")
          .eq("workspace_id", workspaceId)
          .order("username"),
      ]);
      setSavedAds((ads ?? []) as AdAccountRow[]);
      setSavedIgs((igs ?? []) as IgAccountRow[]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  useEffect(() => {
    load();
  }, [load]);

  // Contas exibidas: as do último diagnóstico (se rodou agora) ou as já cadastradas.
  const ads: AdAccountRow[] = diagnosis?.ad_accounts ?? savedAds;
  const igs: IgAccountRow[] = diagnosis?.ig_accounts ?? savedIgs;

  // Seleção inicial: o que já estava habilitado no cadastro; conta nova entra marcada.
  useEffect(() => {
    const adEnabled = new Map(savedAds.map((a) => [a.account_id, a.enabled !== false]));
    const igEnabled = new Map(savedIgs.map((i) => [i.ig_user_id, i.enabled !== false]));
    setSelAds(new Set(ads.filter((a) => adEnabled.get(a.account_id) ?? true).map((a) => a.account_id)));
    setSelIgs(new Set(igs.filter((i) => igEnabled.get(i.ig_user_id) ?? true).map((i) => i.ig_user_id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diagnosis, savedAds, savedIgs]);

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  };

  const runDiagnose = async (integrationId: string) => {
    setBusy("diagnose");
    const { data, error } = await supabase.functions.invoke("diagnose-meta", { body: { integration_id: integrationId } });
    setBusy(null);
    if (error || !data || data.error) {
      let detail = data?.error as string | undefined;
      if (!detail && error && "context" in error) {
        try {
          detail = (await (error as { context: Response }).context.json())?.error;
        } catch {
          /* sem corpo */
        }
      }
      setDiagnosis(null);
      setFeedback({ type: "error", text: detail ?? error?.message ?? "Falha ao rodar o diagnóstico." });
      await load();
      return;
    }
    setDiagnosis(data as Diagnosis);
    setFeedback({ type: "success", text: "Diagnóstico concluído. Escolha as contas e salve a seleção." });
  };

  const handleConnect = async () => {
    if (!workspaceId) return;
    if (!token.trim() && !integration) {
      setFeedback({ type: "error", text: "Cole o token do System User antes de conectar." });
      return;
    }
    setBusy("connect");
    setFeedback(null);

    const trimmed = token.trim();
    let integrationId = integration?.id;
    if (trimmed) {
      const res = await saveIntegrationCredential({
        workspaceId,
        provider: "meta",
        config: { api_version: apiVersion.trim() || "v23.0", key_preview: trimmed.slice(-4) },
        secretValue: trimmed,
      });
      if (res.error || !res.integrationId) {
        setBusy(null);
        setFeedback({ type: "error", text: res.error ?? "Falha ao salvar." });
        return;
      }
      integrationId = res.integrationId;
      setToken("");
    } else if (integration) {
      // só trocou a versão da Graph API
      await supabase
        .from("integrations")
        .update({ config: { ...integration.config, api_version: apiVersion.trim() || "v23.0" } })
        .eq("id", integration.id);
    }

    await load();
    if (integrationId) await runDiagnose(integrationId);
  };

  const handleSync = async () => {
    if (!integration) return;
    setBusy("sync");
    setFeedback(null);
    const { data, error } = await supabase.functions.invoke("sync-meta", {
      body: {
        integration_id: integration.id,
        ad_account_ids: [...selAds],
        ig_account_ids: [...selIgs],
      },
    });
    setBusy(null);
    if (error || data?.error) {
      setFeedback({ type: "error", text: `Falha ao sincronizar: ${data?.error ?? error?.message}` });
    } else {
      setFeedback({
        type: "success",
        text: `Cadastro atualizado: ${data.ad_accounts_enabled}/${data.ad_accounts} conta(s) de anúncio e ${data.ig_accounts_enabled}/${data.ig_accounts} perfil(is) do Instagram ativos.`,
      });
    }
    setDiagnosis(null);
    await load();
  };

  const grantedPerms = new Set((diagnosis?.permissions ?? []).filter((p) => p.status === "granted").map((p) => p.permission));
  const failedProbes = diagnosis ? Object.entries(diagnosis.probes).filter(([, p]) => !p.ok) : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>Meta (Ads + Instagram)</DialogTitle>
            {integration && <Badge variant={STATUS_VARIANT[integration.status]}>{STATUS_LABEL[integration.status]}</Badge>}
          </div>
          <DialogDescription>
            Token de System User do app da Meta. Traz contas de anúncio, campanhas e perfis de Instagram.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="meta-token">Token de acesso (System User)</Label>
            <Input
              id="meta-token"
              type="password"
              placeholder={integration ? "Cole um novo token pra trocar o atual" : "Cole o token do System User (EAA...)"}
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            {integration?.config.key_preview && (
              <p className="text-xs text-muted-foreground">Token salvo: •••• {integration.config.key_preview}</p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="meta-version">Versão da Graph API</Label>
            <Input id="meta-version" value={apiVersion} onChange={(e) => setApiVersion(e.target.value)} className="w-32" />
          </div>

          {feedback && (
            <p className={feedback.type === "error" ? "text-sm text-destructive" : "text-sm text-primary"}>{feedback.text}</p>
          )}
          {integration?.status === "error" && integration.last_error && !feedback && (
            <p className="text-sm text-destructive">{integration.last_error}</p>
          )}

          <div className="flex gap-2">
            <Button onClick={handleConnect} disabled={busy !== null}>
              {busy === "connect" || busy === "diagnose" ? "Consultando a Meta..." : integration ? "Salvar e rodar diagnóstico" : "Conectar e diagnosticar"}
            </Button>
            {integration && (
              <Button variant="outline" onClick={() => runDiagnose(integration.id)} disabled={busy !== null}>
                Só diagnosticar
              </Button>
            )}
          </div>

          {diagnosis && (
            <div className="flex flex-col gap-3 rounded-lg border border-border p-3 text-sm">
              <div>
                <p className="font-medium">Token</p>
                <p className="text-muted-foreground">
                  {diagnosis.me.name ?? diagnosis.me.id} · {diagnosis.token.is_valid === false ? "inválido" : "válido"} · expira:{" "}
                  {expiryLabel(diagnosis.token.expires_at)}
                </p>
              </div>
              <div>
                <p className="font-medium">Permissões</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {REQUIRED_PERMISSIONS.map((p) => (
                    <Badge key={p} variant={grantedPerms.has(p) ? "default" : "destructive"}>
                      {p}
                    </Badge>
                  ))}
                </div>
              </div>
              {failedProbes.length > 0 && (
                <div>
                  <p className="font-medium">Consultas que a Meta recusou</p>
                  <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
                    {failedProbes.map(([k, p]) => (
                      <li key={k}>
                        {k}: {p.error}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {integration && (
            <>
              <div>
                <p className="text-sm font-medium">Contas de anúncio ({ads.length})</p>
                {ads.length === 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">Nenhuma encontrada. Rode o diagnóstico.</p>
                ) : (
                  <div className="mt-1 flex flex-col gap-1">
                    {ads.map((a) => (
                      <label key={a.account_id} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                        <Checkbox
                          checked={selAds.has(a.account_id)}
                          onCheckedChange={() => toggle(selAds, setSelAds, a.account_id)}
                        />
                        <span className="flex-1">
                          {a.name ?? a.account_id}
                          <span className="ml-2 text-xs text-muted-foreground">
                            {a.account_id} · {a.currency ?? "?"}
                            {a.business_name ? ` · ${a.business_name}` : ""}
                          </span>
                        </span>
                        {a.account_status != null && (
                          <Badge variant={a.account_status === 1 ? "default" : "secondary"}>
                            {AD_STATUS[a.account_status] ?? `Status ${a.account_status}`}
                          </Badge>
                        )}
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <p className="text-sm font-medium">Perfis do Instagram ({igs.length})</p>
                {igs.length === 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">Nenhum encontrado. Rode o diagnóstico.</p>
                ) : (
                  <div className="mt-1 flex flex-col gap-1">
                    {igs.map((i) => (
                      <label key={i.ig_user_id} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                        <Checkbox
                          checked={selIgs.has(i.ig_user_id)}
                          onCheckedChange={() => toggle(selIgs, setSelIgs, i.ig_user_id)}
                        />
                        <span className="flex-1">
                          @{i.username ?? i.ig_user_id}
                          <span className="ml-2 text-xs text-muted-foreground">
                            {i.followers_count != null ? `${i.followers_count.toLocaleString("pt-BR")} seguidores` : ""}
                            {i.page_name ? ` · Página ${i.page_name}` : ""}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <Button onClick={handleSync} disabled={busy !== null || (ads.length === 0 && igs.length === 0)}>
                {busy === "sync" ? "Salvando..." : "Salvar seleção e sincronizar"}
              </Button>

              {integration.last_synced_at && (
                <p className="text-xs text-muted-foreground">
                  Última atualização: {new Date(integration.last_synced_at).toLocaleString("pt-BR")}
                </p>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
