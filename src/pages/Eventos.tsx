import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type EventStatus = "planejamento" | "ativo" | "encerrado";
type ProductRole = "ingresso" | "venda_evento";
type TriggerType = "participante_aprovado" | "ficha_preenchida" | "venda_finalizada";

interface MessageTemplateState {
  enabled: boolean;
  message_template: string;
}

interface EventProductRow {
  id?: string;
  hubla_product_name: string;
  role: ProductRole;
}

interface EventRow {
  id: string;
  code: string;
  name: string;
  status: EventStatus;
  starts_at: string | null;
  ends_at: string | null;
  hubspot_pipeline_id: string | null;
  signup_form_slug: string | null;
  sales_form_slug: string | null;
}

interface HubspotPipelineOption {
  pipeline_id: string;
  label: string;
}

interface HublaProductOption {
  product_name: string;
  sales_count: number;
}

const STATUS_LABEL: Record<EventStatus, string> = {
  planejamento: "Planejamento",
  ativo: "Ativo",
  encerrado: "Encerrado",
};

const STATUS_VARIANT: Record<EventStatus, "secondary" | "default" | "outline"> = {
  planejamento: "secondary",
  ativo: "default",
  encerrado: "outline",
};

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function toDateInputValue(value: string | null) {
  if (!value) return "";
  return value.slice(0, 10);
}

const TRIGGER_LABEL: Record<TriggerType, string> = {
  participante_aprovado: "Participante aprovado (cadastro externo)",
  ficha_preenchida: "Ficha preenchida (aplicação recebida)",
  venda_finalizada: "Venda finalizada",
};

const TRIGGER_VARIABLES: Record<TriggerType, string[]> = {
  participante_aprovado: ["nome", "evento"],
  ficha_preenchida: ["nome", "evento", "produto"],
  venda_finalizada: ["nome", "evento", "produto", "valor"],
};

const ALL_TRIGGERS: TriggerType[] = ["participante_aprovado", "ficha_preenchida", "venda_finalizada"];

const EMPTY_MESSAGE_TEMPLATES: Record<TriggerType, MessageTemplateState> = {
  participante_aprovado: { enabled: false, message_template: "Olá {{nome}}! Sua inscrição no {{evento}} foi confirmada. 🎉" },
  ficha_preenchida: { enabled: false, message_template: "Olá {{nome}}! Recebemos seu interesse em {{produto}} no {{evento}}. Um closer vai falar com você em instantes." },
  venda_finalizada: { enabled: false, message_template: "Olá {{nome}}! Sua compra de {{produto}} ({{valor}}) no {{evento}} foi confirmada. Bem-vindo(a)!" },
};

interface EventFormState {
  id: string | null;
  code: string;
  name: string;
  status: EventStatus;
  starts_at: string;
  ends_at: string;
  hubspot_pipeline_id: string;
  signup_form_slug: string;
  sales_form_slug: string;
  products: EventProductRow[];
  messageTemplates: Record<TriggerType, MessageTemplateState>;
}

const EMPTY_FORM: EventFormState = {
  id: null,
  code: "",
  name: "",
  status: "planejamento",
  starts_at: "",
  ends_at: "",
  hubspot_pipeline_id: "",
  signup_form_slug: "",
  sales_form_slug: "",
  products: [],
  messageTemplates: EMPTY_MESSAGE_TEMPLATES,
};

