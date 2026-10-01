import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { HubspotDetailDialog } from "@/components/HubspotDetailDialog";
import { useHubspotOwners, useHubspotPipelines } from "@/lib/hubspotMeta";

interface DealRow {
  id: string;
  dealname: string | null;
  amount: number | null;
  dealstage: string | null;
  pipeline: string | null;
  closedate: string | null;
  raw_properties: Record<string, unknown>;
}

const PAGE_SIZE = 50;

function formatCurrency(value: number | null) {
  return (value ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR");
}

export default function HubspotDeals() {
  const { workspace } = useWorkspace();
  const [rows, setRows] = useState<DealRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [pipelineFilter, setPipelineFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [filterOptions, setFilterOptions] = useState<{ dealstages: string[]; pipelines: string[] }>({
    dealstages: [],
    pipelines: [],
  });
  const [summary, setSummary] = useState({ total_count: 0, total_amount: 0 });
  const [selectedDeal, setSelectedDeal] = useState<DealRow | null>(null);
  const { pipelines, stageLabel } = useHubspotPipelines(workspace?.id);
  const owners = useHubspotOwners(workspace?.id);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    if (!workspace) return;
    supabase.rpc("hubspot_deals_filter_options", { p_workspace_id: workspace.id }).then(({ data }) => {
      const row = data?.[0];
      setFilterOptions({ dealstages: row?.dealstages ?? [], pipelines: row?.pipelines ?? [] });
    });
  }, [workspace?.id]);

  useEffect(() => {
    setPage(1);
  }, [search, stageFilter, pipelineFilter]);

  useEffect(() => {
    if (!workspace) return;
    setLoading(true);

    const filters = {
      p_workspace_id: workspace.id,
      p_search: search || null,
      p_dealstage: stageFilter === "all" ? null : stageFilter,
      p_pipeline: pipelineFilter === "all" ? null : pipelineFilter,
    };

    supabase.rpc("hubspot_deals_summary", filters).then(({ data }) => {
      const row = data?.[0];
      setSummary({ total_count: row?.total_count ?? 0, total_amount: row?.total_amount ?? 0 });
    });

    let query = supabase
      .from("hubspot_deals")
      .select("id, dealname, amount, dealstage, pipeline, closedate, raw_properties")
      .eq("workspace_id", workspace.id);

    if (stageFilter !== "all") query = query.eq("dealstage", stageFilter);
    if (pipelineFilter !== "all") query = query.eq("pipeline", pipelineFilter);
    if (search) query = query.ilike("dealname", `%${search}%`);

    query
      .order("closedate", { ascending: false, nullsFirst: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
      .then(({ data }) => {
        setRows(data ?? []);
        setLoading(false);
      });
  }, [workspace?.id, search, stageFilter, pipelineFilter, page]);

  const totalPages = Math.max(1, Math.ceil(summary.total_count / PAGE_SIZE));

  return (
    <div className="p-6">
      <h1 className="text-xl font-medium">HubSpot — Negócios</h1>
      <p className="mt-1 text-sm text-muted-foreground">Pipeline de vendas do workspace.</p>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg bg-muted p-4">
          <p className="text-sm text-muted-foreground">Valor total (filtro atual)</p>
          <p className="mt-1 text-2xl font-medium">{formatCurrency(summary.total_amount)}</p>
        </div>
        <div className="rounded-lg bg-muted p-4">
          <p className="text-sm text-muted-foreground">Negócios (filtro atual)</p>
          <p className="mt-1 text-2xl font-medium">{summary.total_count.toLocaleString("pt-BR")}</p>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Pipeline</label>
        <select
          value={pipelineFilter}
          onChange={(e) => setPipelineFilter(e.target.value)}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-72"
        >
          <option value="all">Todos os pipelines</option>
          {pipelines.length > 0
            ? pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))
            : filterOptions.pipelines.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
        </select>
      </div>

      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Input
          placeholder="Buscar por nome do negócio..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="sm:max-w-xs"
        />
        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="all">Todas as etapas</option>
          {filterOptions.dealstages.map((s) => (
            <option key={s} value={s}>
              {stageLabel(s) ?? s}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4 overflow-x-auto overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Negócio</th>
              <th className="px-4 py-2 font-medium">Valor</th>
              <th className="px-4 py-2 font-medium">Etapa</th>
              <th className="px-4 py-2 font-medium">Proprietário</th>
              <th className="px-4 py-2 font-medium">Fechamento</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                  Carregando...
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                  Nenhum negócio encontrado com esse filtro.
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((d) => {
                const ownerId = d.raw_properties?.hubspot_owner_id as string | undefined;
                return (
                  <tr
                    key={d.id}
                    onClick={() => setSelectedDeal(d)}
                    className="cursor-pointer border-t border-border hover:bg-muted/50"
                  >
                    <td className="px-4 py-2">{d.dealname ?? "—"}</td>
                    <td className="px-4 py-2">{formatCurrency(d.amount)}</td>
                    <td className="px-4 py-2">
                      {d.dealstage && <Badge variant="outline">{stageLabel(d.dealstage) ?? d.dealstage}</Badge>}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{ownerId ? owners[ownerId] ?? "—" : "—"}</td>
                    <td className="px-4 py-2 text-muted-foreground">{formatDate(d.closedate)}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Página {page} de {totalPages} ({summary.total_count.toLocaleString("pt-BR")} negócios)
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

      <HubspotDetailDialog
        open={!!selectedDeal}
        onOpenChange={(open) => !open && setSelectedDeal(null)}
        title={selectedDeal?.dealname || "Negócio"}
        properties={selectedDeal?.raw_properties ?? null}
        workspaceId={workspace?.id}
        objectType="deals"
      />
    </div>
  );
}
