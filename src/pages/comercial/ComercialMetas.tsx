import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Copy, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { SOURCES } from "@/lib/commercialSources";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { useHubspotOwners } from "@/lib/hubspotMeta";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  addMonths,
  currentYM,
  monthLabel,
  useCommercialFilters,
  useGoals,
  useSalesPipelines,
  type GoalRow,
  ownerDisplay,
  ownerOptions,
} from "@/lib/commercial";
import {
  CommercialShell,
  EmptyState,
  LoadingBlock,
  Panel,
  WarnNote,
} from "@/components/commercial/CommercialUI";

interface Draft {
  id: string | null;
  owner_id: string;
  revenue: string;
  deals: string;
  held: string;
  scheduled: string;
  dirty: boolean;
}

const FIELDS: { key: keyof Pick<Draft, "revenue" | "deals" | "held" | "scheduled">; label: string; hint: string }[] = [
  { key: "revenue", label: "Receita (R$)", hint: "valor ganho" },
  { key: "deals", label: "Ganhos", hint: "nº de negócios" },
  { key: "held", label: "Reuniões conduzidas", hint: "closer" },
  { key: "scheduled", label: "Agendamentos", hint: "SDR" },
];

function toDraft(g: GoalRow): Draft {
  const s = (v: number | null) => (v === null || v === undefined ? "" : String(v));
  return { id: g.id, owner_id: g.owner_id, revenue: s(g.revenue_target), deals: s(g.deals_target), held: s(g.meetings_held_target), scheduled: s(g.meetings_scheduled_target), dirty: false };
}

function parse(v: string): number | null {
  const n = Number(v.replace(/\./g, "").replace(",", "."));
  return v.trim() === "" || !Number.isFinite(n) ? null : n;
}

