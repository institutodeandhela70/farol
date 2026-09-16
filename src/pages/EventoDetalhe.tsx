import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { parseCsv, mapParticipantRows, type ParsedParticipantRow } from "@/lib/csv";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

type Origin = "hubla" | "excel" | "manual" | "signup_form" | "ficha";
type ApprovalStatus = "aprovado" | "pendente" | "rejeitado";
type HubspotSyncStatus = "nao_enviado" | "enviado" | "erro";
type ApplicationStatus = "preenchida" | "em_negociacao" | "finalizada";

interface ParticipantRow {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  cpf: string | null;
  origin: Origin;
  approval_status: ApprovalStatus;
  hubspot_sync_status: HubspotSyncStatus;
  hubspot_sync_error: string | null;
  created_at: string;
}

interface EventInfo {
  id: string;
  name: string;
  code: string;
  hubspot_pipeline_id: string | null;
}

interface ReconciliationRow {
  hubla_product_name: string;
  role: "ingresso" | "venda_evento";
  hubla_sales_count: number;
  hubla_sales_total: number;
  applications_finalized_count: number;
  applications_finalized_total: number;
}

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

interface ApplicationRow {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  cpf: string | null;
  rg: string | null;
  birth_date: string | null;
  address: string | null;
  hubla_product_name: string | null;
  second_full_name: string | null;
  second_cpf: string | null;
  second_rg: string | null;
  second_phone: string | null;
  second_birth_date: string | null;
  second_address: string | null;
  payment_method: string | null;
  decision: "sim" | "ainda_nao" | null;
  decision_pending_reason: string | null;
  negotiation_notes: string | null;
  authorized_by: string | null;
  signed: boolean;
  amount: number | null;
  status: ApplicationStatus;
  hubspot_sync_status: HubspotSyncStatus;
  hubspot_sync_error: string | null;
  whatsapp_status: HubspotSyncStatus;
  created_at: string;
}

const PAYMENT_METHOD_OPTIONS = ["Cartão de crédito (parcelado)", "Cartão de crédito (à vista)", "PIX / transferência"];

const ORIGIN_LABEL: Record<Origin, string> = {
  hubla: "Hubla",
  excel: "Planilha",
  manual: "Manual",
  signup_form: "Cadastro externo",
  ficha: "Ficha de vendas",
};

const APPLICATION_STATUS_LABEL: Record<ApplicationStatus, string> = {
  preenchida: "Preenchida",
  em_negociacao: "Em negociação",
  finalizada: "Finalizada",
};

const APPLICATION_STATUS_VARIANT: Record<ApplicationStatus, "secondary" | "default" | "outline"> = {
  preenchida: "secondary",
  em_negociacao: "default",
  finalizada: "outline",
};

const HUBSPOT_STATUS_LABEL: Record<HubspotSyncStatus, string> = {
  nao_enviado: "Não enviado",
  enviado: "Enviado",
  erro: "Erro",
};

const HUBSPOT_STATUS_VARIANT: Record<HubspotSyncStatus, "secondary" | "default" | "destructive"> = {
  nao_enviado: "secondary",
  enviado: "default",
  erro: "destructive",
};

const APPROVAL_LABEL: Record<ApprovalStatus, string> = {
  aprovado: "Aprovado",
  pendente: "Pendente",
  rejeitado: "Rejeitado",
};

const APPROVAL_VARIANT: Record<ApprovalStatus, "secondary" | "default" | "destructive"> = {
  aprovado: "default",
  pendente: "secondary",
  rejeitado: "destructive",
};

const PAGE_SIZE = 50;
const HUBSPOT_SEND_CHUNK_SIZE = 20;

