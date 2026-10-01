import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useHubspotContactNames } from "@/lib/hubspotMeta";

interface MeetingRow {
  id: string;
  title: string | null;
  start_time: string | null;
  end_time: string | null;
  outcome: string | null;
  contact_ids: string[];
}

const PAGE_SIZE = 50;

const OUTCOME_LABEL: Record<string, string> = {
  SCHEDULED: "Agendada",
  COMPLETED: "Completada",
  RESCHEDULED: "Remarcada",
  NO_SHOW: "No-show",
  CANCELED: "Cancelada",
};

function formatDateTime(value: string | null) {
  if (!value) return { date: "—", time: "—" };
  const d = new Date(value);
  return { date: d.toLocaleDateString("pt-BR"), time: d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) };
}

export function HubspotMeetingsDialog({
  open,
  onOpenChange,
  workspaceId,
  ownerId,
  ownerName,
  startDate,
  endDate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string | undefined;
  ownerId: string;
  ownerName: string;
  startDate: string;
  endDate: string;
}) {
  const [rows, setRows] = useState<MeetingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    if (open) setPage(1);
  }, [open, ownerId, startDate, endDate]);

  useEffect(() => {
    if (!open || !workspaceId) return;
    setLoading(true);

    let query = supabase
      .from("hubspot_meetings")
      .select("id, title, start_time, end_time, outcome, contact_ids", { count: "exact" })
      .eq("workspace_id", workspaceId)
      .eq("owner_id", ownerId);

    if (startDate) query = query.gte("start_time", new Date(startDate).toISOString());
    if (endDate) query = query.lte("start_time", new Date(`${endDate}T23:59:59`).toISOString());

    query
      .order("start_time", { ascending: false, nullsFirst: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
      .then(({ data, count }) => {
        setRows((data as MeetingRow[]) ?? []);
        setTotalCount(count ?? 0);
        setLoading(false);
      });
  }, [open, workspaceId, ownerId, startDate, endDate, page]);

  const allContactIds = [...new Set(rows.flatMap((r) => r.contact_ids ?? []))];
  const contactNames = useHubspotContactNames(workspaceId, allContactIds);
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Reuniões — {ownerName}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">{totalCount.toLocaleString("pt-BR")} reunião(ões) no período selecionado.</p>

        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Data</th>
                <th className="px-3 py-2 font-medium">Horário</th>
                <th className="px-3 py-2 font-medium">Cliente</th>
                <th className="px-3 py-2 font-medium">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                    Carregando...
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                    Nenhuma reunião encontrada.
                  </td>
                </tr>
              )}
              {!loading &&
                rows.map((m) => {
                  const { date, time } = formatDateTime(m.start_time);
                  const clientNames = (m.contact_ids ?? []).map((id) => contactNames[id] ?? id).join(", ");
                  return (
                    <tr key={m.id} className="border-t border-border">
                      <td className="px-3 py-2">{date}</td>
                      <td className="px-3 py-2 text-muted-foreground">{time}</td>
                      <td className="px-3 py-2">{clientNames || "—"}</td>
                      <td className="px-3 py-2">
                        {m.outcome && <Badge variant="outline">{OUTCOME_LABEL[m.outcome] ?? m.outcome}</Badge>}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              Página {page} de {totalPages}
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
      </DialogContent>
    </Dialog>
  );
}
