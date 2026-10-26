import { useMemo, useState } from "react";
import { Download, ExternalLink } from "lucide-react";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { EmptyState, LoadingBlock, Panel } from "@/components/commercial/CommercialUI";
import { IgShell } from "@/components/meta/MetaUI";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMetaFilters } from "@/lib/metaAds";
import { dec, int, pct } from "@/lib/metaFormat";
import { MEDIA_TYPE_LABEL, useIgAccounts, useIgMedia, type IgContentType, type IgMedia } from "@/lib/metaInstagram";
import { cn } from "@/lib/utils";

const TABS: { id: IgContentType; label: string }[] = [
  { id: "FEED", label: "Posts" },
  { id: "REELS", label: "Reels" },
  { id: "STORY", label: "Stories" },
];

const SORTS: { key: string; label: string }[] = [
  { key: "posted_at", label: "Mais recentes" },
  { key: "views", label: "Visualizações" },
  { key: "reach", label: "Alcance" },
  { key: "total_interactions", label: "Interações" },
  { key: "likes", label: "Curtidas" },
  { key: "comments", label: "Comentários" },
  { key: "shares", label: "Compartilhamentos" },
  { key: "saved", label: "Salvamentos" },
];

const engagement = (m: IgMedia) => (m.reach && m.total_interactions != null ? m.total_interactions / m.reach : null);
const nav = (m: IgMedia, k: string) => m.story_navigation?.[k] ?? null;

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

