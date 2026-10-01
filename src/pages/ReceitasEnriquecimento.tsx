import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface OfxImportRow {
  id: string;
  file_name: string | null;
  status: string;
  bank_account: { display_name: string } | null;
}

interface OfxTransactionRow {
  id: string;
  posted_at: string | null;
  amount: number | null;
  memo: string | null;
  status: string;
  hubspot_contact_id: string | null;
  contact_name: string | null;
  hubspot_product_id: string | null;
  product_name: string | null;
  hubspot_owner_id: string | null;
  owner_name: string | null;
  cost_center: string | null;
  notes: string | null;
}

interface HubspotProduct {
  hubspot_id: string;
  name: string | null;
}

interface HubspotOwner {
  owner_id: string;
  first_name: string | null;
  last_name: string | null;
}

interface ContactResult {
  hubspot_id: string;
  firstname: string | null;
  lastname: string | null;
  email: string | null;
}

interface EditableFields {
  hubspot_contact_id: string | null;
  contact_name: string | null;
  hubspot_product_id: string | null;
  product_name: string | null;
  hubspot_owner_id: string | null;
  owner_name: string | null;
  cost_center: string | null;
  notes: string | null;
}

function formatCurrency(value: number | null) {
  return (value ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(`${value}T00:00:00`).toLocaleDateString("pt-BR");
}

export default function ReceitasEnriquecimento() {
  const { importId } = useParams<{ importId: string }>();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [importRow, setImportRow] = useState<OfxImportRow | null>(null);
  const [rows, setRows] = useState<OfxTransactionRow[]>([]);
  const [products, setProducts] = useState<HubspotProduct[]>([]);
  const [owners, setOwners] = useState<HubspotOwner[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<EditableFields>>>({});
  const [contactSearch, setContactSearch] = useState<Record<string, { term: string; results: ContactResult[] }>>({});
  const [saving, setSaving] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "error" | "success"; text: string } | null>(null);

  const load = async () => {
    if (!importId) return;
    setLoading(true);

    const [{ data: imp }, { data: txs }, { data: prods }, { data: owns }] = await Promise.all([
      supabase.from("ofx_imports").select("id, file_name, status, bank_account:bank_accounts(display_name)").eq("id", importId).maybeSingle(),
      supabase
        .from("ofx_transactions")
        .select(
          "id, posted_at, amount, memo, status, hubspot_contact_id, contact_name, hubspot_product_id, product_name, hubspot_owner_id, owner_name, cost_center, notes",
        )
        .eq("ofx_import_id", importId)
        .order("posted_at"),
      supabase.from("hubspot_products").select("hubspot_id, name").order("name"),
      supabase.from("hubspot_owners").select("owner_id, first_name, last_name").order("first_name"),
    ]);

    setImportRow(imp as unknown as OfxImportRow | null);
    setRows(txs ?? []);
    setProducts(prods ?? []);
    // Alguns "donos" da HubSpot não têm nome (contas de sistema/desativadas) —
    // sem nome pra mostrar, não dá pra escolher de forma útil no dropdown.
    setOwners((owns ?? []).filter((o) => o.first_name || o.last_name));
    setEdits({});
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importId]);

  const readOnly = importRow?.status === "finalizado";

  const field = <K extends keyof EditableFields>(row: OfxTransactionRow, key: K): EditableFields[K] =>
    (edits[row.id]?.[key] !== undefined ? edits[row.id][key] : row[key]) as EditableFields[K];

  const setField = (rowId: string, patch: Partial<EditableFields>) => {
    setEdits((prev) => ({ ...prev, [rowId]: { ...prev[rowId], ...patch } }));
  };

  // Busca de contato debounced por linha.
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const [rowId, state] of Object.entries(contactSearch)) {
      if (!state.term || state.term.length < 3) continue;
      const t = setTimeout(async () => {
        const { data } = await supabase
          .from("hubspot_contacts")
          .select("hubspot_id, firstname, lastname, email")
          .or(`firstname.ilike.%${state.term}%,lastname.ilike.%${state.term}%,email.ilike.%${state.term}%`)
          .limit(10);
        setContactSearch((prev) => ({ ...prev, [rowId]: { term: prev[rowId]?.term ?? state.term, results: data ?? [] } }));
      }, 350);
      timers.push(t);
    }
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(Object.fromEntries(Object.entries(contactSearch).map(([k, v]) => [k, v.term])))]);

  const pendingCount = Object.keys(edits).length;

  const handleSave = async () => {
    setSaving(true);
    setFeedback(null);

    const entries = Object.entries(edits);
    for (const [rowId, patch] of entries) {
      const { error } = await supabase.from("ofx_transactions").update(patch).eq("id", rowId);
      if (error) {
        setSaving(false);
        setFeedback({ type: "error", text: `Falha ao salvar: ${error.message}` });
        return;
      }
    }

    setSaving(false);
    setFeedback({ type: "success", text: "Alterações salvas." });
    await load();
  };

  const missingCount = useMemo(
    () => rows.filter((r) => !field(r, "hubspot_contact_id") || !field(r, "hubspot_product_id")).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, edits],
  );

  const handleFinalize = async () => {
    if (!importId) return;
    setFinalizing(true);
    setFeedback(null);

    const { error: txError } = await supabase
      .from("ofx_transactions")
      .update({ status: "finalizado" })
      .eq("ofx_import_id", importId)
      .eq("status", "selecionado");

    if (txError) {
      setFinalizing(false);
      setConfirmOpen(false);
      setFeedback({ type: "error", text: `Falha ao finalizar: ${txError.message}` });
      return;
    }

    const { error: impError } = await supabase
      .from("ofx_imports")
      .update({ status: "finalizado", finalized_by: user?.id ?? null, finalized_at: new Date().toISOString() })
      .eq("id", importId);

    setFinalizing(false);
    setConfirmOpen(false);

    if (impError) {
      setFeedback({ type: "error", text: `Falha ao finalizar o lote: ${impError.message}` });
      return;
    }

    setFeedback({ type: "success", text: "Lote finalizado — os lançamentos já estão na base oficial." });
    await load();
  };

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Carregando...</div>;
  }

  if (!importRow) {
    return <div className="p-6 text-sm text-muted-foreground">Lote não encontrado.</div>;
  }

  return (
    <div className="p-6">
      <Link to="/financeiro/receitas" className="text-sm text-muted-foreground hover:underline">
        ← Voltar pra Receitas
      </Link>

      <div className="mt-2 flex items-center gap-2">
        <h1 className="text-xl font-medium">
          {importRow.bank_account?.display_name} — {importRow.file_name}
        </h1>
        <Badge variant={readOnly ? "default" : "secondary"}>{importRow.status}</Badge>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {readOnly
          ? "Lote finalizado — somente leitura."
          : "Ligue cada lançamento a um Contato, Produto e Dono da HubSpot antes de finalizar."}
      </p>

      <div className="mt-6 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Data</th>
              <th className="px-3 py-2 font-medium">Valor</th>
              <th className="px-3 py-2 font-medium">Memo</th>
              <th className="px-3 py-2 font-medium">Contato</th>
              <th className="px-3 py-2 font-medium">Produto</th>
              <th className="px-3 py-2 font-medium">Dono</th>
              <th className="px-3 py-2 font-medium">Centro de Custo</th>
              <th className="px-3 py-2 font-medium">Observação</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const search = contactSearch[row.id] ?? { term: "", results: [] };
              const contactName = field(row, "contact_name");
              return (
                <tr key={row.id} className="border-t border-border align-top">
                  <td className="px-3 py-2 text-muted-foreground">{formatDate(row.posted_at)}</td>
                  <td className="px-3 py-2">{formatCurrency(row.amount)}</td>
                  <td className="max-w-[220px] px-3 py-2 text-xs text-muted-foreground">{row.memo}</td>
                  <td className="min-w-[200px] px-3 py-2">
                    {readOnly ? (
                      contactName ?? "—"
                    ) : (
                      <div className="relative">
                        <Input
                          value={search.term || contactName || ""}
                          placeholder="Buscar por nome ou e-mail..."
                          onChange={(e) =>
                            setContactSearch((prev) => ({ ...prev, [row.id]: { term: e.target.value, results: [] } }))
                          }
                        />
                        {search.results.length > 0 && (
                          <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-popover shadow-md">
                            {search.results.map((c) => (
                              <button
                                key={c.hubspot_id}
                                type="button"
                                className="block w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
                                onClick={() => {
                                  setField(row.id, {
                                    hubspot_contact_id: c.hubspot_id,
                                    contact_name: `${c.firstname ?? ""} ${c.lastname ?? ""}`.trim() || c.email,
                                  });
                                  setContactSearch((prev) => ({ ...prev, [row.id]: { term: "", results: [] } }));
                                }}
                              >
                                {`${c.firstname ?? ""} ${c.lastname ?? ""}`.trim() || c.email}
                                {c.email && <span className="text-muted-foreground"> — {c.email}</span>}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="min-w-[160px] px-3 py-2">
                    {readOnly ? (
                      field(row, "product_name") ?? "—"
                    ) : (
                      <select
                        value={field(row, "hubspot_product_id") ?? ""}
                        onChange={(e) => {
                          const p = products.find((pr) => pr.hubspot_id === e.target.value);
                          setField(row.id, { hubspot_product_id: p?.hubspot_id ?? null, product_name: p?.name ?? null });
                        }}
                        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                      >
                        <option value="">—</option>
                        {products.map((p) => (
                          <option key={p.hubspot_id} value={p.hubspot_id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="min-w-[160px] px-3 py-2">
                    {readOnly ? (
                      field(row, "owner_name") ?? "—"
                    ) : (
                      <select
                        value={field(row, "hubspot_owner_id") ?? ""}
                        onChange={(e) => {
                          const o = owners.find((ow) => ow.owner_id === e.target.value);
                          setField(row.id, {
                            hubspot_owner_id: o?.owner_id ?? null,
                            owner_name: o ? `${o.first_name ?? ""} ${o.last_name ?? ""}`.trim() : null,
                          });
                        }}
                        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                      >
                        <option value="">—</option>
                        {owners.map((o) => (
                          <option key={o.owner_id} value={o.owner_id}>
                            {`${o.first_name ?? ""} ${o.last_name ?? ""}`.trim()}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="min-w-[140px] px-3 py-2">
                    {readOnly ? (
                      row.cost_center ?? "—"
                    ) : (
                      <Input
                        value={field(row, "cost_center") ?? ""}
                        onChange={(e) => setField(row.id, { cost_center: e.target.value })}
                      />
                    )}
                  </td>
                  <td className="min-w-[140px] px-3 py-2">
                    {readOnly ? (
                      row.notes ?? "—"
                    ) : (
                      <Input value={field(row, "notes") ?? ""} onChange={(e) => setField(row.id, { notes: e.target.value })} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {feedback && (
        <p className={feedback.type === "error" ? "mt-3 text-sm text-destructive" : "mt-3 text-sm text-primary"}>
          {feedback.text}
        </p>
      )}

      {!readOnly && (
        <div className="mt-4 flex gap-2">
          <Button variant="outline" onClick={handleSave} disabled={saving || pendingCount === 0}>
            {saving ? "Salvando..." : `Salvar alterações${pendingCount > 0 ? ` (${pendingCount})` : ""}`}
          </Button>
          <Button onClick={() => setConfirmOpen(true)} disabled={finalizing || rows.length === 0}>
            Finalizar lote
          </Button>
        </div>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Finalizar lote</DialogTitle>
            <DialogDescription>
              {missingCount > 0
                ? `${missingCount} de ${rows.length} lançamento(s) sem Contato ou Produto vinculado. Eles ainda vão pra base oficial, só sem esses dados. Finalizar mesmo assim?`
                : `Todos os ${rows.length} lançamentos estão com Contato e Produto vinculados. Confirmar finalização?`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleFinalize} disabled={finalizing}>
              {finalizing ? "Finalizando..." : "Finalizar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
