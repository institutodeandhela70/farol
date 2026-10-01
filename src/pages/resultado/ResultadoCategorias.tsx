import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { supabase } from "@/lib/supabase";
import { formatInt } from "@/lib/commercial";
import { formatMoney } from "@/lib/money";
import { TREATMENT_LABEL, TREATMENT_SHORT, useCategoryMap, type CategoryMapRow, type Treatment } from "@/lib/categoryMap";
import { useSalesCatalog } from "@/lib/salesData";
import { EmptyState, KpiCard, LoadingBlock, Panel, WarnNote } from "@/components/commercial/CommercialUI";
import { ResultShell } from "@/components/result/ResultUI";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const ORDER: Treatment[] = ["soma", "revisar", "a_classificar", "fora_outros_produtos", "nao_operacional"];

const TONE: Record<Treatment, string> = {
  soma: "bg-primary/10 text-primary",
  revisar: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  a_classificar: "bg-destructive/10 text-destructive",
  fora_outros_produtos: "bg-muted text-muted-foreground",
  nao_operacional: "bg-muted text-muted-foreground",
};

const dreShort = (dre: string | null) => (dre ? dre.replace(/\(\+\/?-?\)\s*/g, "").replace(/\s+/g, " ").trim().toLowerCase() : "sem DRE");

