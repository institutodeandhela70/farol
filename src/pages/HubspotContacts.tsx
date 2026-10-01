import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { HubspotDetailDialog } from "@/components/HubspotDetailDialog";
import { formatHubspotValue, useHubspotOwners, useHubspotPropertyDefs } from "@/lib/hubspotMeta";

interface ContactRow {
  id: string;
  email: string | null;
  firstname: string | null;
  lastname: string | null;
  phone: string | null;
  lifecyclestage: string | null;
  created_at_hubspot: string | null;
  raw_properties: Record<string, unknown>;
}

const PAGE_SIZE = 50;

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR");
}

export default function HubspotContacts() {
  const { workspace } = useWorkspace();
  const [rows, setRows] = useState<ContactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [stages, setStages] = useState<string[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [selectedContact, setSelectedContact] = useState<ContactRow | null>(null);
  const owners = useHubspotOwners(workspace?.id);
  const { defsByName } = useHubspotPropertyDefs(workspace?.id, "contacts");

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    if (!workspace) return;
    supabase.rpc("hubspot_contacts_filter_options", { p_workspace_id: workspace.id }).then(({ data }) => {
      setStages(data?.[0]?.lifecyclestages ?? []);
    });
  }, [workspace?.id]);

  useEffect(() => {
    setPage(1);
  }, [search, stageFilter]);

  useEffect(() => {
    if (!workspace) return;
    setLoading(true);

    const filters = {
      p_workspace_id: workspace.id,
      p_search: search || null,
      p_lifecyclestage: stageFilter === "all" ? null : stageFilter,
    };

    supabase.rpc("hubspot_contacts_summary", filters).then(({ data }) => {
      setTotalCount(data?.[0]?.total_count ?? 0);
    });

    let query = supabase
      .from("hubspot_contacts")
      .select("id, email, firstname, lastname, phone, lifecyclestage, created_at_hubspot, raw_properties")
      .eq("workspace_id", workspace.id);

    if (stageFilter !== "all") query = query.eq("lifecyclestage", stageFilter);
    if (search) query = query.or(`email.ilike.%${search}%,firstname.ilike.%${search}%,lastname.ilike.%${search}%`);

    query
      .order("created_at_hubspot", { ascending: false, nullsFirst: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
      .then(({ data }) => {
        setRows(data ?? []);
        setLoading(false);
      });
  }, [workspace?.id, search, stageFilter, page]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div className="p-6">
      <h1 className="text-xl font-medium">HubSpot — Contatos</h1>
      <p className="mt-1 text-sm text-muted-foreground">{totalCount.toLocaleString("pt-BR")} contato(s).</p>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Input
          placeholder="Buscar por nome ou e-mail..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="sm:max-w-xs"
        />
        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm sm:w-56"
        >
          <option value="all">Todas as etapas</option>
          {stages.map((s) => (
            <option key={s} value={s}>
              {formatHubspotValue(defsByName.lifecyclestage, s)}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4 overflow-x-auto overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Nome</th>
              <th className="px-4 py-2 font-medium">E-mail</th>
              <th className="px-4 py-2 font-medium">Telefone</th>
              <th className="px-4 py-2 font-medium">Etapa</th>
              <th className="px-4 py-2 font-medium">Proprietário</th>
              <th className="px-4 py-2 font-medium">Criado em</th>
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
                  Nenhum contato encontrado com esse filtro.
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((c) => {
                const ownerId = c.raw_properties?.hubspot_owner_id as string | undefined;
                const stageLabel = formatHubspotValue(defsByName.lifecyclestage, c.lifecyclestage);
                return (
                  <tr
                    key={c.id}
                    onClick={() => setSelectedContact(c)}
                    className="cursor-pointer border-t border-border hover:bg-muted/50"
                  >
                    <td className="px-4 py-2">{[c.firstname, c.lastname].filter(Boolean).join(" ") || "—"}</td>
                    <td className="px-4 py-2 text-muted-foreground">{c.email ?? "—"}</td>
                    <td className="px-4 py-2 text-muted-foreground">{c.phone ?? "—"}</td>
                    <td className="px-4 py-2">{c.lifecyclestage && <Badge variant="outline">{stageLabel}</Badge>}</td>
                    <td className="px-4 py-2 text-muted-foreground">{ownerId ? owners[ownerId] ?? "—" : "—"}</td>
                    <td className="px-4 py-2 text-muted-foreground">{formatDate(c.created_at_hubspot)}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Página {page} de {totalPages} ({totalCount.toLocaleString("pt-BR")} contatos)
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
        open={!!selectedContact}
        onOpenChange={(open) => !open && setSelectedContact(null)}
        title={[selectedContact?.firstname, selectedContact?.lastname].filter(Boolean).join(" ") || "Contato"}
        properties={selectedContact?.raw_properties ?? null}
        workspaceId={workspace?.id}
        objectType="contacts"
      />
    </div>
  );
}
