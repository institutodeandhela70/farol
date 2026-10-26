import { useMemo } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { EmptyState, KpiCard, LoadingBlock, Panel } from "@/components/commercial/CommercialUI";
import { axisProps, tooltipStyle } from "@/components/iuli/iuliTheme";
import { IgShell } from "@/components/meta/MetaUI";
import { formatDayBR } from "@/lib/iuliFilters";
import { useMetaFilters, ratioChange, previousPeriod } from "@/lib/metaAds";
import { dec, int, pct } from "@/lib/metaFormat";
import { TYPE_LABEL, useIgAccounts, useIgDaily, useIgFollowersNet, useIgMedia, useIgPublishCounts } from "@/lib/metaInstagram";
import { formatAxis } from "@/lib/money";

const sum = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((a, r) => a + f(r), 0);

export default function InstagramVisaoGeral() {
  const { workspace } = useWorkspace();
  const ws = workspace?.id;
  const { filters } = useMetaFilters();
  const prev = previousPeriod(filters);
  const accounts = useIgAccounts(ws);
  const account = accounts.data?.[0];
  const ig = account?.ig_user_id;

  const daily = useIgDaily(ws, ig, filters.from, filters.to);
  const prevDaily = useIgDaily(ws, ig, prev.from, prev.to);
  const net = useIgFollowersNet(ws, ig, prev.from);
  const counts = useIgPublishCounts(ws, ig, filters.from, filters.to);
  const top = useIgMedia(ws, ig, "ALL", filters.from, filters.to, "views", 6);

  const d = useMemo(() => daily.data ?? [], [daily.data]);
  const p = useMemo(() => prevDaily.data ?? [], [prevDaily.data]);

  const totals = useMemo(
    () => ({
      views: sum(d, (r) => r.views),
      reach: sum(d, (r) => r.reach),
      interactions: sum(d, (r) => r.total_interactions),
      engaged: sum(d, (r) => r.accounts_engaged),
      net: sum(d, (r) => r.follows_net),
      likes: sum(d, (r) => r.likes),
      comments: sum(d, (r) => r.comments),
      shares: sum(d, (r) => r.shares),
      saves: sum(d, (r) => r.saves),
    }),
    [d],
  );
  const prevTotals = useMemo(() => ({ views: sum(p, (r) => r.views), reach: sum(p, (r) => r.reach), interactions: sum(p, (r) => r.total_interactions), net: sum(p, (r) => r.follows_net) }), [p]);

  // Curva de seguidores: parte do número de hoje e desfaz o saldo diário de trás pra frente.
  const followersCurve = useMemo(() => {
    const current = account?.followers_count ?? null;
    if (current === null || !net.data) return [];
    const rows = net.data;
    return d.map((r) => {
      const after = rows.filter((x) => x.date > r.date).reduce((a, x) => a + x.net, 0);
      return { label: formatDayBR(r.date).slice(0, 5), seguidores: current - after, saldo: r.follows_net };
    });
  }, [d, net.data, account]);

  const chart = d.map((r) => ({ label: formatDayBR(r.date).slice(0, 5), views: r.views, reach: r.reach }));
  const interactionChart = d.map((r) => ({ label: formatDayBR(r.date).slice(0, 5), likes: r.likes, comments: r.comments, shares: r.shares, saves: r.saves }));
  const days = d.length || 1;
  const loading = daily.isLoading || accounts.isLoading;

  return (
    <IgShell
      title={account?.username ? `Instagram — @${account.username}` : "Instagram — Visão Geral"}
      description="Crescimento, alcance e engajamento do perfil, comparados ao período anterior de mesmo tamanho."
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Seguidores" value={int(account?.followers_count)} sub={`${totals.net >= 0 ? "+" : ""}${int(totals.net)} no período`} change={ratioChange(totals.net, prevTotals.net)} loading={loading} />
        <KpiCard label="Visualizações" value={int(totals.views)} change={ratioChange(totals.views, prevTotals.views)} sub={`${int(totals.views / days)} por dia`} loading={loading} />
        <KpiCard label="Alcance médio por dia" value={int(totals.reach / days)} change={ratioChange(totals.reach, prevTotals.reach)} sub="Contas únicas, média dos dias" loading={loading} />
        <KpiCard
          label="Interações"
          value={int(totals.interactions)}
          change={ratioChange(totals.interactions, prevTotals.interactions)}
          sub={totals.views > 0 ? `${pct(totals.interactions / totals.views)} das visualizações` : undefined}
          loading={loading}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Contas engajadas por dia" value={int(totals.engaged / days)} loading={loading} />
        <KpiCard label="Posts" value={int(counts.data?.FEED ?? 0)} sub="publicados no período" loading={counts.isLoading} />
        <KpiCard label="Reels" value={int(counts.data?.REELS ?? 0)} sub="publicados no período" loading={counts.isLoading} />
        <KpiCard label="Stories" value={int(counts.data?.STORY ?? 0)} sub="capturados no período" loading={counts.isLoading} />
      </div>

      <Panel title="Seguidores">
        {loading ? (
          <LoadingBlock />
        ) : followersCurve.length === 0 ? (
          <EmptyState>Sem dados de seguidores neste período.</EmptyState>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={followersCurve} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" {...axisProps} />
                <YAxis {...axisProps} width={64} domain={["auto", "auto"]} tickFormatter={formatAxis} />
                <Tooltip formatter={(v: number, name: string) => [int(v), name === "seguidores" ? "Seguidores" : "Saldo do dia"]} {...tooltipStyle} />
                <Line type="monotone" dataKey="seguidores" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        <p className="text-xs text-muted-foreground">Curva reconstruída a partir do número atual de seguidores e do saldo diário (começaram a seguir menos deixaram de seguir).</p>
      </Panel>

      <Panel title="Visualizações e alcance por dia">
        {loading ? (
          <LoadingBlock />
        ) : chart.length === 0 ? (
          <EmptyState>Sem métricas diárias neste período. A carga do histórico pode estar em andamento.</EmptyState>
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" {...axisProps} />
                <YAxis {...axisProps} width={64} tickFormatter={formatAxis} />
                <Tooltip formatter={(v: number, name: string) => [int(v), name]} {...tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
                <Bar dataKey="views" name="Visualizações" fill="hsl(var(--primary))" maxBarSize={40} radius={[6, 6, 0, 0]} />
                <Line type="monotone" dataKey="reach" name="Alcance" stroke="hsl(38 92% 50%)" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>

      <Panel title="Interações por dia">
        {interactionChart.length === 0 ? (
          <EmptyState>Sem dados neste período.</EmptyState>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={interactionChart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" {...axisProps} />
                <YAxis {...axisProps} width={64} tickFormatter={formatAxis} />
                <Tooltip formatter={(v: number, name: string) => [int(v), name]} {...tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
                <Bar dataKey="likes" name="Curtidas" stackId="i" fill="hsl(var(--primary))" maxBarSize={40} />
                <Bar dataKey="comments" name="Comentários" stackId="i" fill="hsl(199 89% 48%)" maxBarSize={40} />
                <Bar dataKey="shares" name="Compartilhamentos" stackId="i" fill="hsl(38 92% 50%)" maxBarSize={40} />
                <Bar dataKey="saves" name="Salvamentos" stackId="i" fill="hsl(280 60% 60%)" maxBarSize={40} radius={[6, 6, 0, 0]} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>

      <Panel title="Conteúdos mais vistos no período">
        {top.isLoading ? (
          <LoadingBlock />
        ) : (top.data ?? []).length === 0 ? (
          <EmptyState>Nenhum conteúdo com métricas neste período.</EmptyState>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {(top.data ?? []).map((m) => (
              <li key={m.media_id} className="flex gap-3 rounded-lg border border-border p-3">
                {m.thumbnail_url ?? m.media_url ? (
                  <img src={(m.thumbnail_url ?? m.media_url)!} alt="" loading="lazy" className="size-20 shrink-0 rounded-md border border-border object-cover" />
                ) : (
                  <div className="size-20 shrink-0 rounded-md border border-border bg-muted" />
                )}
                <div className="min-w-0 text-sm">
                  <p className="text-xs text-muted-foreground">
                    {TYPE_LABEL[m.product_type ?? ""] ?? m.product_type} · {m.posted_at ? new Date(m.posted_at).toLocaleDateString("pt-BR") : ""}
                  </p>
                  <p className="line-clamp-2">{m.caption ?? "(sem legenda)"}</p>
                  <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                    {int(m.views)} views · {int(m.reach)} alcance · {int(m.total_interactions)} interações
                    {m.reach && m.total_interactions != null ? ` · ${dec((m.total_interactions / m.reach) * 100, 1)}%` : ""}
                  </p>
                  {m.permalink && (
                    <a href={m.permalink} target="_blank" rel="noreferrer" className="text-xs font-medium text-primary hover:underline">
                      Abrir no Instagram
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <p className="text-xs text-muted-foreground">
        Os dias seguem o fuso do Instagram (meia-noite do Pacífico). Alcance diário é de contas únicas por dia, por isso aparece como média e não como soma.
        Dados dos últimos 2 dias podem ser ajustados pela Meta.
      </p>
    </IgShell>
  );
}