export default function ComercialMetas() {
  const { workspace, role } = useWorkspace();
  const canEdit = role === "owner" || role === "admin";
  const owners = useHubspotOwners(workspace?.id);
  const queryClient = useQueryClient();
  const { filters } = useCommercialFilters();
  const [month, setMonth] = useState(filters.to);
  const goals = useGoals(workspace?.id, month, month);
  const pipelines = useSalesPipelines(workspace?.id);

  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [newOwner, setNewOwner] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  // Recarrega o rascunho quando chegam metas novas do banco (troca de mês ou após salvar).
  const [loadedFrom, setLoadedFrom] = useState<GoalRow[] | undefined>(undefined);
  if (goals.data !== loadedFrom) {
    setLoadedFrom(goals.data);
    setDrafts((goals.data ?? []).map(toDraft).sort((a, b) => ownerDisplay(owners, a.owner_id).localeCompare(ownerDisplay(owners, b.owner_id), "pt-BR")));
    setRemoved([]);
  }

  const available = useMemo(() => {
    const used = new Set(drafts.map((d) => d.owner_id));
    return ownerOptions(owners).filter((o) => !used.has(o.id));
  }, [owners, drafts]);

  const dirty = drafts.some((d) => d.dirty) || removed.length > 0;
  const monthOptions = Array.from({ length: 15 }, (_, i) => addMonths(currentYM(), 3 - i));

  const update = (ownerId: string, key: (typeof FIELDS)[number]["key"], value: string) =>
    setDrafts((ds) => ds.map((d) => (d.owner_id === ownerId ? { ...d, [key]: value, dirty: true } : d)));

  const addOwner = () => {
    if (!newOwner) return;
    setDrafts((ds) => [...ds, { id: null, owner_id: newOwner, revenue: "", deals: "", held: "", scheduled: "", dirty: true }]);
    setNewOwner("");
  };

  const removeRow = (d: Draft) => {
    setDrafts((ds) => ds.filter((x) => x.owner_id !== d.owner_id));
    if (d.id) setRemoved((r) => [...r, d.id!]);
  };

  const copyPrevious = async () => {
    if (!workspace) return;
    const prev = addMonths(month, -1);
    const { data } = await supabase
      .from("commercial_goals")
      .select("owner_id, revenue_target, deals_target, meetings_held_target, meetings_scheduled_target")
      .eq("workspace_id", workspace.id)
      .eq("month", `${prev}-01`);
    const used = new Set(drafts.map((d) => d.owner_id));
    const added = (data ?? [])
      .filter((g) => !used.has(g.owner_id))
      .map((g) => ({ ...toDraft({ ...g, id: "", month: prev } as GoalRow), id: null, dirty: true }));
    setDrafts((ds) => [...ds, ...added]);
    setMessage(added.length ? { kind: "ok", text: `${added.length} meta(s) copiada(s) de ${monthLabel(prev, true)} — revise e salve.` } : { kind: "error", text: `Nada novo para copiar de ${monthLabel(prev, true)}.` });
  };

  const save = async () => {
    if (!workspace) return;
    setSaving(true);
    setMessage(null);
    try {
      for (const id of removed) {
        const { error } = await supabase.from("commercial_goals").delete().eq("id", id);
        if (error) throw error;
      }
      for (const d of drafts.filter((x) => x.dirty)) {
        const values = {
          revenue_target: parse(d.revenue),
          deals_target: parse(d.deals),
          meetings_held_target: parse(d.held),
          meetings_scheduled_target: parse(d.scheduled),
          updated_at: new Date().toISOString(),
        };
        // Sem upsert: update por id quando já existe, insert simples quando é novo.
        const { error } = d.id
          ? await supabase.from("commercial_goals").update(values).eq("id", d.id)
          : await supabase.from("commercial_goals").insert({ id: crypto.randomUUID(), workspace_id: workspace.id, owner_id: d.owner_id, month: `${month}-01`, ...values });
        if (error) throw error;
      }
      await queryClient.invalidateQueries({ queryKey: ["commercial", "goals"] });
      setMessage({ kind: "ok", text: "Metas salvas." });
    } catch (err) {
      setMessage({ kind: "error", text: `Não foi possível salvar: ${(err as Error).message}` });
    } finally {
      setSaving(false);
    }
  };

  const togglePipeline = async (pipelineId: string, counts: boolean) => {
    if (!workspace) return;
    const { data, error } = await supabase
      .from("commercial_pipeline_settings")
      .update({ counts_as_sales: counts, updated_at: new Date().toISOString() })
      .eq("workspace_id", workspace.id)
      .eq("pipeline_id", pipelineId)
      .select("id");
    if (!error && (data ?? []).length === 0) {
      await supabase.from("commercial_pipeline_settings").insert({ workspace_id: workspace.id, pipeline_id: pipelineId, counts_as_sales: counts });
    }
    await queryClient.invalidateQueries({ queryKey: ["commercial"] });
  };

  return (
    <CommercialShell title="Metas" description="Metas mensais por vendedor e quais pipelines contam como venda">
      {!canEdit && <WarnNote>Só donos e administradores do workspace podem editar metas. Você está vendo em modo leitura.</WarnNote>}

      <Panel
        title={`Metas de ${monthLabel(month, true)}`}
        info={SOURCES.goalsTable()}
        action={
          <select aria-label="Mês das metas" value={month} onChange={(e) => setMonth(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm font-medium">
            {monthOptions.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m, true)}
              </option>
            ))}
          </select>
        }
      >
        {goals.isLoading ? (
          <LoadingBlock />
        ) : (
          <>
            {drafts.length === 0 ? (
              <EmptyState>Nenhuma meta cadastrada para {monthLabel(month, true)}.</EmptyState>
            ) : (
              <div className="-mx-4 overflow-x-auto md:mx-0">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="px-4 py-2 font-medium md:pl-0">Vendedor</th>
                      {FIELDS.map((f) => (
                        <th key={f.key} className="px-2 py-2 font-medium">
                          {f.label}
                          <span className="block normal-case tracking-normal text-muted-foreground/80">{f.hint}</span>
                        </th>
                      ))}
                      <th className="w-12 px-2 py-2" aria-label="Ações" />
                    </tr>
                  </thead>
                  <tbody>
                    {drafts.map((d) => (
                      <tr key={d.owner_id} className="border-b border-border/60 last:border-0">
                        <td className="px-4 py-2 font-medium md:pl-0">
                          {ownerDisplay(owners, d.owner_id)}
                          {d.dirty && <span className="ml-2 text-xs font-normal text-amber-700 dark:text-amber-400">não salvo</span>}
                        </td>
                        {FIELDS.map((f) => (
                          <td key={f.key} className="px-2 py-2">
                            <input
                              aria-label={`${f.label} de ${ownerDisplay(owners, d.owner_id)}`}
                              inputMode="decimal"
                              disabled={!canEdit}
                              value={d[f.key]}
                              onChange={(e) => update(d.owner_id, f.key, e.target.value)}
                              placeholder="—"
                              className="h-10 w-full min-w-[7rem] rounded-md border border-input bg-background px-3 text-right tabular-nums disabled:opacity-70"
                            />
                          </td>
                        ))}
                        <td className="px-2 py-2">
                          {canEdit && (
                            <button type="button" aria-label={`Remover meta de ${ownerDisplay(owners, d.owner_id)}`} onClick={() => removeRow(d)} className="flex size-10 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-destructive">
                              <Trash2 className="size-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {canEdit && (
              <div className="flex flex-col gap-3 border-t border-border pt-4 md:flex-row md:items-center md:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <select aria-label="Adicionar vendedor" value={newOwner} onChange={(e) => setNewOwner(e.target.value)} className="h-10 max-w-[16rem] rounded-md border border-input bg-background px-3 text-sm">
                    <option value="">Adicionar vendedor…</option>
                    {available.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                  <Button type="button" variant="outline" onClick={addOwner} disabled={!newOwner}>
                    <Plus className="size-4" /> Adicionar
                  </Button>
                  <Button type="button" variant="ghost" onClick={copyPrevious}>
                    <Copy className="size-4" /> Copiar do mês anterior
                  </Button>
                </div>
                <div className="flex items-center gap-3">
                  {message && <span className={message.kind === "ok" ? "text-sm text-primary" : "text-sm text-destructive"}>{message.text}</span>}
                  <Button type="button" onClick={save} disabled={!dirty || saving}>
                    {saving ? "Salvando…" : "Salvar metas"}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Panel>

      <Panel title="Pipelines que contam como venda" info={SOURCES.pipelineSettings()}>
        <p className="text-sm text-muted-foreground">
          Os desmarcados ficam fora do fechamento, da previsão e das metas de receita (ex.: distratos, contratos que repetem uma venda, vendas automáticas sem vendedor).
        </p>
        {pipelines.isLoading ? (
          <LoadingBlock className="h-32" />
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {(pipelines.data ?? []).map((p) => (
              <li key={p.id}>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm has-[:disabled]:cursor-default">
                  <Checkbox checked={p.countsAsSales} disabled={!canEdit} onCheckedChange={(c) => togglePipeline(p.id, c === true)} />
                  <span className={p.countsAsSales ? "font-medium" : "text-muted-foreground line-through"}>{p.label}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </CommercialShell>
  );
}