export default function InstagramConteudo() {
  const { workspace } = useWorkspace();
  const ws = workspace?.id;
  const { filters } = useMetaFilters();
  const accounts = useIgAccounts(ws);
  const ig = accounts.data?.[0]?.ig_user_id;
  const [tab, setTab] = useState<IgContentType>("FEED");
  const [sort, setSort] = useState("posted_at");
  const [search, setSearch] = useState("");

  const media = useIgMedia(ws, ig, tab, filters.from, filters.to, sort, 400);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (media.data ?? []).filter((m) => !q || (m.caption ?? "").toLowerCase().includes(q));
  }, [media.data, search]);

  const totals = useMemo(() => {
    const withIns = rows.filter((m) => m.insights_synced_at && !m.insights_error);
    const sum = (f: (m: IgMedia) => number | null) => withIns.reduce((a, m) => a + (f(m) ?? 0), 0);
    return { n: rows.length, views: sum((m) => m.views), reach: sum((m) => m.reach), interactions: sum((m) => m.total_interactions), withIns: withIns.length };
  }, [rows]);

  const isStory = tab === "STORY";
  const isReel = tab === "REELS";

  const exportCsv = () => {
    const head = ["Data", "Tipo", "Formato", "Legenda", "Link", "Visualizações", "Alcance", "Curtidas", "Comentários", "Compartilhamentos", "Salvamentos", "Interações", "Engajamento"];
    const body = rows.map((m) => [
      m.posted_at ?? "", tab, MEDIA_TYPE_LABEL[m.media_type ?? ""] ?? m.media_type ?? "", (m.caption ?? "").replaceAll("\n", " "), m.permalink ?? "",
      m.views ?? "", m.reach ?? "", m.likes ?? m.like_count, m.comments ?? m.comments_count, m.shares ?? "", m.saved ?? "", m.total_interactions ?? "", engagement(m) ?? "",
    ]);
    downloadCsv(`instagram-${tab.toLowerCase()}-${filters.from}-${filters.to}.csv`, [head, ...body]);
  };

  return (
    <IgShell title="Instagram — Conteúdo" description="Desempenho de cada post, reel e story publicado no período.">
      <Panel
        title="Conteúdo"
        action={
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length}>
            <Download className="mr-1.5 size-4" />
            Exportar CSV
          </Button>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" className="inline-flex gap-1 rounded-lg border border-border bg-card p-1">
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
          <select aria-label="Ordenar por" value={sort} onChange={(e) => setSort(e.target.value)} className="h-10 rounded-md border border-input bg-card px-3 text-sm font-medium">
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          <Input placeholder="Buscar na legenda" value={search} onChange={(e) => setSearch(e.target.value)} className="h-10 max-w-xs" />
        </div>

        <p className="text-sm text-muted-foreground">
          {int(totals.n)} publicações · {int(totals.views)} visualizações · {int(totals.interactions)} interações
          {totals.reach > 0 && totals.interactions > 0 ? ` · engajamento médio ${pct(totals.interactions / totals.reach)} do alcance` : ""}
          {totals.withIns < totals.n ? ` · ${int(totals.n - totals.withIns)} ainda sem métricas` : ""}
        </p>

        {media.isLoading ? (
          <LoadingBlock />
        ) : rows.length === 0 ? (
          <EmptyState>{isStory ? "Nenhum story capturado neste período (os stories só existem na API por 24h)." : "Nada publicado neste período."}</EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[60rem] text-sm">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Conteúdo</th>
                  <th className="px-3 py-2 text-right font-medium">Views</th>
                  <th className="px-3 py-2 text-right font-medium">Alcance</th>
                  {isStory ? (
                    <>
                      <th className="px-3 py-2 text-right font-medium">Respostas</th>
                      <th className="px-3 py-2 text-right font-medium">Compart.</th>
                      <th className="px-3 py-2 text-right font-medium">Avançou</th>
                      <th className="px-3 py-2 text-right font-medium">Voltou</th>
                      <th className="px-3 py-2 text-right font-medium">Saiu</th>
                    </>
                  ) : (
                    <>
                      <th className="px-3 py-2 text-right font-medium">Curtidas</th>
                      <th className="px-3 py-2 text-right font-medium">Coment.</th>
                      <th className="px-3 py-2 text-right font-medium">Compart.</th>
                      <th className="px-3 py-2 text-right font-medium">Salvos</th>
                    </>
                  )}
                  <th className="px-3 py-2 text-right font-medium">Interações</th>
                  <th className="px-3 py-2 text-right font-medium">Engaj.</th>
                  {isReel && <th className="px-3 py-2 text-right font-medium">Tempo médio</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => {
                  const pending = !m.insights_synced_at;
                  return (
                    <tr key={m.media_id} className="border-t border-border">
                      <td className="max-w-[26rem] px-3 py-2">
                        <div className="flex items-center gap-3">
                          {m.thumbnail_url ?? m.media_url ? (
                            <img src={(m.thumbnail_url ?? m.media_url)!} alt="" loading="lazy" className="size-14 shrink-0 rounded-md border border-border object-cover" />
                          ) : (
                            <div className="size-14 shrink-0 rounded-md border border-border bg-muted" />
                          )}
                          <div className="min-w-0">
                            <p className="line-clamp-2" title={m.caption ?? ""}>{m.caption ?? "(sem legenda)"}</p>
                            <p className="text-xs text-muted-foreground">
                              {m.posted_at ? new Date(m.posted_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : ""} · {MEDIA_TYPE_LABEL[m.media_type ?? ""] ?? m.media_type}
                              {m.expired_at ? " · expirado" : ""}
                              {m.permalink && (
                                <a href={m.permalink} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-0.5 font-medium text-primary hover:underline">
                                  abrir <ExternalLink className="size-3" />
                                </a>
                              )}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{pending ? "—" : int(m.views)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{pending ? "—" : int(m.reach)}</td>
                      {isStory ? (
                        <>
                          <td className="px-3 py-2 text-right tabular-nums">{int(m.replies)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{int(m.shares)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{int((nav(m, "TAP_FORWARD") ?? 0) + (nav(m, "SWIPE_FORWARD") ?? 0))}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{int(nav(m, "TAP_BACK"))}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{int(nav(m, "TAP_EXIT"))}</td>
                        </>
                      ) : (
                        <>
                          <td className="px-3 py-2 text-right tabular-nums">{int(m.likes ?? m.like_count)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{int(m.comments ?? m.comments_count)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{pending ? "—" : int(m.shares)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{pending ? "—" : int(m.saved)}</td>
                        </>
                      )}
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{pending ? "—" : int(m.total_interactions)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{pct(engagement(m))}</td>
                      {isReel && <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{m.avg_watch_time_ms != null ? `${dec(m.avg_watch_time_ms / 1000, 1)} s` : "—"}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {(media.data ?? []).length >= 400 && <p className="text-xs text-muted-foreground">Mostrando até 400 itens; reduza o período ou exporte o CSV.</p>}
        <p className="text-xs text-muted-foreground">
          Engajamento = interações ÷ alcance. Métricas de posts recentes atualizam várias vezes ao dia; as de posts antigos, a cada poucas semanas. Stories são capturados enquanto estão no ar (24h).
        </p>
      </Panel>
    </IgShell>
  );
}
