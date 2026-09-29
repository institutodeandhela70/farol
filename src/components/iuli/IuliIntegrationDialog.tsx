import { useEffect, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { saveIntegrationCredential } from "@/lib/integrations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Janela da IULI em Integrações. Na IULI cada empresa tem seu próprio token do
// MCP, então aqui é uma lista de empresas — cada uma é uma integração IULI
// separada (label = nome da empresa), e os dados de cada uma ficam marcados
// com o integration_id de origem.

type Status = "disconnected" | "connected" | "error";
type Diagnostics = Record<string, { ok: boolean; total?: number | null; status?: number; error?: string }>;

export interface IuliCompanyRow {
  id: string;
  label: string | null;
  status: Status;
  last_synced_at: string | null;
  last_error: string | null;
  sync_enabled: boolean;
  config: { key_preview?: string; tools?: string[]; last_diagnostics?: Diagnostics };
}

const STATUS_LABEL: Record<Status, string> = { disconnected: "Desconectado", connected: "Conectado", error: "Erro" };
const STATUS_VARIANT: Record<Status, "secondary" | "default" | "destructive"> = {
  disconnected: "secondary",
  connected: "default",
  error: "destructive",
};

/** Resumo das empresas pro card da lista de integrações (qualquer erro → erro). */
function summarizeIuli(rows: IuliCompanyRow[]): IuliCompanyRow | null {
  if (!rows.length) return null;
  const status: Status = rows.some((r) => r.status === "error") ? "error" : rows.some((r) => r.status === "connected") ? "connected" : "disconnected";
  const last = rows.map((r) => r.last_synced_at).filter((d): d is string => !!d).sort().at(-1) ?? null;
  return { ...rows[0], status, last_synced_at: last };
}

type Feedback = { type: "error" | "success"; text: string } | null;

function CompanyCard({
  workspaceId,
  row,
  onChanged,
  renderDiagnostics,
}: {
  workspaceId: string;
  row: IuliCompanyRow;
  onChanged: () => Promise<void>;
  renderDiagnostics: (d: Diagnostics) => ReactNode;
}) {
  const [label, setLabel] = useState(row.label ?? "");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const saveLabel = async () => {
    if (!label.trim() || label.trim() === row.label) return;
    setBusy(true);
    const { error } = await supabase.from("integrations").update({ label: label.trim() }).eq("id", row.id);
    setBusy(false);
    setFeedback(error ? { type: "error", text: error.message.includes("iuli_label") ? "Já existe uma empresa com esse nome." : error.message } : { type: "success", text: "Nome salvo." });
    await onChanged();
  };

  const diagnose = async () => {
    setBusy(true);
    setFeedback(null);
    const { data, error } = await supabase.functions.invoke("diagnose-iuli", { body: { integration_id: row.id } });
    setBusy(false);
    setShowDiagnostics(true);
    await onChanged();
    setFeedback(
      error || data?.error || !data?.results
        ? { type: "error", text: `Falha ao conectar: ${data?.error ?? error?.message ?? "sem resposta"}` }
        : { type: "success", text: `Conectado. O token libera ${data.tools?.length ?? 0} função(ões) da IULI.` },
    );
  };

  const replaceToken = async () => {
    if (!token.trim()) return;
    setBusy(true);
    const trimmed = token.trim();
    const { error } = await saveIntegrationCredential({
      workspaceId,
      provider: "iuli",
      integrationId: row.id,
      config: { ...row.config, key_preview: trimmed.slice(-4) },
      secretValue: trimmed,
    });
    setBusy(false);
    if (error) {
      setFeedback({ type: "error", text: error });
      return;
    }
    setToken("");
    await diagnose();
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <div className="flex items-center gap-2">
        <Input aria-label="Nome da empresa" value={label} onChange={(e) => setLabel(e.target.value)} onBlur={saveLabel} className="h-9 font-medium" />
        <Badge variant={STATUS_VARIANT[row.status]}>{STATUS_LABEL[row.status]}</Badge>
      </div>

      <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
        {row.config.key_preview && <span>Token salvo: •••• {row.config.key_preview}</span>}
        {row.config.tools && <span>{row.config.tools.length} funções liberadas no token</span>}
        {row.last_synced_at && <span>Última atualização: {new Date(row.last_synced_at).toLocaleString("pt-BR")}</span>}
        {row.status === "error" && row.last_error && <span className="text-destructive">{row.last_error}</span>}
      </div>

      <div className="flex gap-2">
        <Input type="password" placeholder="Cole um novo token pra trocar o atual" value={token} onChange={(e) => setToken(e.target.value)} className="h-9" />
        <Button size="sm" variant="outline" onClick={replaceToken} disabled={busy || !token.trim()}>
          Trocar
        </Button>
      </div>

      <Button size="sm" variant="outline" onClick={() => (showDiagnostics && row.config.last_diagnostics ? setShowDiagnostics(false) : diagnose())} disabled={busy}>
        {busy ? "Consultando..." : showDiagnostics ? "Ocultar dados liberados" : "Ver o que o token libera de dados"}
      </Button>

      {feedback && <p className={feedback.type === "error" ? "text-sm text-destructive" : "text-sm text-primary"}>{feedback.text}</p>}
      {showDiagnostics && row.config.last_diagnostics && renderDiagnostics(row.config.last_diagnostics)}
    </div>
  );
}

export function IuliIntegrationDialog({
  workspaceId,
  open,
  onOpenChange,
  onSummaryChange,
  renderDiagnostics,
}: {
  workspaceId: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSummaryChange: (summary: IuliCompanyRow | null) => void;
  renderDiagnostics: (d: Diagnostics) => ReactNode;
}) {
  const [rows, setRows] = useState<IuliCompanyRow[]>([]);
  const [newLabel, setNewLabel] = useState("");
  const [newToken, setNewToken] = useState("");
  const [adding, setAdding] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const load = async () => {
    if (!workspaceId) return;
    const { data } = await supabase
      .from("integrations")
      .select("id, label, status, last_synced_at, last_error, sync_enabled, config")
      .eq("workspace_id", workspaceId)
      .eq("provider", "iuli")
      .order("created_at");
    const list = (data ?? []) as IuliCompanyRow[];
    setRows(list);
    onSummaryChange(summarizeIuli(list));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  const addCompany = async () => {
    if (!workspaceId) return;
    if (!newLabel.trim() || !newToken.trim()) {
      setFeedback({ type: "error", text: "Preencha o nome da empresa e o token." });
      return;
    }
    setAdding(true);
    setFeedback(null);
    const trimmed = newToken.trim();
    const { integrationId, error } = await saveIntegrationCredential({
      workspaceId,
      provider: "iuli",
      forceNew: true,
      label: newLabel.trim(),
      config: { key_preview: trimmed.slice(-4) },
      secretValue: trimmed,
    });
    if (error || !integrationId) {
      setAdding(false);
      setFeedback({ type: "error", text: error?.includes("iuli_label") ? "Já existe uma empresa com esse nome." : error ?? "Falha ao salvar." });
      return;
    }

    const { data, error: diagError } = await supabase.functions.invoke("diagnose-iuli", { body: { integration_id: integrationId } });
    setAdding(false);
    await load();
    if (diagError || data?.error || !data?.results) {
      setFeedback({ type: "error", text: `Empresa salva, mas a IULI recusou o token: ${data?.error ?? diagError?.message ?? "sem resposta"}` });
      return;
    }

    setNewLabel("");
    setNewToken("");
    setShowAdd(false);
    setFeedback({
      type: "success",
      text: `${data.tools?.length ?? 0} funções liberadas. A carga inicial dos dados começa sozinha e roda em segundo plano (pode levar algumas horas, no ritmo que a IULI permite).`,
    });
    // Começa a carga já, sem esperar o próximo ciclo do cron.
    supabase.functions.invoke("sync-iuli-records", { body: { integration_id: integrationId } });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>IULI</DialogTitle>
          <DialogDescription>
            ERP financeiro, só leitura. Na IULI cada empresa tem seu próprio token: adicione uma conexão por empresa. No dashboard dá pra ver tudo junto ou filtrar por empresa.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {rows.map((row) => (
            <CompanyCard key={row.id} workspaceId={workspaceId!} row={row} onChanged={load} renderDiagnostics={renderDiagnostics} />
          ))}

          {showAdd || rows.length === 0 ? (
            <div className="flex flex-col gap-3 rounded-lg border border-dashed border-border p-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="iuli-new-label">Nome da empresa</Label>
                <Input id="iuli-new-label" placeholder="Ex: Instituto, Raffa Nunes…" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="iuli-new-token">Token do MCP da empresa</Label>
                <Input id="iuli-new-token" type="password" placeholder="Cole o token Bearer fixo da IULI" value={newToken} onChange={(e) => setNewToken(e.target.value)} />
                <p className="text-xs text-muted-foreground">
                  Na IULI: Configurações → Integrações → MCP do Iuli, com a empresa certa selecionada. Use o token fixo, não o Client ID/Secret do OAuth.
                </p>
              </div>
              <div className="flex gap-2">
                <Button onClick={addCompany} disabled={adding}>
                  {adding ? "Conectando..." : "Conectar empresa"}
                </Button>
                {rows.length > 0 && (
                  <Button variant="ghost" onClick={() => setShowAdd(false)} disabled={adding}>
                    Cancelar
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <Button variant="outline" onClick={() => setShowAdd(true)}>
              <Plus className="size-4" />
              Adicionar empresa
            </Button>
          )}

          {feedback && <p className={feedback.type === "error" ? "text-sm text-destructive" : "text-sm text-primary"}>{feedback.text}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
