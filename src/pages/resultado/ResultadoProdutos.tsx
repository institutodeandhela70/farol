import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { supabase } from "@/lib/supabase";
import { formatInt } from "@/lib/commercial";
import { formatMoney } from "@/lib/money";
import { useRawProducts, useSalesCatalog, useSalesOverrides, useSalesSettings, type PipelineKind, type SalesGroup } from "@/lib/salesData";
import { EmptyState, LoadingBlock, Panel, WarnNote } from "@/components/commercial/CommercialUI";
import { ResultShell } from "@/components/result/ResultUI";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const PIPELINE_LABEL: Record<PipelineKind, string> = { contratos: "Contratos", hubla_tmb: "Hubla & TMB" };
const GROUP_LABEL: Record<SalesGroup, { text: string; className: string }> = {
  high: { text: "High ticket", className: "bg-primary/10 text-primary" },
  demais: { text: "Demais", className: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200" },
  fora_dos_6: { text: "Fora dos 6", className: "bg-destructive/10 text-destructive" },
};

type Message = { kind: "ok" | "error"; text: string } | null;

export default function ResultadoProdutos() {
  const { workspace, role } = useWorkspace();
  const ws = workspace?.id;
  const canEdit = role === "owner" || role === "admin";
  const queryClient = useQueryClient();
  const catalog = useSalesCatalog(ws);
  const overrides = useSalesOverrides(ws);
  const raws = useRawProducts(ws);
  const settings = useSalesSettings(ws);

  const [message, setMessage] = useState<Message>(null);
  const [newProduct, setNewProduct] = useState("");
  const [days, setDays] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["sales"] });
  const fail = (err: unknown) => setMessage({ kind: "error", text: `Não foi possível salvar: ${(err as Error).message}` });

  const overrideMap = useMemo(() => new Map((overrides.data ?? []).map((o) => [`${o.source}|${o.raw_value}`, o.produto])), [overrides.data]);
  const productNames = useMemo(() => [...new Set([...(catalog.data ?? []).map((c) => c.produto), ...(raws.data ?? []).map((r) => r.produto)])].sort((a, b) => a.localeCompare(b, "pt-BR")), [catalog.data, raws.data]);

  const toggleHigh = async (produto: string, isHigh: boolean) => {
    if (!ws) return;
    setMessage(null);
    const { error } = await supabase.from("sales_product_catalog").update({ is_high: isHigh }).eq("workspace_id", ws).eq("produto", produto);
    if (error) return fail(error);
    await refresh();
  };

  const addProduct = async () => {
    const name = newProduct.trim();
    if (!ws || !name) return;
    setMessage(null);
    const { error } = await supabase.from("sales_product_catalog").insert({ workspace_id: ws, produto: name, is_high: true, sort_order: 100 });
    if (error) return fail(error);
    setNewProduct("");
    await refresh();
    setMessage({ kind: "ok", text: `${name} adicionado como um dos 6.` });
  };

  const removeProduct = async (produto: string) => {
    if (!ws) return;
    setMessage(null);
    const { error } = await supabase.from("sales_product_catalog").delete().eq("workspace_id", ws).eq("produto", produto);
    if (error) return fail(error);
    await refresh();
  };

  const saveOverride = async (source: PipelineKind, raw: string, produto: string, current: string) => {
    if (!ws) return;
    setMessage(null);
    const key = `${source}|${raw}`;
    const value = produto.trim();
    const existing = overrideMap.has(key);
    try {
      if (!value || value === current) {
        // igual ao padronizado: só mantém a correção se ela já existia e mudou
        setEdits((e) => {
          const { [key]: _drop, ...rest } = e;
          return rest;
        });
        return;
      }
      const { error } = existing
        ? await supabase.from("sales_product_overrides").update({ produto: value }).eq("workspace_id", ws).eq("source", source).eq("raw_value", raw)
        : await supabase.from("sales_product_overrides").insert({ workspace_id: ws, source, raw_value: raw, produto: value });
      if (error) throw error;
      setEdits((e) => {
        const { [key]: _drop, ...rest } = e;
        return rest;
      });
      await refresh();
      setMessage({ kind: "ok", text: "De-para salvo." });
    } catch (err) {
      fail(err);
    }
  };

  const revertOverride = async (source: PipelineKind, raw: string) => {
    if (!ws) return;
    setMessage(null);
    const { error } = await supabase.from("sales_product_overrides").delete().eq("workspace_id", ws).eq("source", source).eq("raw_value", raw);
    if (error) return fail(error);
    await refresh();
  };

  const saveSettings = async (patch: { dedupe_enabled?: boolean; dedupe_days?: number }) => {
    if (!ws) return;
    setMessage(null);
    const values = { ...patch };
    const { data, error } = await supabase.from("sales_settings").update(values).eq("workspace_id", ws).select("workspace_id");
    if (error) return fail(error);
    if (!data?.length) {
      const { error: e2 } = await supabase.from("sales_settings").insert({ workspace_id: ws, ...values });
      if (e2) return fail(e2);
    }
    setDays(null);
    await refresh();
    setMessage({ kind: "ok", text: "Configuração salva." });
  };

  return (
    <ResultShell title="Produtos" description="Quais produtos são dos 6 (high ticket), o de-para dos nomes do HubSpot e a regra de duplicidade">
      {!canEdit && <WarnNote>Só donos e administradores do workspace podem editar. Você está vendo em modo leitura.</WarnNote>}
      {message && (
        <p role="status" className={cn("text-sm font-medium", message.kind === "ok" ? "text-primary" : "text-destructive")}>
          {message.text}
        </p>
      )}

      <Panel title="Produtos dos 6 (high ticket)">
        {catalog.isLoading ? (
          <LoadingBlock className="h-24" />
        ) : (
          <div className="flex flex-col gap-4">
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {(catalog.data ?? []).map((c) => (
                <li key={c.produto} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
                  <label className="flex min-h-9 items-center gap-2.5 text-sm font-medium">
                    <input
                      type="checkbox"
                      className="size-4 accent-[hsl(var(--primary))]"
                      checked={c.is_high}
                      disabled={!canEdit}
                      onChange={(e) => toggleHigh(c.produto, e.target.checked)}
                    />
                    {c.produto}
                  </label>
                  {canEdit && (
                    <button type="button" className="text-xs text-muted-foreground underline underline-offset-2 hover:text-destructive" onClick={() => removeProduct(c.produto)}>
                      remover
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {canEdit && (
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="novo-produto" className="text-sm text-muted-foreground">
                    Adicionar produto aos 6
                  </label>
                  <Input id="novo-produto" className="w-64" value={newProduct} onChange={(e) => setNewProduct(e.target.value)} placeholder="Nome padronizado" />
                </div>
                <Button variant="outline" onClick={addProduct} disabled={!newProduct.trim()}>
                  Adicionar
                </Button>
              </div>
            )}
            <p className="text-sm text-muted-foreground">Marcado = conta como high ticket em Contratos e na Hubla &amp; TMB. Desmarcado em Contratos = vai para "fora dos 6" (fora da soma).</p>
          </div>
        )}
      </Panel>

      <Panel title="Regra de duplicidade (Hubla & TMB × Contratos)">
        {settings.isLoading ? (
          <LoadingBlock className="h-16" />
        ) : (
          <div className="flex flex-col gap-3">
            <label className="flex min-h-9 items-center gap-2.5 text-sm font-medium">
              <input
                type="checkbox"
                className="size-4 accent-[hsl(var(--primary))]"
                checked={settings.data?.dedupe_enabled ?? true}
                disabled={!canEdit}
                onChange={(e) => saveSettings({ dedupe_enabled: e.target.checked })}
              />
              Tirar da soma o negócio da Hubla &amp; TMB que repete um ganho de Contratos
            </label>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="dedupe-dias" className="text-sm text-muted-foreground">
                  Diferença máxima entre as datas de ganho (dias)
                </label>
                <Input
                  id="dedupe-dias"
                  type="number"
                  min={0}
                  max={730}
                  className="w-32"
                  disabled={!canEdit}
                  value={days ?? String(settings.data?.dedupe_days ?? 90)}
                  onChange={(e) => setDays(e.target.value)}
                />
              </div>
              <Button variant="outline" disabled={!canEdit || days === null} onClick={() => saveSettings({ dedupe_days: Math.max(0, Math.min(730, Number(days) || 0)) })}>
                Salvar
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">Só vale para produtos dos 6. O cliente é comparado pelo nome do negócio, sem acento e sem a etiqueta entre colchetes.</p>
          </div>
        )}
      </Panel>

      <Panel title="De-para dos nomes de produto do HubSpot">
        {raws.isLoading ? (
          <LoadingBlock />
        ) : raws.data?.length ? (
          <div className="-mx-4 overflow-x-auto md:mx-0">
            <datalist id="produtos-list">
              {productNames.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-4 py-2 font-medium md:pl-0">Nome no HubSpot</th>
                  <th className="px-3 py-2 font-medium">Pipeline</th>
                  <th className="px-3 py-2 font-medium">Produto padronizado</th>
                  <th className="px-3 py-2 font-medium">Grupo</th>
                  <th className="px-3 py-2 text-right font-medium">Negócios</th>
                  <th className="px-4 py-2 text-right font-medium md:pr-0">Valor (histórico)</th>
                </tr>
              </thead>
              <tbody>
                {raws.data.map((r, idx) => {
                  const raw = r.produto_raw ?? "";
                  const key = `${r.pipeline_kind}|${raw}`;
                  const overridden = overrideMap.has(key);
                  const editable = canEdit && raw !== "";
                  return (
                    <tr key={`${key}|${r.grupo}|${idx}`} className="border-b border-border/60 last:border-0">
                      <td className="max-w-72 truncate px-4 py-2.5 md:pl-0" title={raw}>
                        {raw || <span className="text-muted-foreground">(vazio)</span>}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">{PIPELINE_LABEL[r.pipeline_kind]}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <Input
                            aria-label={`Produto padronizado de ${raw || "vazio"}`}
                            list="produtos-list"
                            className="h-9 w-48"
                            disabled={!editable}
                            value={edits[key] ?? r.produto}
                            onChange={(e) => setEdits((prev) => ({ ...prev, [key]: e.target.value }))}
                            onBlur={() => edits[key] !== undefined && saveOverride(r.pipeline_kind, raw, edits[key], r.produto)}
                          />
                          {overridden && editable && (
                            <button type="button" className="text-xs text-muted-foreground underline underline-offset-2" onClick={() => revertOverride(r.pipeline_kind, raw)}>
                              reverter
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", GROUP_LABEL[r.grupo].className)}>{GROUP_LABEL[r.grupo].text}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatInt(r.qtd)}</td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums md:pr-0">{formatMoney(r.total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState>Sem negócios ganhos nas pipelines de Contratos e Hubla &amp; TMB.</EmptyState>
        )}
      </Panel>
    </ResultShell>
  );
}
