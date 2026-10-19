import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface LogRow {
  id: string;
  integration_id: string | null;
  provider: string;
  direction: "inbound" | "outbound";
  event_type: string;
  status: "success" | "error";
  status_code: number | null;
  error_message: string | null;
  duration_ms: number | null;
  request_payload: unknown;
  response_payload: unknown;
  created_at: string;
}

const PROVIDER_LABEL: Record<string, string> = {
  asaas: "Asaas",
  hubla: "Hubla",
  hotmart: "Hotmart",
  tmb: "TMB",
  hubspot: "HubSpot",
  vsix: "VSIX",
  iuli: "IULI",
  brevo: "Brevo",
};

interface IntegrationOption {
  id: string;
  provider: string;
  label: string | null;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("pt-BR");
}

const PAGE_SIZE = 50;

export default function IntegrationLogs() {
  const { workspace } = useWorkspace();
  const [searchParams] = useSearchParams();
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [providerFilter, setProviderFilter] = useState(searchParams.get("provider") ?? "all");
  const [integrationFilter, setIntegrationFilter] = useState(searchParams.get("integration") ?? "all");
  const [integrations, setIntegrations] = useState<IntegrationOption[]>([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<LogRow | null>(null);

  const [filterOptions, setFilterOptions] = useState<{ providers: string[]; event_types: string[] }>({
    providers: [],
    event_types: [],
  });
  const [summary, setSummary] = useState({ total_count: 0, error_count: 0 });

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    if (!workspace) return;
    supabase.rpc("integration_logs_filter_options", { p_workspace_id: workspace.id }).then(({ data }) => {
      const row = data?.[0];
      setFilterOptions({ providers: row?.providers ?? [], event_types: row?.event_types ?? [] });
    });
  }, [workspace?.id]);

  useEffect(() => {
    if (!workspace) return;
    supabase
      .from("integrations")
      .select("id, provider, label")
      .eq("workspace_id", workspace.id)
      .then(({ data }) => setIntegrations((data as IntegrationOption[]) ?? []));
  }, [workspace?.id]);

  const integrationById = useMemo(() => new Map(integrations.map((i) => [i.id, i])), [integrations]);
  const integrationName = (provider: string, integrationId: string | null) => {
    const base = PROVIDER_LABEL[provider] ?? provider;
    const label = integrationId ? integrationById.get(integrationId)?.label : null;
    return label ? `${base} · ${label}` : base;
  };

  useEffect(() => {
    setPage(1);
  }, [search, providerFilter, integrationFilter, statusFilter]);

  useEffect(() => {
    if (!workspace) return;
    setLoading(true);

    const filters = {
      p_workspace_id: workspace.id,
      p_provider: providerFilter === "all" ? null : providerFilter,
      p_status: statusFilter === "all" ? null : statusFilter,
      p_search: search || null,
      p_integration_id: integrationFilter === "all" ? null : integrationFilter,
    };

    supabase.rpc("integration_logs_summary", filters).then(({ data }) => {
      const row = data?.[0];
      setSummary({ total_count: row?.total_count ?? 0, error_count: row?.error_count ?? 0 });
    });

    let query = supabase
      .from("integration_logs")
      .select(
        "id, integration_id, provider, direction, event_type, status, status_code, error_message, duration_ms, request_payload, response_payload, created_at",
      )
      .eq("workspace_id", workspace.id);

    if (providerFilter !== "all") query = query.eq("provider", providerFilter);
    if (statusFilter !== "all") query = query.eq("status", statusFilter);
    if (integrationFilter !== "all") query = query.eq("integration_id", integrationFilter);
    if (search) query = query.ilike("event_type", `%${search}%`);

    query
      .order("created_at", { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
      .then(({ data }) => {
        setRows((data as LogRow[]) ?? []);
        setLoading(false);
      });
  }, [workspace?.id, search, providerFilter, integrationFilter, statusFilter, page]);

  const totalPages = Math.max(1, Math.ceil(summary.total_count / PAGE_SIZE));

  return (
    <div className="p-6">
      <h1 className="text-xl font-medium">Logs de Integrações</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Toda chamada recebida (webhooks) ou disparada (syncs/diagnósticos) pelas integrações deste workspace.
      </p>

      {integrationFilter !== "all" && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-4 py-2 text-sm">
          <span>
            Mostrando só os logs de{" "}
            <strong>
              {integrationById.get(integrationFilter)
                ? integrationName(integrationById.get(integrationFilter)!.provider, integrationFilter)
                : "esta integração"}
            </strong>
            .
          </span>
          <button type="button" className="text-primary hover:underline" onClick={() => setIntegrationFilter("all")}>
            Ver todas
          </button>
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg bg-muted p-4">
          <p className="text-sm text-muted-foreground">Chamadas (filtro atual)</p>
          <p className="mt-1 text-2xl font-medium">{summary.total_count.toLocaleString("pt-BR")}</p>
        </div>
        <div className="rounded-lg bg-muted p-4">
          <p className="text-sm text-muted-foreground">Com erro (filtro atual)</p>
          <p className="mt-1 text-2xl font-medium text-destructive">{summary.error_count.toLocaleString("pt-BR")}</p>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Input
          placeholder="Buscar por tipo de evento (ex: invoice.created, sync)..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="sm:max-w-xs"
        />
        <div className="flex gap-2">
          <select
            value={providerFilter}
            onChange={(e) => {
              setProviderFilter(e.target.value);
              setIntegrationFilter("all");
            }}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="all">Todas as integrações</option>
            {filterOptions.providers.map((p) => (
              <option key={p} value={p}>
                {PROVIDER_LABEL[p] ?? p}
              </option>
            ))}
          </select>
          <select
            value={integrationFilter}
            onChange={(e) => setIntegrationFilter(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="all">Todas as contas</option>
            {integrations
              .filter((i) => providerFilter === "all" || i.provider === providerFilter)
              .map((i) => (
                <option key={i.id} value={i.id}>
                  {integrationName(i.provider, i.id)}
                </option>
              ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="all">Todos os status</option>
            <option value="success">Sucesso</option>
            <option value="error">Erro</option>
          </select>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Quando</th>
              <th className="px-4 py-2 font-medium">Integração</th>
              <th className="px-4 py-2 font-medium">Direção</th>
              <th className="px-4 py-2 font-medium">Evento</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Duração</th>
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
                  Nenhuma chamada encontrada com esse filtro.
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((r) => (
                <tr
                  key={r.id}
                  className="cursor-pointer border-t border-border hover:bg-muted/30"
                  onClick={() => setSelected(r)}
                >
                  <td className="px-4 py-2 text-muted-foreground">{formatDateTime(r.created_at)}</td>
                  <td className="px-4 py-2">{integrationName(r.provider, r.integration_id)}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {r.direction === "inbound" ? "Recebida (webhook)" : "Disparada por nós"}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{r.event_type}</td>
                  <td className="px-4 py-2">
                    <Badge variant={r.status === "success" ? "default" : "destructive"}>
                      {r.status === "success" ? "Sucesso" : "Erro"}
                      {r.status_code ? ` (${r.status_code})` : ""}
                    </Badge>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{r.duration_ms != null ? `${r.duration_ms}ms` : "—"}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Página {page} de {totalPages} ({summary.total_count.toLocaleString("pt-BR")} chamadas)
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

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {integrationName(selected.provider, selected.integration_id)} — {selected.event_type}
                </DialogTitle>
                <DialogDescription>
                  {formatDateTime(selected.created_at)} · {selected.direction === "inbound" ? "Webhook recebido" : "Chamada disparada por nós"}
                  {selected.duration_ms != null ? ` · ${selected.duration_ms}ms` : ""}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 text-sm">
                <div>
                  <Badge variant={selected.status === "success" ? "default" : "destructive"}>
                    {selected.status === "success" ? "Sucesso" : "Erro"}
                    {selected.status_code ? ` — HTTP ${selected.status_code}` : ""}
                  </Badge>
                </div>

                {selected.error_message && (
                  <div>
                    <p className="font-medium text-destructive">Erro</p>
                    <p className="mt-1 text-muted-foreground">{selected.error_message}</p>
                  </div>
                )}

                <div>
                  <p className="font-medium">Enviado (request)</p>
                  <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">
                    {selected.request_payload ? JSON.stringify(selected.request_payload, null, 2) : "—"}
                  </pre>
                </div>

                <div>
                  <p className="font-medium">Recebido (response)</p>
                  <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">
                    {selected.response_payload ? JSON.stringify(selected.response_payload, null, 2) : "—"}
                  </pre>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
