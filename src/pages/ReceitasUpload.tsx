import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { useAuth } from "@/hooks/useAuth";
import { parseOfx, type ParsedOfxTransaction } from "@/lib/ofx";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface BankAccount {
  id: string;
  display_name: string;
}

interface OfxImportRow {
  id: string;
  file_name: string | null;
  status: string;
  transactions_total: number;
  transactions_selected: number;
  uploaded_at: string;
  bank_account: { display_name: string } | null;
}

function formatCurrency(value: number | null) {
  return (value ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(`${value}T00:00:00`).toLocaleDateString("pt-BR");
}

export default function ReceitasUpload() {
  const { workspace } = useWorkspace();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [bankAccountId, setBankAccountId] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<ParsedOfxTransaction[]>([]);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [showDebits, setShowDebits] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [imports, setImports] = useState<OfxImportRow[]>([]);

  const loadBankAccounts = async () => {
    if (!workspace) return;
    const { data } = await supabase
      .from("bank_accounts")
      .select("id, display_name")
      .eq("workspace_id", workspace.id)
      .order("display_name");
    setBankAccounts(data ?? []);
    if (data && data.length > 0 && !bankAccountId) setBankAccountId(data[0].id);
  };

  const loadImports = async () => {
    if (!workspace) return;
    const { data } = await supabase
      .from("ofx_imports")
      .select("id, file_name, status, transactions_total, transactions_selected, uploaded_at, bank_account:bank_accounts(display_name)")
      .eq("workspace_id", workspace.id)
      .order("uploaded_at", { ascending: false })
      .limit(20);
    setImports((data as unknown as OfxImportRow[]) ?? []);
  };

  useEffect(() => {
    loadBankAccounts();
    loadImports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace?.id]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setParseError(null);
    setFeedback(null);
    setTransactions([]);
    setSelected({});
    setFileName(file.name);

    try {
      const raw = await file.text();
      const parsed = parseOfx(raw);
      setTransactions(parsed.transactions);
      const initialSelection: Record<number, boolean> = {};
      parsed.transactions.forEach((t, i) => {
        if (t.trnType === "CREDIT") initialSelection[i] = true;
      });
      setSelected(initialSelection);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Falha ao ler o arquivo.");
    }
  };

  const visibleIndexes = transactions
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => showDebits || t.trnType === "CREDIT")
    .map(({ i }) => i);

  const selectedCount = Object.values(selected).filter(Boolean).length;

  const toggleOne = (i: number) => setSelected((prev) => ({ ...prev, [i]: !prev[i] }));

  const handleSync = async () => {
    if (!workspace || !bankAccountId) return;
    const chosen = transactions
      .map((t, i) => ({ t, i }))
      .filter(({ i }) => selected[i])
      .map(({ t }) => t);

    if (chosen.length === 0) {
      setFeedback({ type: "error", text: "Selecione pelo menos um lançamento pra sincronizar." });
      return;
    }

    setSaving(true);
    setFeedback(null);

    const { data: importRow, error: importError } = await supabase
      .from("ofx_imports")
      .insert({
        workspace_id: workspace.id,
        bank_account_id: bankAccountId,
        file_name: fileName,
        transactions_total: transactions.length,
        transactions_selected: chosen.length,
        uploaded_by: user?.id ?? null,
      })
      .select("id")
      .single();

    if (importError || !importRow) {
      setSaving(false);
      setFeedback({ type: "error", text: importError?.message ?? "Falha ao criar o lote." });
      return;
    }

    const rows = chosen.map((t) => ({
      workspace_id: workspace.id,
      ofx_import_id: importRow.id,
      bank_account_id: bankAccountId,
      fitid: t.fitid,
      trn_type: t.trnType,
      posted_at: t.postedAt,
      amount: t.amount,
      memo: t.memo,
      status: "selecionado",
      source: "ofx_upload",
      raw_payload: t,
    }));

    const { error: insertError, count } = await supabase
      .from("ofx_transactions")
      .upsert(rows, { onConflict: "workspace_id,bank_account_id,fitid", ignoreDuplicates: true, count: "exact" });

    setSaving(false);

    if (insertError) {
      setFeedback({ type: "error", text: `Falha ao gravar lançamentos: ${insertError.message}` });
      return;
    }

    const skipped = chosen.length - (count ?? chosen.length);
    setFeedback({
      type: "success",
      text:
        skipped > 0
          ? `Sincronizado: ${count ?? chosen.length} lançamento(s) novo(s) (${skipped} já existia(m), ignorado(s)).`
          : `Sincronizado: ${chosen.length} lançamento(s).`,
    });

    setTransactions([]);
    setSelected({});
    setFileName(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    await loadImports();
  };

  return (
    <div className="p-6">
      <h1 className="text-xl font-medium">Receitas — Upload OFX</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Envie o extrato bancário (.ofx), escolha os lançamentos que são receita e sincronize pro lote financeiro.
      </p>

      {bankAccounts.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">
          Nenhuma conta bancária cadastrada ainda. Peça a um admin do workspace pra cadastrar uma.
        </p>
      ) : (
        <div className="mt-6 flex flex-col gap-4 rounded-lg border border-border p-4">
          <div className="flex flex-col gap-1.5 sm:max-w-xs">
            <label htmlFor="bank-account" className="text-sm font-medium">
              Conta bancária
            </label>
            <select
              id="bank-account"
              value={bankAccountId}
              onChange={(e) => setBankAccountId(e.target.value)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              {bankAccounts.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.display_name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="ofx-file" className="text-sm font-medium">
              Arquivo OFX
            </label>
            <input
              id="ofx-file"
              ref={fileInputRef}
              type="file"
              accept=".ofx"
              onChange={handleFileChange}
              className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-secondary-foreground hover:file:bg-secondary/80"
            />
          </div>

          {parseError && <p className="text-sm text-destructive">{parseError}</p>}

          {transactions.length > 0 && (
            <>
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={showDebits} onChange={(e) => setShowDebits(e.target.checked)} />
                  Mostrar débitos também
                </label>
                <span className="text-sm text-muted-foreground">
                  {selectedCount} de {transactions.length} selecionado(s)
                </span>
              </div>

              <div className="max-h-[400px] overflow-y-auto overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted/50 text-left text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium"></th>
                      <th className="px-3 py-2 font-medium">Data</th>
                      <th className="px-3 py-2 font-medium">Tipo</th>
                      <th className="px-3 py-2 font-medium">Valor</th>
                      <th className="px-3 py-2 font-medium">Memo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleIndexes.map((i) => {
                      const t = transactions[i];
                      return (
                        <tr key={i} className="border-t border-border">
                          <td className="px-3 py-2">
                            <input type="checkbox" checked={!!selected[i]} onChange={() => toggleOne(i)} />
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{formatDate(t.postedAt)}</td>
                          <td className="px-3 py-2">
                            <Badge variant={t.trnType === "CREDIT" ? "default" : "secondary"}>{t.trnType ?? "—"}</Badge>
                          </td>
                          <td className="px-3 py-2">{formatCurrency(t.amount)}</td>
                          <td className="px-3 py-2 text-muted-foreground">{t.memo ?? "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {feedback && (
                <p className={feedback.type === "error" ? "text-sm text-destructive" : "text-sm text-primary"}>
                  {feedback.text}
                </p>
              )}

              <Button onClick={handleSync} disabled={saving}>
                {saving ? "Sincronizando..." : "Sincronizar selecionados"}
              </Button>
            </>
          )}
        </div>
      )}

      <h2 className="mt-8 text-sm font-medium text-muted-foreground">Lotes recentes</h2>
      {imports.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Nenhum lote enviado ainda.</p>
      ) : (
        <div className="mt-3 overflow-x-auto overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Conta</th>
                <th className="px-4 py-2 font-medium">Arquivo</th>
                <th className="px-4 py-2 font-medium">Lançamentos</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Enviado em</th>
              </tr>
            </thead>
            <tbody>
              {imports.map((imp) => (
                <tr key={imp.id} className="border-t border-border hover:bg-muted/30">
                  <td className="px-4 py-2">
                    <Link to={`/financeiro/receitas/${imp.id}`} className="block text-primary hover:underline">
                      {imp.bank_account?.display_name ?? "—"}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{imp.file_name ?? "—"}</td>
                  <td className="px-4 py-2">
                    {imp.transactions_selected} / {imp.transactions_total}
                  </td>
                  <td className="px-4 py-2">
                    <Badge variant="secondary">{imp.status}</Badge>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {new Date(imp.uploaded_at).toLocaleString("pt-BR")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
