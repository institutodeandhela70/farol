import { useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { EmptyState, KpiCard, LoadingBlock, Panel } from "@/components/commercial/CommercialUI";
import { ClickBarList } from "@/components/result/ResultCharts";
import { axisProps, tooltipStyle } from "@/components/iuli/iuliTheme";
import { MetaShell } from "@/components/meta/MetaUI";
import { brl, dec, int, pct } from "@/lib/metaFormat";
import { derive, previousPeriod, ratioChange, useMetaDaily, useMetaFilters, useMetaRanking, useMetaTotals, OBJECTIVE_LABEL } from "@/lib/metaAds";
import { formatAxis } from "@/lib/money";
import { formatDayBR } from "@/lib/iuliFilters";

export default function MetaAdsVisaoGeral() {
  const { workspace } = useWorkspace();
  const ws = workspace?.id;
  const location = useLocation();
  const { filters, accounts } = useMetaFilters();
  const prev = previousPeriod(filters);

  const totals = useMetaTotals(ws, filters.from, filters.to, accounts);
  const prevTotals = useMetaTotals(ws, prev.from, prev.to, accounts);
  const daily = useMetaDaily(ws, filters.from, filters.to, accounts);
  const campaigns = useMetaRanking(ws, filters.from, filters.to, accounts, "campaign", null);

  const t = totals.data;
  const p = prevTotals.data;
  const d = t ? derive(t) : null;
  const dp = p ? derive(p) : null;
  const loading = totals.isLoading;

  const chart = useMemo(
    () => (daily.data ?? []).map((r) => ({ label: formatDayBR(r.day).slice(0, 5), spend: r.spend, leads: r.leads, purchases: r.purchases })),
    [daily.data],
  );

  const top = (campaigns.data ?? []).slice(0, 8);
  const campaignsLink = { pathname: "/marketing/meta-ads-campanhas", search: location.search };

  const costSub = (before: number | null | undefined) => (before !== null && before !== undefined ? `Anterior: ${brl(before)}` : undefined);

  return (
    <MetaShell title="Meta Ads — Visão Geral" description="Investimento e resultados das campanhas no período, comparados ao período anterior de mesmo tamanho.">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Investimento" value={brl(t?.spend)} change={ratioChange(t?.spend ?? null, p?.spend ?? null)} sub={t ? `${int(t.ads_count)} anúncios com gasto` : undefined} loading={loading} />
        <KpiCard label="Leads" value={int(t?.leads)} change={ratioChange(t?.leads ?? null, p?.leads ?? null)} sub={d?.cpl != null ? `CPL ${brl(d.cpl)}` : undefined} loading={loading} />
        <KpiCard label="Compras" value={int(t?.purchases)} change={ratioChange(t?.purchases ?? null, p?.purchases ?? null)} sub={d?.cpa != null ? `CPA ${brl(d.cpa)}` : undefined} loading={loading} />
        <KpiCard
          label="Valor de compras"
          value={brl(t?.purchase_value)}
          change={ratioChange(t?.purchase_value ?? null, p?.purchase_value ?? null)}
          sub={d?.roas != null ? `ROAS ${dec(d.roas)}x` : undefined}
          loading={loading}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Impressões" value={int(t?.impressions)} change={ratioChange(t?.impressions ?? null, p?.impressions ?? null)} loading={loading} />
        <KpiCard label="Cliques no link" value={int(t?.link_clicks)} change={ratioChange(t?.link_clicks ?? null, p?.link_clicks ?? null)} sub={d?.ctr != null ? `CTR ${pct(d.ctr)}` : undefined} loading={loading} />
        <KpiCard label="CPM" value={brl(d?.cpm)} sub={costSub(dp?.cpm)} loading={loading} />
        <KpiCard label="CPC (link)" value={brl(d?.cpc)} sub={costSub(dp?.cpc)} loading={loading} />
      </div>

      <Panel title="Investimento e resultados por dia">
        {daily.isLoading ? (
          <LoadingBlock />
        ) : chart.length === 0 ? (
          <EmptyState>Sem dados de anúncios neste período.</EmptyState>
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" {...axisProps} />
                <YAxis yAxisId="left" {...axisProps} width={64} tickFormatter={formatAxis} />
                <YAxis yAxisId="right" orientation="right" {...axisProps} width={48} />
                <Tooltip formatter={(v: number, name: string) => [name === "Investimento" ? brl(v) : int(v), name]} {...tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
                <Bar yAxisId="left" dataKey="spend" name="Investimento" fill="hsl(var(--primary))" maxBarSize={40} radius={[6, 6, 0, 0]} />
                <Line yAxisId="right" type="monotone" dataKey="leads" name="Leads" stroke="hsl(38 92% 50%)" strokeWidth={2} dot={false} />
                <Line yAxisId="right" type="monotone" dataKey="purchases" name="Compras" stroke="hsl(199 89% 48%)" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>

      <Panel
        title="Campanhas que mais investiram"
        action={
          <Link to={campaignsLink} className="text-sm font-medium text-primary hover:underline">
            Ver todas
          </Link>
        }
      >
        {campaigns.isLoading ? (
          <LoadingBlock />
        ) : top.length === 0 ? (
          <EmptyState>Nenhuma campanha com gasto neste período.</EmptyState>
        ) : (
          <ClickBarList
            items={top.map((c) => ({
              key: c.item_id,
              label: c.name ?? c.item_id,
              value: c.spend,
              display: brl(c.spend),
              sub: [
                c.objective ? OBJECTIVE_LABEL[c.objective] ?? c.objective : null,
                `${int(c.leads)} leads`,
                c.purchases > 0 ? `${int(c.purchases)} compras` : null,
                c.spend > 0 && c.purchase_value > 0 ? `ROAS ${dec(c.purchase_value / c.spend)}x` : null,
              ]
                .filter(Boolean)
                .join(" · "),
            }))}
          />
        )}
      </Panel>

      <p className="text-xs text-muted-foreground">
        Leads = conversão "lead" da Meta; compras = "purchase". A Meta repete a mesma conversão sob vários nomes, então só um tipo por resultado é contado.
        Alcance não é somado porque não é aditivo entre dias e anúncios. As datas seguem o fuso de cada conta de anúncio.
      </p>
    </MetaShell>
  );
}
