import { useMemo, useState } from "react";
import { ChevronRight, Download } from "lucide-react";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { EmptyState, LoadingBlock, Panel } from "@/components/commercial/CommercialUI";
import { MetaShell } from "@/components/meta/MetaUI";
import { brl, dec, int, pct } from "@/lib/metaFormat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { derive, OBJECTIVE_LABEL, STATUS_LABEL, useMetaFilters, useMetaRanking, type RankingLevel, type RankingRow } from "@/lib/metaAds";
import { cn } from "@/lib/utils";

// Campanhas → Conjuntos → Anúncios: clicar numa linha abre o nível de baixo (com os mesmos filtros de período e conta).

const LEVEL_LABEL: Record<RankingLevel, string> = { campaign: "Campanhas", adset: "Conjuntos", ad: "Anúncios" };
const NEXT: Record<RankingLevel, RankingLevel | null> = { campaign: "adset", adset: "ad", ad: null };

type SortKey = "spend" | "impressions" | "link_clicks" | "ctr" | "cpm" | "leads" | "cpl" | "purchases" | "cpa" | "purchase_value" | "roas";

interface Crumb {
  level: RankingLevel;
  id: string;
  name: string;
}

const COLUMNS: { key: SortKey; label: string; render: (r: RankingRow, d: ReturnType<typeof derive>) => string; csv: (r: RankingRow, d: ReturnType<typeof derive>) => number | string }[] = [
  { key: "spend", label: "Investimento", render: (r) => brl(r.spend), csv: (r) => r.spend },
  { key: "impressions", label: "Impressões", render: (r) => int(r.impressions), csv: (r) => r.impressions },
  { key: "link_clicks", label: "Cliques link", render: (r) => int(r.link_clicks), csv: (r) => r.link_clicks },
  { key: "ctr", label: "CTR", render: (_, d) => pct(d.ctr), csv: (_, d) => d.ctr ?? "" },
  { key: "cpm", label: "CPM", render: (_, d) => brl(d.cpm), csv: (_, d) => d.cpm ?? "" },
  { key: "leads", label: "Leads", render: (r) => int(r.leads), csv: (r) => r.leads },
  { key: "cpl", label: "CPL", render: (_, d) => brl(d.cpl), csv: (_, d) => d.cpl ?? "" },
  { key: "purchases", label: "Compras", render: (r) => int(r.purchases), csv: (r) => r.purchases },
  { key: "cpa", label: "CPA", render: (_, d) => brl(d.cpa), csv: (_, d) => d.cpa ?? "" },
  { key: "purchase_value", label: "Valor compras", render: (r) => brl(r.purchase_value), csv: (r) => r.purchase_value },
  { key: "roas", label: "ROAS", render: (_, d) => (d.roas != null ? `${dec(d.roas)}x` : "—"), csv: (_, d) => d.roas ?? "" },
];

function sortValue(r: RankingRow, key: SortKey): number {
  const d = derive(r);
  switch (key) {
    case "ctr": return d.ctr ?? -1;
    case "cpm": return d.cpm ?? -1;
    case "cpl": return d.cpl ?? -1;
    case "cpa": return d.cpa ?? -1;
    case "roas": return d.roas ?? -1;
    default: return r[key];
  }
}

