import { useMemo, useState } from "react";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { EmptyState, LoadingBlock, Panel } from "@/components/commercial/CommercialUI";
import { ClickBarList } from "@/components/result/ResultCharts";
import { MetaShell } from "@/components/meta/MetaUI";
import { brl, dec, int, pct } from "@/lib/metaFormat";
import { Input } from "@/components/ui/input";
import {
  derive,
  GENDER_LABEL,
  PLATFORM_LABEL,
  POSITION_LABEL,
  useMetaActions,
  useMetaBreakdown,
  useMetaFilters,
  type BreakdownKind,
  type BreakdownRow,
} from "@/lib/metaAds";
import { cn } from "@/lib/utils";

const TABS: { id: BreakdownKind; label: string; first: string; second: string | null }[] = [
  { id: "placement", label: "Plataforma e posicionamento", first: "Plataforma", second: "Posicionamento" },
  { id: "age_gender", label: "Idade e gênero", first: "Idade", second: "Gênero" },
  { id: "region", label: "Região", first: "Região", second: null },
];

function labelOf(kind: BreakdownKind, r: BreakdownRow): string {
  if (kind === "placement") return `${PLATFORM_LABEL[r.key1] ?? r.key1} · ${POSITION_LABEL[r.key2] ?? r.key2}`;
  if (kind === "age_gender") return `${r.key1} · ${GENDER_LABEL[r.key2] ?? r.key2}`;
  return r.key1 || "Desconhecida";
}

export default function MetaAdsPublico() {
  const { workspace } = useWorkspace();
  const { filters, accounts } = useMetaFilters();
  const [tab, setTab] = useState<BreakdownKind>("placement");
  const [actionSearch, setActionSearch] = useState("");

  const breakdown = useMetaBreakdown(workspace?.id, filters.from, filters.to, accounts, tab);
  const actions = useMetaActions(workspace?.id, filters.from, filters.to, accounts);

  const rows = useMemo(() => breakdown.data ?? [], [breakdown.data]);
  const totalSpend = useMemo(() => rows.reduce((a, r) => a + r.spend, 0), [rows]);
  const top = rows.slice(0, 12);
  const current = TABS.find((t) => t.id === tab)!;

  const filteredActions = useMemo(() => {
    const q = actionSearch.trim().toLowerCase();
    return (actions.data ?? []).filter((a) => !q || a.action_type.toLowerCase().includes(q));
  }, [actions.data, actionSearch]);

  return (
    <MetaShell title="Meta Ads — Público & Ações" description="Onde o investimento rendeu: por posicionamento, idade, gênero e região. E todas as ações que a Meta registrou.">
      <Panel title="Quebra do investimento">
        <div role="tablist" className="inline-flex flex-wrap gap-1 self-start rounded-lg border border-border bg-card p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn("h-9 rounded-md px-3.5 text-sm font-medium", tab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground")}
            >
              {t.label}
            </button>
          ))}
        </div>

        {breakdown.isLoading ? (
          <LoadingBlock />
        ) : rows.length === 0 ? (
          <EmptyState>Sem dados neste período.</EmptyState>
        ) : (
          <>
            <ClickBarList
              items={top.map((r) => ({
                key: `${r.key1}|${r.key2}`,
                label: labelOf(tab, r),
                value: r.spend,
                display: `${brl(r.spend)} · ${pct(totalSpend > 0 ? r.spend / totalSpend : null, 1)}`,
                sub: `${int(r.leads)} leads${derive(r).cpl != null ? ` · CPL ${brl(derive(r).cpl)}` : ""}${r.purchases > 0 ? ` · ${int(r.purchases)} compras` : ""}`,
              }))}
            />

            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[48rem] text-sm">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">{current.first}</th>
                    {current.second && <th className="px-3 py-2 font-medium">{current.second}</th>}
                    {["Investimento", "Impressões", "Cliques link", "CTR", "Leads", "CPL", "Compras", "CPA", "ROAS"].map((h) => (
                      <th key={h} className="px-3 py-2 text-right font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const d = derive(r);
                    return (
                      <tr key={`${r.key1}|${r.key2}`} className="border-t border-border">
                        <td className="px-3 py-2">{tab === "placement" ? PLATFORM_LABEL[r.key1] ?? r.key1 : r.key1 || "—"}</td>
                        {current.second && (
                          <td className="px-3 py-2">{tab === "placement" ? POSITION_LABEL[r.key2] ?? r.key2 : GENDER_LABEL[r.key2] ?? r.key2}</td>
                        )}
                        <td className="px-3 py-2 text-right tabular-nums">{brl(r.spend)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{int(r.impressions)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{int(r.link_clicks)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{pct(d.ctr)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{int(r.leads)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{brl(d.cpl)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{int(r.purchases)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{brl(d.cpa)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{d.roas != null ? `${dec(d.roas)}x` : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>

      <Panel title="Todas as ações registradas pela Meta">
        <p className="text-sm text-muted-foreground">
          A Meta registra a mesma conversão sob vários nomes (por exemplo, "lead", "onsite_web_lead" e "offsite_conversion.fb_pixel_lead" têm o mesmo número). Não some as linhas entre si.
          Conversões personalizadas aparecem como "offsite_conversion.custom.ID".
        </p>
        <Input placeholder="Filtrar por tipo de ação" value={actionSearch} onChange={(e) => setActionSearch(e.target.value)} className="h-10 max-w-xs" />
        {actions.isLoading ? (
          <LoadingBlock />
        ) : filteredActions.length === 0 ? (
          <EmptyState>Nenhuma ação encontrada.</EmptyState>
        ) : (
          <div className="max-h-[32rem] overflow-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted text-left text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Tipo de ação</th>
                  <th className="px-3 py-2 text-right font-medium">Quantidade</th>
                  <th className="px-3 py-2 text-right font-medium">Valor</th>
                </tr>
              </thead>
              <tbody>
                {filteredActions.map((a) => (
                  <tr key={a.action_type} className="border-t border-border">
                    <td className="px-3 py-2 font-mono text-xs">{a.action_type}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{int(a.qty)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{a.value > 0 ? brl(a.value) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </MetaShell>
  );
}
