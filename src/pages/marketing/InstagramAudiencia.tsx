import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { EmptyState, LoadingBlock, Panel } from "@/components/commercial/CommercialUI";
import { ClickBarList } from "@/components/result/ResultCharts";
import { IgShell } from "@/components/meta/MetaUI";
import { Input } from "@/components/ui/input";
import { int, pct } from "@/lib/metaFormat";
import { GENDER_LABEL, useIgAccounts, useIgAudience, useIgComments, type AudienceRow } from "@/lib/metaInstagram";

const BREAKDOWNS: { id: AudienceRow["breakdown"]; label: string; limit: number }[] = [
  { id: "gender", label: "Gênero", limit: 5 },
  { id: "age", label: "Faixa etária", limit: 10 },
  { id: "country", label: "Países", limit: 10 },
  { id: "city", label: "Cidades", limit: 15 },
];

function Block({ rows, breakdown, limit }: { rows: AudienceRow[]; breakdown: AudienceRow["breakdown"]; limit: number }) {
  const list = rows.filter((r) => r.breakdown === breakdown).sort((a, b) => b.value - a.value);
  const total = list.reduce((a, r) => a + r.value, 0);
  if (!list.length) return <EmptyState>Sem dados.</EmptyState>;
  return (
    <ClickBarList
      items={list.slice(0, limit).map((r) => ({
        key: r.key,
        label: breakdown === "gender" ? GENDER_LABEL[r.key] ?? r.key : r.key,
        value: r.value,
        display: `${int(r.value)} · ${pct(total > 0 ? r.value / total : null, 1)}`,
      }))}
    />
  );
}

export default function InstagramAudiencia() {
  const { workspace } = useWorkspace();
  const ws = workspace?.id;
  const accounts = useIgAccounts(ws);
  const ig = accounts.data?.[0]?.ig_user_id;
  const audience = useIgAudience(ws, ig);
  const [who, setWho] = useState<"follower" | "engaged">("follower");
  const [search, setSearch] = useState("");
  const [onlyTop, setOnlyTop] = useState(false);
  const comments = useIgComments(ws, ig, search, onlyTop);

  const rows = useMemo(() => (audience.data?.rows ?? []).filter((r) => r.metric === who), [audience.data, who]);
  const hasEngaged = (audience.data?.rows ?? []).some((r) => r.metric === "engaged");

  return (
    <IgShell title="Instagram — Audiência & Comentários" description="Quem segue e quem engaja com o perfil, e os comentários recebidos nos posts.">
      <Panel
        title="Audiência"
        action={audience.data?.date ? <span className="text-xs text-muted-foreground">Foto de {new Date(`${audience.data.date}T12:00:00`).toLocaleDateString("pt-BR")}</span> : undefined}
      >
        <div role="tablist" className="inline-flex gap-1 self-start rounded-lg border border-border bg-card p-1">
          {([["follower", "Seguidores"], ["engaged", "Quem engaja"]] as const).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={who === id}
              type="button"
              onClick={() => setWho(id)}
              className={`h-9 rounded-md px-3.5 text-sm font-medium ${who === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {audience.isLoading ? (
          <LoadingBlock />
        ) : !audience.data?.date ? (
          <EmptyState>A demografia ainda não foi carregada. Ela entra na primeira sincronização do Instagram.</EmptyState>
        ) : who === "engaged" && !hasEngaged ? (
          <EmptyState>A Meta não devolveu a audiência engajada (exige 100+ interações no período).</EmptyState>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            {BREAKDOWNS.map((b) => (
              <div key={b.id} className="min-w-0">
                <h3 className="mb-2 text-sm font-semibold">{b.label}</h3>
                <Block rows={rows} breakdown={b.id} limit={b.limit} />
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">A Meta devolve só os principais grupos de cada quebra, então a soma pode ficar abaixo do total de seguidores. Janela dos últimos 30 dias.</p>
      </Panel>

      <Panel title="Comentários recentes" action={<span className="text-xs text-muted-foreground">{comments.data ? `${int(comments.data.total)} no total` : ""}</span>}>
        <div className="flex flex-wrap items-center gap-3">
          <Input placeholder="Buscar no texto" value={search} onChange={(e) => setSearch(e.target.value)} className="h-10 max-w-xs" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={onlyTop} onChange={(e) => setOnlyTop(e.target.checked)} />
            Só comentários (sem respostas)
          </label>
        </div>
        {comments.isLoading ? (
          <LoadingBlock />
        ) : (comments.data?.rows ?? []).length === 0 ? (
          <EmptyState>Nenhum comentário carregado ainda.</EmptyState>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {(comments.data?.rows ?? []).map((c) => (
              <li key={c.comment_id} className="flex flex-col gap-1 px-3 py-2.5 text-sm">
                <p className={c.parent_id ? "pl-4" : ""}>{c.text ?? "(sem texto)"}</p>
                <p className="text-xs text-muted-foreground">
                  {c.commented_at ? new Date(c.commented_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : ""}
                  {c.like_count > 0 ? ` · ${c.like_count} curtida(s)` : ""}
                  {c.parent_id ? " · resposta" : ""}
                  {c.permalink && (
                    <a href={c.permalink} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-0.5 font-medium text-primary hover:underline">
                      ver post <ExternalLink className="size-3" />
                    </a>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">Mostrando os 100 mais recentes. O nome de quem comentou não vem da API com as permissões atuais do token.</p>
      </Panel>
    </IgShell>
  );
}