export default function Eventos() {
  const { workspace } = useWorkspace();
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [productCounts, setProductCounts] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");

  const [pipelines, setPipelines] = useState<HubspotPipelineOption[]>([]);
  const [hublaProducts, setHublaProducts] = useState<HublaProductOption[]>([]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<EventFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [newProduct, setNewProduct] = useState<{ hubla_product_name: string; role: ProductRole }>({
    hubla_product_name: "",
    role: "ingresso",
  });

  const loadEvents = async () => {
    if (!workspace) return;
    setLoading(true);

    const { data } = await supabase
      .from("events")
      .select("id, code, name, status, starts_at, ends_at, hubspot_pipeline_id, signup_form_slug, sales_form_slug")
      .eq("workspace_id", workspace.id)
      .order("starts_at", { ascending: false, nullsFirst: false });

    const rows = (data ?? []) as EventRow[];
    setEvents(rows);

    if (rows.length > 0) {
      const { data: products } = await supabase
        .from("event_products")
        .select("event_id")
        .in(
          "event_id",
          rows.map((r) => r.id),
        );
      const counts: Record<string, number> = {};
      (products ?? []).forEach((p: { event_id: string }) => {
        counts[p.event_id] = (counts[p.event_id] ?? 0) + 1;
      });
      setProductCounts(counts);
    }

    setLoading(false);
  };

  useEffect(() => {
    loadEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace?.id]);

  useEffect(() => {
    if (!workspace) return;
    supabase
      .from("hubspot_pipelines")
      .select("pipeline_id, label")
      .eq("workspace_id", workspace.id)
      .order("label")
      .then(({ data }) => setPipelines((data ?? []) as HubspotPipelineOption[]));

    supabase
      .rpc("hubla_distinct_products", { p_workspace_id: workspace.id })
      .then(({ data }) => setHublaProducts((data ?? []) as HublaProductOption[]));
  }, [workspace?.id]);

  const openCreateDialog = () => {
    setForm(EMPTY_FORM);
    setFeedback(null);
    setDialogOpen(true);
  };

  const openEditDialog = async (event: EventRow) => {
    setFeedback(null);
    const { data: products } = await supabase
      .from("event_products")
      .select("id, hubla_product_name, role")
      .eq("event_id", event.id);

    const { data: templates } = await supabase
      .from("event_message_templates")
      .select("trigger_type, enabled, message_template")
      .eq("event_id", event.id);

    const messageTemplates = { ...EMPTY_MESSAGE_TEMPLATES };
    (templates ?? []).forEach((t: { trigger_type: TriggerType; enabled: boolean; message_template: string }) => {
      messageTemplates[t.trigger_type] = { enabled: t.enabled, message_template: t.message_template };
    });

    setForm({
      id: event.id,
      code: event.code,
      name: event.name,
      status: event.status,
      starts_at: toDateInputValue(event.starts_at),
      ends_at: toDateInputValue(event.ends_at),
      hubspot_pipeline_id: event.hubspot_pipeline_id ?? "",
      signup_form_slug: event.signup_form_slug ?? "",
      sales_form_slug: event.sales_form_slug ?? "",
      products: (products ?? []) as EventProductRow[],
      messageTemplates,
    });
    setDialogOpen(true);
  };

  const handleNameChange = (name: string) => {
    setForm((f) => {
      const shouldAutofill = !f.id; // só autopreenche em evento novo, não sobrescreve edição
      return {
        ...f,
        name,
        code: shouldAutofill ? slugify(name) : f.code,
        signup_form_slug: shouldAutofill ? slugify(name) : f.signup_form_slug,
        sales_form_slug: shouldAutofill ? `${slugify(name)}-ficha` : f.sales_form_slug,
      };
    });
  };

  const addProduct = () => {
    const product = hublaProducts.find((p) => p.product_name === newProduct.hubla_product_name);
    if (!product) return;
    if (form.products.some((p) => p.hubla_product_name === product.product_name && p.role === newProduct.role)) {
      setFeedback({ type: "error", text: "Esse produto já está vinculado com esse papel." });
      return;
    }
    setForm((f) => ({
      ...f,
      products: [...f.products, { hubla_product_name: product.product_name, role: newProduct.role }],
    }));
  };

  const removeProduct = (hublaProductName: string, role: ProductRole) => {
    setForm((f) => ({
      ...f,
      products: f.products.filter((p) => !(p.hubla_product_name === hublaProductName && p.role === role)),
    }));
  };

  const handleSave = async () => {
    if (!workspace) return;
    if (!form.name.trim() || !form.code.trim()) {
      setFeedback({ type: "error", text: "Preencha nome e código do evento." });
      return;
    }

    setSaving(true);
    setFeedback(null);

    const payload = {
      workspace_id: workspace.id,
      code: form.code.trim(),
      name: form.name.trim(),
      status: form.status,
      starts_at: form.starts_at ? new Date(form.starts_at).toISOString() : null,
      ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
      hubspot_pipeline_id: form.hubspot_pipeline_id || null,
      signup_form_slug: form.signup_form_slug.trim() || null,
      sales_form_slug: form.sales_form_slug.trim() || null,
    };

    let eventId = form.id;

    if (eventId) {
      const { error } = await supabase.from("events").update(payload).eq("id", eventId);
      if (error) {
        setSaving(false);
        setFeedback({ type: "error", text: error.message });
        return;
      }
    } else {
      eventId = crypto.randomUUID();
      const { error } = await supabase.from("events").insert({ id: eventId, ...payload });
      if (error) {
        setSaving(false);
        setFeedback({ type: "error", text: error.message });
        return;
      }
    }

    // Produtos: substitui o conjunto inteiro (delete + insert) — mais simples
    // que diffar, e o volume por evento é sempre pequeno (poucos produtos).
    await supabase.from("event_products").delete().eq("event_id", eventId);
    if (form.products.length > 0) {
      const { error: productsError } = await supabase.from("event_products").insert(
        form.products.map((p) => ({
          event_id: eventId,
          hubla_product_name: p.hubla_product_name,
          role: p.role,
        })),
      );
      if (productsError) {
        setSaving(false);
        setFeedback({ type: "error", text: productsError.message });
        return;
      }
    }

    const { error: templatesError } = await supabase.from("event_message_templates").upsert(
      ALL_TRIGGERS.map((trigger_type) => ({
        event_id: eventId,
        trigger_type,
        enabled: form.messageTemplates[trigger_type].enabled,
        message_template: form.messageTemplates[trigger_type].message_template,
      })),
      { onConflict: "event_id,trigger_type" },
    );
    if (templatesError) {
      setSaving(false);
      setFeedback({ type: "error", text: templatesError.message });
      return;
    }

    setSaving(false);
    setDialogOpen(false);
    await loadEvents();
  };

  const filteredEvents = events.filter((e) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return e.name.toLowerCase().includes(q) || e.code.toLowerCase().includes(q);
  });

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Carregando...</div>;
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-medium">Eventos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            MXP, IPL, IPM e outras edições — produtos da Hubla, pipeline da HubSpot e fichas de cada evento.
          </p>
        </div>
        <Button onClick={openCreateDialog}>Novo evento</Button>
      </div>

      <div className="mt-6">
        <Input
          placeholder="Buscar por nome ou código..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
      </div>

      <div className="mt-4 overflow-x-auto overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Evento</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Datas</th>
              <th className="px-4 py-2 font-medium">Pipeline HubSpot</th>
              <th className="px-4 py-2 font-medium">Produtos</th>
              <th className="px-4 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {filteredEvents.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                  Nenhum evento cadastrado ainda.
                </td>
              </tr>
            )}
            {filteredEvents.map((event) => (
              <tr key={event.id} className="border-t border-border">
                <td className="px-4 py-2">
                  <Link to={`/eventos/${event.id}`} className="font-medium text-primary hover:underline">
                    {event.name}
                  </Link>
                  <div className="text-xs text-muted-foreground">{event.code}</div>
                </td>
                <td className="px-4 py-2">
                  <Badge variant={STATUS_VARIANT[event.status]}>{STATUS_LABEL[event.status]}</Badge>
                </td>
                <td className="px-4 py-2 text-muted-foreground">
                  {event.starts_at ? new Date(event.starts_at).toLocaleDateString("pt-BR") : "—"}
                  {event.ends_at ? ` a ${new Date(event.ends_at).toLocaleDateString("pt-BR")}` : ""}
                </td>
                <td className="px-4 py-2 text-muted-foreground">
                  {pipelines.find((p) => p.pipeline_id === event.hubspot_pipeline_id)?.label ?? "—"}
                </td>
                <td className="px-4 py-2 text-muted-foreground">{productCounts[event.id] ?? 0}</td>
                <td className="px-4 py-2 text-right">
                  <Button size="sm" variant="outline" onClick={() => openEditDialog(event)}>
                    Editar
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar evento" : "Novo evento"}</DialogTitle>
            <DialogDescription>
              Define quais produtos da Hubla alimentam este evento e pra qual pipeline da HubSpot os participantes vão.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="event-name">Nome</Label>
              <Input
                id="event-name"
                placeholder="Ex: MXP 2026"
                value={form.name}
                onChange={(e) => handleNameChange(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="event-code">Código</Label>
              <Input
                id="event-code"
                placeholder="ex: mxp-2026"
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="event-starts">Início</Label>
                <Input
                  id="event-starts"
                  type="date"
                  value={form.starts_at}
                  onChange={(e) => setForm((f) => ({ ...f, starts_at: e.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="event-ends">Fim</Label>
                <Input
                  id="event-ends"
                  type="date"
                  value={form.ends_at}
                  onChange={(e) => setForm((f) => ({ ...f, ends_at: e.target.value }))}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="event-status">Status</Label>
              <select
                id="event-status"
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as EventStatus }))}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                {(Object.keys(STATUS_LABEL) as EventStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="event-pipeline">Pipeline HubSpot</Label>
              <select
                id="event-pipeline"
                value={form.hubspot_pipeline_id}
                onChange={(e) => setForm((f) => ({ ...f, hubspot_pipeline_id: e.target.value }))}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Selecione a pipeline</option>
                {pipelines.map((p) => (
                  <option key={p.pipeline_id} value={p.pipeline_id}>
                    {p.label}
                  </option>
                ))}
              </select>
              {pipelines.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Nenhuma pipeline sincronizada ainda — sincronize a HubSpot em Configurações → Integrações.
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Produtos da Hubla vinculados</Label>
              <div className="flex flex-col gap-2">
                {form.products.map((p) => (
                  <div
                    key={`${p.hubla_product_name}-${p.role}`}
                    className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
                  >
                    <div>
                      <div>{p.hubla_product_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {p.role === "ingresso" ? "Ingresso (gera participante)" : "Vendido no evento (entra na ficha)"}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeProduct(p.hubla_product_name, p.role)}
                      className="text-xs text-destructive hover:underline"
                    >
                      Remover
                    </button>
                  </div>
                ))}
                {form.products.length === 0 && (
                  <p className="text-xs text-muted-foreground">Nenhum produto vinculado ainda.</p>
                )}
              </div>

              <div className="mt-2 flex flex-col gap-2 rounded-md border border-dashed border-border p-3">
                <select
                  value={newProduct.hubla_product_name}
                  onChange={(e) => setNewProduct((n) => ({ ...n, hubla_product_name: e.target.value }))}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Selecione um produto da Hubla</option>
                  {hublaProducts.map((p) => (
                    <option key={p.product_name} value={p.product_name}>
                      {p.product_name} ({p.sales_count} vendas)
                    </option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <select
                    value={newProduct.role}
                    onChange={(e) => setNewProduct((n) => ({ ...n, role: e.target.value as ProductRole }))}
                    className="h-10 flex-1 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="ingresso">Ingresso (gera participante)</option>
                    <option value="venda_evento">Vendido no evento (entra na ficha)</option>
                  </select>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={addProduct}
                    disabled={!newProduct.hubla_product_name}
                  >
                    Adicionar
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="event-signup-slug">Link do cadastro de cortesia</Label>
              <Input
                id="event-signup-slug"
                placeholder="ex: mxp-2026"
                value={form.signup_form_slug}
                onChange={(e) => setForm((f) => ({ ...f, signup_form_slug: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">/inscricao/{form.signup_form_slug || "..."}</p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="event-sales-slug">Link da ficha de vendas</Label>
              <Input
                id="event-sales-slug"
                placeholder="ex: mxp-2026-ficha"
                value={form.sales_form_slug}
                onChange={(e) => setForm((f) => ({ ...f, sales_form_slug: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">/inscricao/{form.sales_form_slug || "..."}/ficha</p>
            </div>

            <div className="flex flex-col gap-3">
              <Label>Mensagens automáticas (WhatsApp via VSIX)</Label>
              {ALL_TRIGGERS.map((trigger) => (
                <div key={trigger} className="flex flex-col gap-2 rounded-md border border-border p-3">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={form.messageTemplates[trigger].enabled}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          messageTemplates: {
                            ...f.messageTemplates,
                            [trigger]: { ...f.messageTemplates[trigger], enabled: e.target.checked },
                          },
                        }))
                      }
                    />
                    {TRIGGER_LABEL[trigger]}
                  </label>
                  <textarea
                    value={form.messageTemplates[trigger].message_template}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        messageTemplates: {
                          ...f.messageTemplates,
                          [trigger]: { ...f.messageTemplates[trigger], message_template: e.target.value },
                        },
                      }))
                    }
                    disabled={!form.messageTemplates[trigger].enabled}
                    className="min-h-16 rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-50"
                  />
                  <p className="text-xs text-muted-foreground">
                    Variáveis disponíveis: {TRIGGER_VARIABLES[trigger].map((v) => `{{${v}}}`).join(", ")}
                  </p>
                </div>
              ))}
            </div>

            {feedback && (
              <p className={feedback.type === "error" ? "text-sm text-destructive" : "text-sm text-primary"}>
                {feedback.text}
              </p>
            )}

            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Salvando..." : form.id ? "Salvar alterações" : "Criar evento"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
