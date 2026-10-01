import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface EmailTemplate {
  key: string;
  subject: string;
  html_content: string;
  is_active: boolean;
  updated_at: string;
}

interface EmailLogRow {
  id: string;
  template_key: string | null;
  to_email: string;
  subject: string;
  status: "pending" | "sent" | "failed";
  error_message: string | null;
  created_at: string;
  workspace: { name: string } | null;
}

const TEMPLATE_LABEL: Record<string, string> = {
  "welcome-team-member": "Boas-vindas (cadastro com senha temporária)",
  "password-reset": "Reset de senha",
  "integration-test": "Teste de integração (Brevo)",
};

const TEMPLATE_VARIABLES: Record<string, string[]> = {
  "welcome-team-member": ["name", "email", "temporaryPassword", "loginUrl"],
  "password-reset": ["name", "email", "temporaryPassword", "loginUrl"],
  "integration-test": ["sentAt", "workspaceName"],
};

const STATUS_LABEL: Record<EmailLogRow["status"], string> = {
  pending: "Pendente",
  sent: "Enviado",
  failed: "Falhou",
};

const STATUS_VARIANT: Record<EmailLogRow["status"], "default" | "secondary" | "destructive"> = {
  pending: "secondary",
  sent: "default",
  failed: "destructive",
};

export default function PlatformEmails() {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  const [editing, setEditing] = useState<EmailTemplate | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editHtml, setEditHtml] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [logs, setLogs] = useState<EmailLogRow[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);

  const loadTemplates = async () => {
    setLoading(true);
    const { data } = await supabase.from("email_templates").select("key, subject, html_content, is_active, updated_at").order("key");
    setTemplates((data as EmailTemplate[]) ?? []);
    setLoading(false);
  };

  const loadLogs = async () => {
    setLogsLoading(true);
    const { data } = await supabase
      .from("email_send_log")
      .select("id, template_key, to_email, subject, status, error_message, created_at, workspace:workspaces(name)")
      .order("created_at", { ascending: false })
      .limit(50);
    setLogs((data as unknown as EmailLogRow[]) ?? []);
    setLogsLoading(false);
  };

  useEffect(() => {
    loadTemplates();
    loadLogs();
  }, []);

  const openEditor = (template: EmailTemplate) => {
    setEditing(template);
    setEditSubject(template.subject);
    setEditHtml(template.html_content);
    setSaveError(null);
  };

  const closeEditor = () => {
    setEditing(null);
    setSaveError(null);
  };

  const handleSave = async () => {
    if (!editing) return;
    if (!editSubject.trim() || !editHtml.trim()) {
      setSaveError("Assunto e conteúdo não podem ficar vazios.");
      return;
    }

    setSaving(true);
    setSaveError(null);

    const { error } = await supabase
      .from("email_templates")
      .update({ subject: editSubject.trim(), html_content: editHtml })
      .eq("key", editing.key);

    setSaving(false);

    if (error) {
      setSaveError(error.message);
      return;
    }

    closeEditor();
    await loadTemplates();
  };

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Carregando...</div>;
  }

  return (
    <div className="p-6">
      <h1 className="text-xl font-medium">E-mails</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Templates de e-mail transacional (via Brevo) e histórico de envios — vale pra todos os workspaces.
      </p>

      <Tabs defaultValue="templates" className="mt-6">
        <TabsList>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="historico">Histórico de envios</TabsTrigger>
        </TabsList>

        <TabsContent value="templates">
          <div className="flex flex-col gap-3">
            {templates.map((t) => (
              <div
                key={t.key}
                className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium">{TEMPLATE_LABEL[t.key] ?? t.key}</p>
                  <p className="text-xs text-muted-foreground">Assunto atual: {t.subject}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={t.is_active ? "default" : "secondary"}>{t.is_active ? "Ativo" : "Inativo"}</Badge>
                  <Button size="sm" variant="outline" onClick={() => openEditor(t)}>
                    Editar
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="historico">
          {logsLoading ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Quando</th>
                    <th className="px-4 py-2 font-medium">Template</th>
                    <th className="px-4 py-2 font-medium">Destino</th>
                    <th className="px-4 py-2 font-medium">Workspace</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                        Nenhum envio ainda.
                      </td>
                    </tr>
                  )}
                  {logs.map((l) => (
                    <tr key={l.id} className="border-t border-border" title={l.error_message ?? undefined}>
                      <td className="px-4 py-2 text-muted-foreground">{new Date(l.created_at).toLocaleString("pt-BR")}</td>
                      <td className="px-4 py-2">{TEMPLATE_LABEL[l.template_key ?? ""] ?? l.template_key ?? "—"}</td>
                      <td className="px-4 py-2 text-muted-foreground">{l.to_email}</td>
                      <td className="px-4 py-2 text-muted-foreground">{l.workspace?.name ?? "—"}</td>
                      <td className="px-4 py-2">
                        <Badge variant={STATUS_VARIANT[l.status]}>{STATUS_LABEL[l.status]}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={!!editing} onOpenChange={(o) => !o && closeEditor()}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? (TEMPLATE_LABEL[editing.key] ?? editing.key) : ""}</DialogTitle>
            <DialogDescription>
              Variáveis disponíveis: {editing ? TEMPLATE_VARIABLES[editing.key]?.map((v) => `{{${v}}}`).join(", ") : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="template-subject">Assunto</Label>
              <Input id="template-subject" value={editSubject} onChange={(e) => setEditSubject(e.target.value)} />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="template-html">Conteúdo (HTML)</Label>
              <textarea
                id="template-html"
                value={editHtml}
                onChange={(e) => setEditHtml(e.target.value)}
                className="min-h-40 rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Pré-visualização</Label>
              <div className="max-h-64 overflow-auto rounded-md border border-border bg-white p-3">
                <div dangerouslySetInnerHTML={{ __html: editHtml }} />
              </div>
            </div>

            {saveError && <p className="text-sm text-destructive">{saveError}</p>}

            <DialogFooter>
              <Button variant="outline" onClick={closeEditor} disabled={saving}>
                Cancelar
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Salvando..." : "Salvar"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