export default function ResultadoCategorias() {
  const { workspace, role } = useWorkspace();
  const ws = workspace?.id;
  const canEdit = role === "owner" || role === "admin";
  const queryClient = useQueryClient();
  const map = useCategoryMap(ws);
  const catalog = useSalesCatalog(ws);

  const [filter, setFilter] = useState<Treatment | "todas">("todas");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [produtoEdits, setProdutoEdits] = useState<Record<string, string>>({});

  const rows = map.data ?? [];
  const totals = useMemo(() => {
    const t = new Map<Treatment, { qtd: number; valor: number; cats: number }>();
    for (const r of rows) {
      const cur = t.get(r.tratamento) ?? { qtd: 0, valor: 0, cats: 0 };
      cur.qtd += r.qtd_recebido;
      cur.valor += r.valor_recebido;
      cur.cats += 1;
      t.set(r.tratamento, cur);
    }
    return t;
  }, [rows]);
  const totalValor = rows.reduce((a, r) => a + r.valor_recebido, 0);
  const visible = rows.filter((r) => filter === "todas" || r.tratamento === filter);
  const productNames = useMemo(() => {
    const names = new Set<string>((catalog.data ?? []).map((c) => c.produto));
    for (const r of rows) if (r.produto) names.add(r.produto);
    return [...names].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [catalog.data, rows]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["sales", "category-map"] });
  const fail = (err: unknown) => setMessage({ kind: "error", text: `Não foi possível salvar: ${(err as Error).message}` });

  const save = async (row: CategoryMapRow, patch: { tratamento?: Treatment; produto?: string | null }) => {
    if (!ws) return;
    setMessage(null);
    const next = { ...patch, updated_at: new Date().toISOString() };
    const { error } = await supabase.from("iuli_category_map").update(next).eq("workspace_id", ws).eq("nome_norm", row.nome_norm);
    if (error) return fail(error);
    setProdutoEdits((e) => {
      const { [row.nome_norm]: _drop, ...rest } = e;
      return rest;
    });
    await refresh();
    setMessage({ kind: "ok", text: `${row.categoria}: salvo.` });
  };

  const fetchNew = async () => {
    if (!ws) return;
    setMessage(null);
    const { data, error } = await supabase.rpc("iuli_category_map_refresh", { p_workspace_id: ws });
    if (error) return fail(error);
    await refresh();
    setMessage({ kind: "ok", text: Number(data) > 0 ? `${data} categoria(s) nova(s) incluída(s).` : "Nenhuma categoria nova." });
  };

  const pending = totals.get("revisar");

  return (
    <ResultShell title="Categorias da IULI" description="Quais categorias de receita da IULI são receita de produto — e de qual produto — para Receita e Caixa">
      {!canEdit && <WarnNote>Só donos e administradores do workspace podem editar. Você está vendo em modo leitura.</WarnNote>}
      {pending && pending.cats > 0 && (
        <WarnNote>
          {pending.cats} categoria(s) ainda <b>a revisar</b> ({formatMoney(pending.valor)} recebidos). Enquanto não forem decididas, ficam fora da Receita e do Caixa.
        </WarnNote>
      )}
      {message && (
        <p role="status" className={cn("text-sm font-medium", message.kind === "ok" ? "text-primary" : "text-destructive")}>
          {message.text}
        </p>
      )}

      <section aria-label="Resumo por tratamento" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {ORDER.map((t) => {
          const v = totals.get(t);
          return (
            <KpiCard
              key={t}
              label={TREATMENT_SHORT[t]}
              value={formatMoney(v?.valor ?? 0)}
              sub={`${formatInt(v?.cats ?? 0)} ${(v?.cats ?? 0) === 1 ? "categoria" : "categorias"} · ${totalValor ? Math.round(((v?.valor ?? 0) / totalValor) * 100) : 0}% do recebido`}
              tone={t === "revisar" && (v?.cats ?? 0) > 0 ? "warn" : "default"}
              loading={map.isLoading}
            />
          );
        })}
      </section>

      <Panel
        title="Categorias de receita"
        action={
          <div className="flex flex-wrap items-center gap-2">
            {canEdit && (
              <Button variant="outline" size="sm" onClick={fetchNew}>
                Buscar categorias novas
              </Button>
            )}
          </div>
        }
      >
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por tratamento">
          {(["todas", ...ORDER] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setFilter(t)}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-sm font-medium",
                filter === t ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:bg-accent",
              )}
            >
              {t === "todas" ? `Todas (${rows.length})` : `${TREATMENT_SHORT[t]} (${totals.get(t)?.cats ?? 0})`}
            </button>
          ))}
        </div>

        {map.isLoading ? (
          <LoadingBlock />
        ) : visible.length ? (
          <div className="-mx-4 overflow-x-auto md:mx-0">
            <datalist id="produtos-farol">
              {productNames.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
            <table className="w-full min-w-[920px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-4 py-2 font-medium md:pl-0">Categoria na IULI</th>
                  <th className="px-3 py-2 font-medium">Grupo do DRE</th>
                  <th className="px-3 py-2 text-right font-medium">Recebido</th>
                  <th className="px-3 py-2 text-right font-medium">Em aberto</th>
                  <th className="px-3 py-2 font-medium">Tratamento</th>
                  <th className="px-4 py-2 font-medium md:pr-0">Produto</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const needsProduct = r.tratamento === "soma" && !(produtoEdits[r.nome_norm] ?? r.produto);
                  return (
                    <tr key={r.nome_norm} className="border-b border-border/60 align-top last:border-0">
                      <td className="max-w-64 px-4 py-2.5 md:pl-0">
                        <span className="font-medium">{r.categoria}</span>
                        {r.empresas.length > 0 && <span className="block text-xs text-muted-foreground">{r.empresas.join(" · ")}</span>}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">{dreShort(r.categoria_dre)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        <span className="font-semibold">{formatMoney(r.valor_recebido)}</span>
                        <span className="block text-xs text-muted-foreground">{formatInt(r.qtd_recebido)} lançamentos</span>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {formatMoney(r.valor_aberto)}
                        <span className="block text-xs text-muted-foreground">{formatInt(r.qtd_aberto)} lançamentos</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <select
                          aria-label={`Tratamento de ${r.categoria}`}
                          className={cn("h-9 max-w-[15rem] rounded-md border border-input px-2 text-sm font-medium", TONE[r.tratamento])}
                          value={r.tratamento}
                          disabled={!canEdit}
                          onChange={(e) => save(r, { tratamento: e.target.value as Treatment })}
                        >
                          {ORDER.map((t) => (
                            <option key={t} value={t}>
                              {TREATMENT_LABEL[t]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-2.5 md:pr-0">
                        <Input
                          aria-label={`Produto de ${r.categoria}`}
                          list="produtos-farol"
                          className={cn("h-9 w-44", needsProduct && "border-destructive")}
                          placeholder={r.tratamento === "soma" ? "Informe o produto" : "—"}
                          disabled={!canEdit || r.tratamento !== "soma"}
                          value={produtoEdits[r.nome_norm] ?? r.produto ?? ""}
                          onChange={(e) => setProdutoEdits((prev) => ({ ...prev, [r.nome_norm]: e.target.value }))}
                          onBlur={() => {
                            const v = produtoEdits[r.nome_norm];
                            if (v !== undefined && v.trim() !== (r.produto ?? "")) save(r, { produto: v.trim() || null });
                          }}
                        />
                        {needsProduct && <span className="mt-1 block text-xs text-destructive">Sem produto, não entra na soma por produto.</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState>Nenhuma categoria nesse filtro.</EmptyState>
        )}
        <p className="text-sm text-muted-foreground">
          Os valores são dos lançamentos que já vieram da IULI com categoria; o histórico continua sendo carregado em segundo plano, do mês atual para trás. A categoria de um lançamento é a que o financeiro definiu na IULI.
        </p>
      </Panel>
    </ResultShell>
  );
}
