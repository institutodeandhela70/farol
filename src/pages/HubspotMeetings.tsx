import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { useHubspotOwners } from "@/lib/hubspotMeta";
import { HubspotMeetingsDialog } from "@/components/HubspotMeetingsDialog";

interface OwnerRow {
  owner_id: string;
  held_count: number;
  upcoming_count: number;
  completed_count: number;
  no_show_count: number;
  rescheduled_count: number;
  canceled_count: number;
}

export default function HubspotMeetings() {
  const { workspace } = useWorkspace();
  const owners = useHubspotOwners(workspace?.id);
  const [rows, setRows] = useState<OwnerRow[]>([]);
  const [summary, setSummary] = useState({ total_count: 0, held_count: 0, upcoming_count: 0 });
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedOwner, setSelectedOwner] = useState<string | null>(null);

  useEffect(() => {
    if (!workspace) return;
    setLoading(true);

    const filters = {
      p_workspace_id: workspace.id,
      p_start_date: startDate ? new Date(startDate).toISOString() : null,
      p_end_date: endDate ? new Date(`${endDate}T23:59:59`).toISOString() : null,
    };

    Promise.all([
      supabase.rpc("hubspot_meetings_summary", filters),
      supabase.rpc("hubspot_meetings_by_owner", filters),
    ]).then(([summaryRes, byOwnerRes]) => {
      const s = summaryRes.data?.[0];
      setSummary({ total_count: s?.total_count ?? 0, held_count: s?.held_count ?? 0, upcoming_count: s?.upcoming_count ?? 0 });
      setRows((byOwnerRes.data as OwnerRow[]) ?? []);
      setLoading(false);
    });
  }, [workspace?.id, startDate, endDate]);

  return (
    <div className="p-6">
      <h1 className="text-xl font-medium">HubSpot — Agendas</h1>
      <p className="mt-1 text-sm text-muted-foreground">Reuniões realizadas e agendadas, por vendedor.</p>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-muted p-4">
          <p className="text-sm text-muted-foreground">Total no período</p>
          <p className="mt-1 text-2xl font-medium">{summary.total_count.toLocaleString("pt-BR")}</p>
        </div>
        <div className="rounded-lg bg-muted p-4">
          <p className="text-sm text-muted-foreground">Realizadas (já aconteceram)</p>
          <p className="mt-1 text-2xl font-medium">{summary.held_count.toLocaleString("pt-BR")}</p>
        </div>
        <div className="rounded-lg bg-muted p-4">
          <p className="text-sm text-muted-foreground">Agendadas (futuras)</p>
          <p className="mt-1 text-2xl font-medium">{summary.upcoming_count.toLocaleString("pt-BR")}</p>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">De</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">Até</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>
      </div>

      <div className="mt-4 overflow-x-auto overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Vendedor</th>
              <th className="px-4 py-2 font-medium">Realizadas</th>
              <th className="px-4 py-2 font-medium">Agendadas</th>
              <th className="px-4 py-2 font-medium">Completadas</th>
              <th className="px-4 py-2 font-medium">No-show</th>
              <th className="px-4 py-2 font-medium">Remarcadas</th>
              <th className="px-4 py-2 font-medium">Canceladas</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">
                  Carregando...
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">
                  Nenhuma reunião encontrada com esse filtro.
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((r) => (
                <tr
                  key={r.owner_id}
                  onClick={() => setSelectedOwner(r.owner_id)}
                  className="cursor-pointer border-t border-border hover:bg-muted/50"
                >
                  <td className="px-4 py-2">{owners[r.owner_id] ?? r.owner_id}</td>
                  <td className="px-4 py-2">{r.held_count.toLocaleString("pt-BR")}</td>
                  <td className="px-4 py-2">{r.upcoming_count.toLocaleString("pt-BR")}</td>
                  <td className="px-4 py-2 text-muted-foreground">{r.completed_count.toLocaleString("pt-BR")}</td>
                  <td className="px-4 py-2 text-muted-foreground">{r.no_show_count.toLocaleString("pt-BR")}</td>
                  <td className="px-4 py-2 text-muted-foreground">{r.rescheduled_count.toLocaleString("pt-BR")}</td>
                  <td className="px-4 py-2 text-muted-foreground">{r.canceled_count.toLocaleString("pt-BR")}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {selectedOwner && (
        <HubspotMeetingsDialog
          open={!!selectedOwner}
          onOpenChange={(open) => !open && setSelectedOwner(null)}
          workspaceId={workspace?.id}
          ownerId={selectedOwner}
          ownerName={owners[selectedOwner] ?? selectedOwner}
          startDate={startDate}
          endDate={endDate}
        />
      )}
    </div>
  );
}