function downloadCsv(filename: string, rows: (string | number)[][]) {
  const body = rows.map((r) => r.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(";")).join("\n");
  const blob = new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function MetaAdsCampanhas() {
  const { workspace } = useWorkspace();
  const { filters, accounts } = useMetaFilters();
  const [trail, setTrail] = useState<Crumb[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"todas" | "ACTIVE" | "PAUSED">("todas");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "spend", dir: "desc" });

  const level: RankingLevel = trail.length === 0 ? "campaign" : trail.length === 1 ? "adset" : "ad";
  const parent = trail.length ? trail[trail.length - 1].id : null;
  const ranking = useMetaRanking(workspace?.id, filters.from, filters.to, accounts, level, parent);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = (ranking.data ?? []).filter((r) => {
      if (status !== "todas" && r.status !== status) return false;
      if (!q) return true;
      return `${r.name ?? ""} ${r.parent_name ?? ""} ${r.item_id}`.toLowerCase().includes(q);
    });
    const m = sort.dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => (sortValue(a, sort.key) - sortValue(b, sort.key)) * m);
  }, [ranking.data, search, status, sort]);

  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));

  const open = (r: RankingRow) => {
    const next = NEXT[level];
    if (!next) return;
    setTrail([...trail, { level, id: r.item_id, name: r.name ?? r.item_id }]);
    setSearch("");
  };

  const exportCsv = () => {
    const head = ["Nome", "Status", "Conta", ...COLUMNS.map((c) => c.label)];
    const body = rows.map((r) => {
      const d = derive(r);
      return [r.name ?? r.item_id, STATUS_LABEL[r.status ?? ""] ?? r.status ?? "", r.account_name ?? "", ...COLUMNS.map((c) => c.csv(r, d))];
    });
    downloadCsv(`meta-ads-${LEVEL_LABEL[level].toLowerCase()}-${filters.from}-${filters.to}.csv`, [head, ...body]);
  };

  const totals = useMemo(() => {
    const t = rows.reduce(
      (a, r) => ({ spend: a.spend + r.spend, impressions: a.impressions + r.impressions, link_clicks: a.link_clicks + r.link_clicks, leads: a.leads + r.leads, purchases: a.purchases + r.purchases, purchase_value: a.purchase_value + r.purchase_value, conversations: a.conversations + r.conversations }),
      { spend: 0, impressions: 0, link_clicks: 0, leads: 0, purchases: 0, purchase_value: 0, conversations: 0 },
    );
    return { t, d: derive(t) };
  }, [rows]);

  return (
    <MetaShell title="Meta Ads — Campanhas" description="Desempenho por campanha, conjunto e anúncio. Clique numa linha para ver o nível seguinte.">
      <Panel
        title={LEVEL_LABEL[level]}
        action={
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length}>
            <Download className="mr-1.5 size-4" />
            Exportar CSV
          </Button>
        }
      >
        <nav aria-label="Navegação" className="flex flex-wrap items-center gap-1 text-sm">
          <button type="button" className={cn("rounded px-1.5 py-0.5 hover:bg-accent", trail.length === 0 ? "font-semibold" : "text-primary")} onClick={() => setTrail([])}>
            Campanhas
          </button>
          {trail.map((c, i) => (
            <span key={c.id} className="flex items-center gap-1">
              <ChevronRight className="size-4 text-muted-foreground" />
              <button type="button" className={cn("max-w-[24rem] truncate rounded px-1.5 py-0.5 hover:bg-accent", i === trail.length - 1 ? "font-semibold" : "text-primary")} onClick={() => setTrail(trail.slice(0, i + 1))}>
                {c.name}
              </button>
            </span>
          ))}
        </nav>

        <div className="flex flex-wrap items-center gap-2">
          <Input placeholder="Buscar por nome ou ID" value={search} onChange={(e) => setSearch(e.target.value)} className="h-10 max-w-xs" />
          <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="h-10 rounded-md border border-input bg-card px-3 text-sm font-medium">
            <option value="todas">Todos os status</option>
            <option value="ACTIVE">Somente ativas</option>
            <option value="PAUSED">Somente pausadas</option>
          </select>
          <span className="text-sm text-muted-foreground">{rows.length.toLocaleString("pt-BR")} {LEVEL_LABEL[level].toLowerCase()} com gasto no período</span>
        </div>

        {ranking.isLoading ? (
          <LoadingBlock />
        ) : rows.length === 0 ? (
          <EmptyState>Nada encontrado neste período.</EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[68rem] text-sm">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">{LEVEL_LABEL[level].slice(0, -1)}</th>
                  {COLUMNS.map((c) => (
                    <th key={c.key} className="px-3 py-2 text-right font-medium">
                      <button type="button" onClick={() => toggleSort(c.key)} className={cn("whitespace-nowrap hover:text-foreground", sort.key === c.key && "text-foreground")}>
                        {c.label}
                        {sort.key === c.key ? (sort.dir === "desc" ? " ↓" : " ↑") : ""}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 500).map((r) => {
                  const d = derive(r);
                  const clickable = !!NEXT[level];
                  return (
                    <tr
                      key={r.item_id}
                      onClick={clickable ? () => open(r) : undefined}
                      className={cn("border-t border-border", clickable && "cursor-pointer hover:bg-accent/50")}
                    >
                      <td className="max-w-[28rem] px-3 py-2">
                        <div className="flex items-center gap-3">
                          {level === "ad" && (
                            r.thumbnail ? (
                              <img src={r.thumbnail} alt="" loading="lazy" className="size-12 shrink-0 rounded-md border border-border object-cover" />
                            ) : (
                              <div className="size-12 shrink-0 rounded-md border border-border bg-muted" />
                            )
                          )}
                          <div className="min-w-0">
                            <p className="truncate font-medium" title={r.name ?? ""}>{r.name ?? r.item_id}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {[STATUS_LABEL[r.status ?? ""] ?? r.status, r.objective ? OBJECTIVE_LABEL[r.objective] ?? r.objective : null, level !== "campaign" ? r.parent_name : null, r.account_name]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          </div>
                        </div>
                      </td>
                      {COLUMNS.map((c) => (
                        <td key={c.key} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                          {c.render(r, d)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t-2 border-border bg-muted/30 font-semibold">
                <tr>
                  <td className="px-3 py-2">Total ({rows.length.toLocaleString("pt-BR")})</td>
                  {COLUMNS.map((c) => (
                    <td key={c.key} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      {c.render({ ...totals.t, item_id: "", name: null, status: null, parent_name: null, objective: null, account_id: null, account_name: null, thumbnail: null, first_day: null, last_day: null }, totals.d)}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {rows.length > 500 && <p className="text-xs text-muted-foreground">Mostrando as 500 primeiras linhas; use a busca ou exporte o CSV para ver tudo.</p>}
      </Panel>
    </MetaShell>
  );
}