export default function EventoDetalhe() {
  const { eventId } = useParams<{ eventId: string }>();
  const { workspace } = useWorkspace();

  const [event, setEvent] = useState<EventInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const [rows, setRows] = useState<ParticipantRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [originFilter, setOriginFilter] = useState<"all" | Origin>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | HubspotSyncStatus>("all");
  const [approvalFilter, setApprovalFilter] = useState<"all" | ApprovalStatus>("all");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState<{ type: "error" | "success"; text: string } | null>(null);

  const [syncingHubla, setSyncingHubla] = useState(false);
  const [sendingHubspot, setSendingHubspot] = useState(false);

  const [applications, setApplications] = useState<ApplicationRow[]>([]);
  const [applicationsTotalCount, setApplicationsTotalCount] = useState(0);
  const [applicationsPage, setApplicationsPage] = useState(1);
  const [applicationsLoading, setApplicationsLoading] = useState(true);
  const [applicationsSearchInput, setApplicationsSearchInput] = useState("");
  const [applicationsSearch, setApplicationsSearch] = useState("");
  const [applicationsStatusFilter, setApplicationsStatusFilter] = useState<"all" | ApplicationStatus>("all");
  const [viewApplication, setViewApplication] = useState<ApplicationRow | null>(null);
  const [negotiationForm, setNegotiationForm] = useState({
    payment_method: "",
    decision: "" as "" | "sim" | "ainda_nao",
    decision_pending_reason: "",
    negotiation_notes: "",
    authorized_by: "",
    signed: false,
    amount: "",
  });
  const [negotiationSaving, setNegotiationSaving] = useState(false);
  const [negotiationFeedback, setNegotiationFeedback] = useState<{ type: "error" | "success"; text: string } | null>(null);

  const [manualDialogOpen, setManualDialogOpen] = useState(false);
  const [manualForm, setManualForm] = useState({ full_name: "", email: "", phone: "", cpf: "" });
  const [manualSaving, setManualSaving] = useState(false);

  const [csvDialogOpen, setCsvDialogOpen] = useState(false);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [csvRows, setCsvRows] = useState<ParsedParticipantRow[]>([]);
  const [csvSelected, setCsvSelected] = useState<Record<number, boolean>>({});
  const [csvImporting, setCsvImporting] = useState(false);
  const csvInputRef = useRef<HTMLInputElement>(null);

  const [reconciliation, setReconciliation] = useState<ReconciliationRow[]>([]);

  const loadReconciliation = async () => {
    if (!eventId) return;
    const { data } = await supabase.rpc("event_sales_reconciliation", { p_event_id: eventId });
    setReconciliation((data ?? []) as ReconciliationRow[]);
  };

  const loadEvent = async () => {
    if (!eventId) return;
    const { data } = await supabase
      .from("events")
      .select("id, name, code, hubspot_pipeline_id")
      .eq("id", eventId)
      .maybeSingle();
    setEvent(data as EventInfo | null);
  };

  const loadParticipants = async () => {
    if (!eventId) return;
    setLoading(true);

    let query = supabase
      .from("event_participants")
      .select("id, full_name, email, phone, cpf, origin, approval_status, hubspot_sync_status, hubspot_sync_error, created_at", {
        count: "exact",
      })
      .eq("event_id", eventId);

    if (originFilter !== "all") query = query.eq("origin", originFilter);
    if (statusFilter !== "all") query = query.eq("hubspot_sync_status", statusFilter);
    if (approvalFilter !== "all") query = query.eq("approval_status", approvalFilter);
    if (search) query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%,cpf.ilike.%${search}%`);

    const { data, count } = await query
      .order("created_at", { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

    setRows((data ?? []) as ParticipantRow[]);
    setTotalCount(count ?? 0);
    setLoading(false);
  };

  useEffect(() => {
    loadEvent();
    loadReconciliation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [search, originFilter, statusFilter, approvalFilter]);

  useEffect(() => {
    loadParticipants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, search, originFilter, statusFilter, approvalFilter, page]);

  const loadApplications = async () => {
    if (!eventId) return;
    setApplicationsLoading(true);

    let query = supabase
      .from("event_applications")
      .select(
        "id, full_name, email, phone, cpf, rg, birth_date, address, hubla_product_name, second_full_name, second_cpf, second_rg, second_phone, second_birth_date, second_address, payment_method, decision, decision_pending_reason, negotiation_notes, authorized_by, signed, amount, status, hubspot_sync_status, hubspot_sync_error, whatsapp_status, created_at",
        { count: "exact" },
      )
      .eq("event_id", eventId);

    if (applicationsStatusFilter !== "all") query = query.eq("status", applicationsStatusFilter);
    if (applicationsSearch)
      query = query.or(`full_name.ilike.%${applicationsSearch}%,email.ilike.%${applicationsSearch}%,cpf.ilike.%${applicationsSearch}%`);

    const { data, count } = await query
      .order("created_at", { ascending: false })
      .range((applicationsPage - 1) * PAGE_SIZE, applicationsPage * PAGE_SIZE - 1);

    setApplications((data ?? []) as ApplicationRow[]);
    setApplicationsTotalCount(count ?? 0);
    setApplicationsLoading(false);
  };

  useEffect(() => {
    const t = setTimeout(() => setApplicationsSearch(applicationsSearchInput.trim()), 350);
    return () => clearTimeout(t);
  }, [applicationsSearchInput]);

  useEffect(() => {
    setApplicationsPage(1);
  }, [applicationsSearch, applicationsStatusFilter]);

  useEffect(() => {
    loadApplications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, applicationsSearch, applicationsStatusFilter, applicationsPage]);

  const applicationsTotalPages = Math.max(1, Math.ceil(applicationsTotalCount / PAGE_SIZE));

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Nunca seleciona quem já foi enviado (reenviar sem e-mail cria Contact
  // duplicado na HubSpot) nem quem ainda não foi aprovado — um cadastro
  // externo (Fase 3) só deve ir pra HubSpot depois que alguém do time confirma.
  const selectableRows = rows.filter((r) => r.hubspot_sync_status !== "enviado" && r.approval_status === "aprovado");

  const toggleAllOnPage = () => {
    setSelected((prev) => {
      const allSelected = selectableRows.every((r) => prev.has(r.id));
      const next = new Set(prev);
      selectableRows.forEach((r) => (allSelected ? next.delete(r.id) : next.add(r.id)));
      return next;
    });
  };

  const handleSyncHubla = async () => {
    if (!eventId) return;
    setSyncingHubla(true);
    setFeedback(null);

    const { data, error } = await supabase.rpc("sync_event_participants_from_hubla", { p_event_id: eventId });

    setSyncingHubla(false);

    if (error) {
      setFeedback({ type: "error", text: `Falha ao sincronizar da Hubla: ${error.message}` });
      return;
    }

    setFeedback({ type: "success", text: `Sincronizado: ${data ?? 0} participante(s) da Hubla.` });
    await loadParticipants();
  };

  const sendToHubspot = async (ids: string[]) => {
    if (!eventId || ids.length === 0) return;
    if (!event?.hubspot_pipeline_id) {
      setFeedback({ type: "error", text: "Este evento ainda não tem uma pipeline da HubSpot configurada — edite o evento primeiro." });
      return;
    }

    setSendingHubspot(true);
    setFeedback(null);

    let sent = 0;
    let skipped = 0;
    const errors: { id: string; error: string }[] = [];

    for (let i = 0; i < ids.length; i += HUBSPOT_SEND_CHUNK_SIZE) {
      const chunk = ids.slice(i, i + HUBSPOT_SEND_CHUNK_SIZE);
      const { data, error } = await supabase.functions.invoke("sync-event-to-hubspot", {
        body: { event_id: eventId, participant_ids: chunk },
      });

      if (error) {
        errors.push({ id: chunk.join(","), error: error.message });
        continue;
      }

      sent += data?.sent ?? 0;
      skipped += data?.skipped ?? 0;
      if (Array.isArray(data?.errors)) errors.push(...data.errors);
    }

    setSendingHubspot(false);
    setSelected(new Set());

    const skippedSuffix = skipped > 0 ? ` (${skipped} já estava(m) enviado(s), ignorado(s))` : "";
    setFeedback(
      errors.length === 0
        ? { type: "success", text: `Enviado(s) pro HubSpot: ${sent} participante(s).${skippedSuffix}` }
        : { type: "error", text: `Enviado(s): ${sent}${skippedSuffix}. Falhou em ${errors.length} — confira o status de cada linha.` },
    );

    await loadParticipants();
  };

  const handleAddManual = async () => {
    if (!workspace || !eventId) return;
    if (!manualForm.full_name.trim()) {
      setFeedback({ type: "error", text: "Preencha ao menos o nome." });
      return;
    }

    setManualSaving(true);
    const { error } = await supabase.from("event_participants").insert({
      workspace_id: workspace.id,
      event_id: eventId,
      full_name: manualForm.full_name.trim(),
      email: manualForm.email.trim() || null,
      phone: manualForm.phone.trim() || null,
      cpf: manualForm.cpf.trim() || null,
      origin: "manual",
    });
    setManualSaving(false);

    if (error) {
      setFeedback({ type: "error", text: error.message });
      return;
    }

    setManualForm({ full_name: "", email: "", phone: "", cpf: "" });
    setManualDialogOpen(false);
    await loadParticipants();
  };

  // Aprovar/rejeitar só muda o status — não dispara envio pro HubSpot
  // sozinho, isso continua sendo a mesma ação manual de qualquer participante.
  const handleApproval = async (id: string, approval_status: ApprovalStatus) => {
    await supabase.from("event_participants").update({ approval_status }).eq("id", id);

    if (approval_status === "aprovado" && eventId) {
      // Best-effort: a aprovação já aconteceu, o WhatsApp é um adicional —
      // se o gatilho não estiver ligado ou a mensagem falhar, não desfaz a
      // aprovação nem trava a tela.
      await supabase.functions.invoke("send-event-whatsapp", {
        body: { event_id: eventId, trigger_type: "participante_aprovado", participant_id: id },
      });
    }

    await loadParticipants();
  };

  const openApplication = (a: ApplicationRow) => {
    setViewApplication(a);
    setNegotiationFeedback(null);
    setNegotiationForm({
      payment_method: a.payment_method ?? "",
      decision: a.decision ?? "",
      decision_pending_reason: a.decision_pending_reason ?? "",
      negotiation_notes: a.negotiation_notes ?? "",
      authorized_by: a.authorized_by ?? "",
      signed: a.signed,
      amount: a.amount != null ? String(a.amount) : "",
    });
  };

  const buildNegotiationPayload = () => ({
    payment_method: negotiationForm.payment_method || null,
    decision: negotiationForm.decision || null,
    decision_pending_reason: negotiationForm.decision === "ainda_nao" ? negotiationForm.decision_pending_reason.trim() || null : null,
    negotiation_notes: negotiationForm.negotiation_notes.trim() || null,
    authorized_by: negotiationForm.authorized_by.trim() || null,
    signed: negotiationForm.signed,
    amount: negotiationForm.amount ? Number(negotiationForm.amount) : null,
  });

  const handleSaveNegotiation = async () => {
    if (!viewApplication) return;
    setNegotiationSaving(true);
    setNegotiationFeedback(null);

    const payload = {
      ...buildNegotiationPayload(),
      status: viewApplication.status === "preenchida" ? "em_negociacao" : viewApplication.status,
    };

    const { error } = await supabase.from("event_applications").update(payload).eq("id", viewApplication.id);
    setNegotiationSaving(false);

    if (error) {
      setNegotiationFeedback({ type: "error", text: error.message });
      return;
    }

    setNegotiationFeedback({ type: "success", text: "Negociação salva." });
    setViewApplication((v) => v && ({ ...v, ...payload }));
    await loadApplications();
  };

  const handleFinalizeApplication = async () => {
    if (!viewApplication) return;
    if (!negotiationForm.payment_method || !negotiationForm.decision) {
      setNegotiationFeedback({ type: "error", text: "Preencha forma de pagamento e decisão antes de finalizar." });
      return;
    }

    setNegotiationSaving(true);
    setNegotiationFeedback(null);

    const { error: updateError } = await supabase
      .from("event_applications")
      .update({ ...buildNegotiationPayload(), status: "finalizada" })
      .eq("id", viewApplication.id);

    if (updateError) {
      setNegotiationSaving(false);
      setNegotiationFeedback({ type: "error", text: updateError.message });
      return;
    }

    const { data, error: functionError } = await supabase.functions.invoke("finalize-event-application", {
      body: { application_id: viewApplication.id },
    });

    // A venda já foi finalizada acima independente da HubSpot — o WhatsApp
    // de confirmação dispara do mesmo jeito, com ou sem sucesso no CRM.
    if (eventId) {
      await supabase.functions.invoke("send-event-whatsapp", {
        body: { event_id: eventId, trigger_type: "venda_finalizada", application_id: viewApplication.id },
      });
    }

    setNegotiationSaving(false);
    setViewApplication((v) => v && ({ ...v, ...buildNegotiationPayload(), status: "finalizada" }));

    if (functionError || data?.error) {
      setNegotiationFeedback({
        type: "error",
        text: `Ficha finalizada, mas a HubSpot falhou: ${data?.error ?? functionError?.message}. Pode tentar de novo.`,
      });
    } else {
      setNegotiationFeedback({ type: "success", text: "Venda finalizada e Deal criado/atualizado na HubSpot." });
    }

    await loadApplications();
    await loadReconciliation();
  };

  const handleCsvFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setCsvFileName(file.name);
    const raw = await file.text();
    const parsed = parseCsv(raw);
    const mapped = mapParticipantRows(parsed);

    setCsvRows(mapped);
    const initialSelection: Record<number, boolean> = {};
    mapped.forEach((r, i) => {
      if (r.full_name || r.email) initialSelection[i] = true;
    });
    setCsvSelected(initialSelection);
  };

  const handleImportCsv = async () => {
    if (!workspace || !eventId) return;
    const batchId = crypto.randomUUID();
    const chosen = csvRows
      .map((r, i) => ({ r, i }))
      .filter(({ i }) => csvSelected[i]);

    if (chosen.length === 0) {
      setFeedback({ type: "error", text: "Selecione pelo menos uma linha pra importar." });
      return;
    }

    setCsvImporting(true);
    const { error } = await supabase.from("event_participants").insert(
      chosen.map(({ r, i }) => ({
        workspace_id: workspace.id,
        event_id: eventId,
        full_name: r.full_name,
        email: r.email,
        phone: r.phone,
        cpf: r.cpf,
        origin: "excel",
        origin_ref: `excel:${batchId}:${i}`,
      })),
    );
    setCsvImporting(false);

    if (error) {
      setFeedback({ type: "error", text: `Falha ao importar: ${error.message}` });
      return;
    }

    setFeedback({ type: "success", text: `Importado(s): ${chosen.length} participante(s) da planilha.` });
    setCsvDialogOpen(false);
    setCsvRows([]);
    setCsvSelected({});
    setCsvFileName(null);
    if (csvInputRef.current) csvInputRef.current.value = "";
    await loadParticipants();
  };

  if (loading && !event) {
    return <div className="p-6 text-sm text-muted-foreground">Carregando...</div>;
  }

  return (
    <div className="p-6">
      <Link to="/eventos" className="text-sm text-muted-foreground hover:underline">
        ← Eventos
      </Link>
      <h1 className="mt-1 text-xl font-medium">{event?.name ?? "Evento"}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{event?.code}</p>

      {reconciliation.length > 0 && (
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {reconciliation.map((r) => (
            <div key={`${r.role}-${r.hubla_product_name}`} className="rounded-lg border border-border p-4">
              <p className="text-xs text-muted-foreground">{r.role === "ingresso" ? "Ingresso" : "Vendido no evento"}</p>
              <p className="mt-0.5 text-sm font-medium">{r.hubla_product_name}</p>

              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Confirmado na Hubla</span>
                <span className="text-sm font-medium">
                  {formatCurrency(r.hubla_sales_total)} ({r.hubla_sales_count})
                </span>
              </div>

              {r.role === "venda_evento" && (
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Fechado no sistema</span>
                  <span className="text-sm font-medium">
                    {formatCurrency(r.applications_finalized_total)} ({r.applications_finalized_count})
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Tabs defaultValue="participantes" className="mt-6">
        <TabsList>
          <TabsTrigger value="participantes">Participantes</TabsTrigger>
          <TabsTrigger value="aplicacoes">Aplicações</TabsTrigger>
        </TabsList>

        <TabsContent value="participantes" className="mt-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={handleSyncHubla} disabled={syncingHubla}>
                {syncingHubla ? "Sincronizando..." : "Sincronizar da Hubla"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setCsvDialogOpen(true)}>
                Importar planilha
              </Button>
              <Button size="sm" variant="outline" onClick={() => setManualDialogOpen(true)}>
                Adicionar manualmente
              </Button>
            </div>
            <Button size="sm" onClick={() => sendToHubspot(Array.from(selected))} disabled={selected.size === 0 || sendingHubspot}>
              {sendingHubspot ? "Enviando..." : `Enviar pro HubSpot (${selected.size})`}
            </Button>
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Input
              placeholder="Buscar por nome, e-mail ou CPF..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="sm:max-w-xs"
            />
            <div className="flex gap-2">
              <select
                value={originFilter}
                onChange={(e) => setOriginFilter(e.target.value as "all" | Origin)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="all">Todas as origens</option>
                {(Object.keys(ORIGIN_LABEL) as Origin[]).map((o) => (
                  <option key={o} value={o}>
                    {ORIGIN_LABEL[o]}
                  </option>
                ))}
              </select>
              <select
                value={approvalFilter}
                onChange={(e) => setApprovalFilter(e.target.value as "all" | ApprovalStatus)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="all">Todos os status de aprovação</option>
                {(Object.keys(APPROVAL_LABEL) as ApprovalStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {APPROVAL_LABEL[s]}
                  </option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as "all" | HubspotSyncStatus)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="all">Todos os status HubSpot</option>
                {(Object.keys(HUBSPOT_STATUS_LABEL) as HubspotSyncStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {HUBSPOT_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {feedback && (
            <p className={`mt-3 text-sm ${feedback.type === "error" ? "text-destructive" : "text-primary"}`}>
              {feedback.text}
            </p>
          )}

          <div className="mt-4 overflow-x-auto overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="w-10 px-4 py-2">
                    <Checkbox
                      checked={selectableRows.length > 0 && selectableRows.every((r) => selected.has(r.id))}
                      onCheckedChange={toggleAllOnPage}
                      disabled={selectableRows.length === 0}
                    />
                  </th>
                  <th className="px-4 py-2 font-medium">Participante</th>
                  <th className="px-4 py-2 font-medium">Origem</th>
                  <th className="px-4 py-2 font-medium">Aprovação</th>
                  <th className="px-4 py-2 font-medium">HubSpot</th>
                  <th className="px-4 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                      Carregando...
                    </td>
                  </tr>
                )}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                      Nenhum participante encontrado com esse filtro.
                    </td>
                  </tr>
                )}
                {!loading &&
                  rows.map((r) => (
                    <tr key={r.id} className="border-t border-border">
                      <td className="px-4 py-2">
                        <Checkbox
                          checked={selected.has(r.id)}
                          onCheckedChange={() => toggleOne(r.id)}
                          disabled={r.hubspot_sync_status === "enviado"}
                        />
                      </td>
                      <td className="px-4 py-2">
                        <div>{r.full_name ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">{r.email ?? r.phone ?? "—"}</div>
                      </td>
                      <td className="px-4 py-2">
                        <Badge variant="secondary">{ORIGIN_LABEL[r.origin]}</Badge>
                      </td>
                      <td className="px-4 py-2">
                        <Badge variant={APPROVAL_VARIANT[r.approval_status]}>{APPROVAL_LABEL[r.approval_status]}</Badge>
                        {r.approval_status === "pendente" && (
                          <div className="mt-1 flex gap-1">
                            <button
                              type="button"
                              onClick={() => handleApproval(r.id, "aprovado")}
                              className="text-xs text-primary hover:underline"
                            >
                              Aprovar
                            </button>
                            <button
                              type="button"
                              onClick={() => handleApproval(r.id, "rejeitado")}
                              className="text-xs text-destructive hover:underline"
                            >
                              Rejeitar
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <Badge variant={HUBSPOT_STATUS_VARIANT[r.hubspot_sync_status]}>
                          {HUBSPOT_STATUS_LABEL[r.hubspot_sync_status]}
                        </Badge>
                        {r.hubspot_sync_status === "erro" && r.hubspot_sync_error && (
                          <p className="mt-1 max-w-[220px] truncate text-xs text-destructive" title={r.hubspot_sync_error}>
                            {r.hubspot_sync_error}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {r.hubspot_sync_status !== "enviado" && r.approval_status === "aprovado" && (
                          <Button size="sm" variant="outline" onClick={() => sendToHubspot([r.id])} disabled={sendingHubspot}>
                            Enviar
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
              <span>
                Página {page} de {totalPages} ({totalCount.toLocaleString("pt-BR")} participantes)
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="rounded-md border border-input px-3 py-1 disabled:opacity-50"
                >
                  Anterior
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="rounded-md border border-input px-3 py-1 disabled:opacity-50"
                >
                  Próxima
                </button>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="aplicacoes" className="mt-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Input
              placeholder="Buscar por nome, e-mail ou CPF..."
              value={applicationsSearchInput}
              onChange={(e) => setApplicationsSearchInput(e.target.value)}
              className="sm:max-w-xs"
            />
            <select
              value={applicationsStatusFilter}
              onChange={(e) => setApplicationsStatusFilter(e.target.value as "all" | ApplicationStatus)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="all">Todos os status</option>
              {(Object.keys(APPLICATION_STATUS_LABEL) as ApplicationStatus[]).map((s) => (
                <option key={s} value={s}>
                  {APPLICATION_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-4 overflow-x-auto overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Aplicante</th>
                  <th className="px-4 py-2 font-medium">Produto</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">HubSpot</th>
                  <th className="px-4 py-2 font-medium">WhatsApp</th>
                  <th className="px-4 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {applicationsLoading && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                      Carregando...
                    </td>
                  </tr>
                )}
                {!applicationsLoading && applications.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                      Nenhuma aplicação preenchida ainda.
                    </td>
                  </tr>
                )}
                {!applicationsLoading &&
                  applications.map((a) => (
                    <tr key={a.id} className="border-t border-border">
                      <td className="px-4 py-2">
                        <div>{a.full_name ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">{a.email ?? a.phone ?? "—"}</div>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{a.hubla_product_name ?? "—"}</td>
                      <td className="px-4 py-2">
                        <Badge variant={APPLICATION_STATUS_VARIANT[a.status]}>{APPLICATION_STATUS_LABEL[a.status]}</Badge>
                      </td>
                      <td className="px-4 py-2">
                        <Badge variant={HUBSPOT_STATUS_VARIANT[a.hubspot_sync_status]}>
                          {HUBSPOT_STATUS_LABEL[a.hubspot_sync_status]}
                        </Badge>
                      </td>
                      <td className="px-4 py-2">
                        <Badge variant={HUBSPOT_STATUS_VARIANT[a.whatsapp_status]}>{HUBSPOT_STATUS_LABEL[a.whatsapp_status]}</Badge>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Button size="sm" variant="outline" onClick={() => openApplication(a)}>
                          {a.status === "finalizada" ? "Ver" : "Atender"}
                        </Button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {applicationsTotalPages > 1 && (
            <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
              <span>
                Página {applicationsPage} de {applicationsTotalPages} ({applicationsTotalCount.toLocaleString("pt-BR")} aplicações)
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={applicationsPage <= 1}
                  onClick={() => setApplicationsPage((p) => Math.max(1, p - 1))}
                  className="rounded-md border border-input px-3 py-1 disabled:opacity-50"
                >
                  Anterior
                </button>
                <button
                  type="button"
                  disabled={applicationsPage >= applicationsTotalPages}
                  onClick={() => setApplicationsPage((p) => Math.min(applicationsTotalPages, p + 1))}
                  className="rounded-md border border-input px-3 py-1 disabled:opacity-50"
                >
                  Próxima
                </button>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Adicionar manualmente */}
      <Dialog open={manualDialogOpen} onOpenChange={setManualDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adicionar participante manualmente</DialogTitle>
            <DialogDescription>Pra cortesias ou casos que não vieram de nenhuma integração.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="manual-name">Nome</Label>
              <Input
                id="manual-name"
                value={manualForm.full_name}
                onChange={(e) => setManualForm((f) => ({ ...f, full_name: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="manual-email">E-mail</Label>
              <Input
                id="manual-email"
                value={manualForm.email}
                onChange={(e) => setManualForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="manual-phone">Telefone</Label>
              <Input
                id="manual-phone"
                value={manualForm.phone}
                onChange={(e) => setManualForm((f) => ({ ...f, phone: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="manual-cpf">CPF</Label>
              <Input id="manual-cpf" value={manualForm.cpf} onChange={(e) => setManualForm((f) => ({ ...f, cpf: e.target.value }))} />
            </div>
            <Button onClick={handleAddManual} disabled={manualSaving}>
              {manualSaving ? "Salvando..." : "Adicionar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Importar planilha */}
      <Dialog open={csvDialogOpen} onOpenChange={setCsvDialogOpen}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Importar planilha (CSV)</DialogTitle>
            <DialogDescription>
              A planilha precisa ter colunas reconhecíveis: Nome, E-mail, Telefone e/ou CPF. Se o arquivo for .xlsx, abra e salve
              como CSV antes de enviar.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <input
              ref={csvInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleCsvFile}
              className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-secondary-foreground hover:file:bg-secondary/80"
            />

            {csvRows.length > 0 && (
              <>
                <p className="text-sm text-muted-foreground">
                  {csvFileName} — {Object.values(csvSelected).filter(Boolean).length} de {csvRows.length} selecionado(s)
                </p>
                <div className="max-h-[300px] overflow-y-auto overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-muted/50 text-left text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2" />
                        <th className="px-3 py-2 font-medium">Nome</th>
                        <th className="px-3 py-2 font-medium">E-mail</th>
                        <th className="px-3 py-2 font-medium">Telefone</th>
                        <th className="px-3 py-2 font-medium">CPF</th>
                      </tr>
                    </thead>
                    <tbody>
                      {csvRows.map((r, i) => (
                        <tr key={i} className="border-t border-border">
                          <td className="px-3 py-2">
                            <Checkbox
                              checked={!!csvSelected[i]}
                              onCheckedChange={() => setCsvSelected((prev) => ({ ...prev, [i]: !prev[i] }))}
                            />
                          </td>
                          <td className="px-3 py-2">{r.full_name ?? "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground">{r.email ?? "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground">{r.phone ?? "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground">{r.cpf ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Button onClick={handleImportCsv} disabled={csvImporting}>
                  {csvImporting ? "Importando..." : "Importar selecionados"}
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Ver aplicação (somente leitura — negociação é a Fase 5) */}
      <Dialog open={!!viewApplication} onOpenChange={(o) => !o && setViewApplication(null)}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{viewApplication?.full_name ?? "Aplicação"}</DialogTitle>
            <DialogDescription>{viewApplication?.hubla_product_name ?? "Produto não informado"}</DialogDescription>
          </DialogHeader>

          {viewApplication && (
            <div className="flex flex-col gap-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">E-mail</p>
                  <p>{viewApplication.email ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Telefone</p>
                  <p>{viewApplication.phone ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">CPF</p>
                  <p>{viewApplication.cpf ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">RG</p>
                  <p>{viewApplication.rg ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Data de nasc.</p>
                  <p>{viewApplication.birth_date ? new Date(`${viewApplication.birth_date}T00:00:00`).toLocaleDateString("pt-BR") : "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Endereço</p>
                  <p>{viewApplication.address ?? "—"}</p>
                </div>
              </div>

              {viewApplication.second_full_name && (
                <div className="rounded-md border border-border p-3">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">2º participante</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Nome</p>
                      <p>{viewApplication.second_full_name}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Telefone</p>
                      <p>{viewApplication.second_phone ?? "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">CPF</p>
                      <p>{viewApplication.second_cpf ?? "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">RG</p>
                      <p>{viewApplication.second_rg ?? "—"}</p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-xs text-muted-foreground">Endereço</p>
                      <p>{viewApplication.second_address ?? "—"}</p>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2">
                <Badge variant={APPLICATION_STATUS_VARIANT[viewApplication.status]}>
                  {APPLICATION_STATUS_LABEL[viewApplication.status]}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  Recebida em {new Date(viewApplication.created_at).toLocaleString("pt-BR")}
                </span>
                {viewApplication.hubspot_deal_id && (
                  <Badge variant={HUBSPOT_STATUS_VARIANT[viewApplication.hubspot_sync_status]}>
                    Deal {HUBSPOT_STATUS_LABEL[viewApplication.hubspot_sync_status]}
                  </Badge>
                )}
              </div>

              <div className="rounded-md border border-border p-3">
                <p className="mb-2 text-xs font-medium text-muted-foreground">Negociação</p>

                {viewApplication.status === "finalizada" ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Forma de pagamento</p>
                      <p>{viewApplication.payment_method ?? "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Valor</p>
                      <p>{viewApplication.amount != null ? viewApplication.amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Decisão</p>
                      <p>{viewApplication.decision === "sim" ? "Sim, quero" : "Ainda não"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Autorizado por</p>
                      <p>{viewApplication.authorized_by ?? "—"}</p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-xs text-muted-foreground">Observações</p>
                      <p>{viewApplication.negotiation_notes ?? "—"}</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="neg-payment">Forma de pagamento</Label>
                      <select
                        id="neg-payment"
                        value={negotiationForm.payment_method}
                        onChange={(e) => setNegotiationForm((f) => ({ ...f, payment_method: e.target.value }))}
                        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                      >
                        <option value="">Selecione</option>
                        {PAYMENT_METHOD_OPTIONS.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="neg-amount">Valor fechado (R$)</Label>
                      <Input
                        id="neg-amount"
                        type="number"
                        step="0.01"
                        value={negotiationForm.amount}
                        onChange={(e) => setNegotiationForm((f) => ({ ...f, amount: e.target.value }))}
                      />
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <Label>Decisão</Label>
                      <div className="flex gap-4 text-sm">
                        <label className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="neg-decision"
                            checked={negotiationForm.decision === "sim"}
                            onChange={() => setNegotiationForm((f) => ({ ...f, decision: "sim" }))}
                          />
                          Sim, quero
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="neg-decision"
                            checked={negotiationForm.decision === "ainda_nao"}
                            onChange={() => setNegotiationForm((f) => ({ ...f, decision: "ainda_nao" }))}
                          />
                          Ainda não
                        </label>
                      </div>
                    </div>

                    {negotiationForm.decision === "ainda_nao" && (
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="neg-pending-reason">O que falta pra decidir?</Label>
                        <Input
                          id="neg-pending-reason"
                          value={negotiationForm.decision_pending_reason}
                          onChange={(e) => setNegotiationForm((f) => ({ ...f, decision_pending_reason: e.target.value }))}
                        />
                      </div>
                    )}

                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="neg-notes">Observações da negociação</Label>
                      <textarea
                        id="neg-notes"
                        value={negotiationForm.negotiation_notes}
                        onChange={(e) => setNegotiationForm((f) => ({ ...f, negotiation_notes: e.target.value }))}
                        className="min-h-20 rounded-md border border-input bg-background px-3 py-2 text-sm"
                      />
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="neg-authorized">Autorizado por (se teve exceção)</Label>
                      <Input
                        id="neg-authorized"
                        value={negotiationForm.authorized_by}
                        onChange={(e) => setNegotiationForm((f) => ({ ...f, authorized_by: e.target.value }))}
                      />
                    </div>

                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={negotiationForm.signed}
                        onChange={(e) => setNegotiationForm((f) => ({ ...f, signed: e.target.checked }))}
                      />
                      Aluno assinou a aplicação
                    </label>

                    {negotiationFeedback && (
                      <p className={negotiationFeedback.type === "error" ? "text-sm text-destructive" : "text-sm text-primary"}>
                        {negotiationFeedback.text}
                      </p>
                    )}

                    <div className="flex gap-2">
                      <Button variant="outline" onClick={handleSaveNegotiation} disabled={negotiationSaving}>
                        Salvar
                      </Button>
                      <Button onClick={handleFinalizeApplication} disabled={negotiationSaving}>
                        {negotiationSaving ? "Finalizando..." : "Finalizar venda"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
