import { useMemo, useState } from "react";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { formatBRL, formatInt } from "@/lib/commercial";
import {
  formatDate,
  PROJECT_STATUS_LABEL,
  snap,
  useIuliSnapshots,
  type Charges,
  type CostCenter,
  type Product,
  type Project,
} from "@/lib/iuli";
import { IULI_SOURCES as S } from "@/lib/iuliSources";
import { EmptyState, KpiCard, Panel } from "@/components/commercial/CommercialUI";
import { Input } from "@/components/ui/input";
import { IuliShell, StatusPill } from "@/components/iuli/IuliUI";
import { CounterpartyRulesPanel } from "@/components/iuli/CounterpartyRulesPanel";

const PROJECT_TONE: Record<Project["situacao"], "ok" | "warn" | "bad" | "neutral"> = {
  em_andamento: "ok",
  planejado: "warn",
  encerrado: "neutral",
  cancelado: "bad",
};

export default function IuliCadastros() {
  const { workspace } = useWorkspace();
  const { data: snaps } = useIuliSnapshots(workspace?.id);
  const projects = useMemo(() => snap<{ projetos: Project[] }>(snaps, "projects")?.projetos ?? [], [snaps]);
  const costCenters = useMemo(() => snap<{ centros_de_custo: CostCenter[] }>(snaps, "cost_centers")?.centros_de_custo ?? [], [snaps]);
  const products = snap<{ itens: Product[] }>(snaps, "products")?.itens ?? [];
  const charges = snap<Charges>(snaps, "charges:all");

  const [situacao, setSituacao] = useState<string>("em_andamento");
  const [search, setSearch] = useState("");

  const d = useMemo(() => {
    const bySituacao = projects.reduce<Record<string, number>>((acc, p) => ({ ...acc, [p.situacao]: (acc[p.situacao] ?? 0) + 1 }), {});
    const withBudget = projects.filter((p) => p.receita_orcada > 0 || p.despesa_orcada > 0);
    const q = search.trim().toLowerCase();
    const filtered = projects
      .filter((p) => !situacao || p.situacao === situacao)
      .filter((p) => !q || `${p.nome} ${p.sigla ?? ""} ${p.cliente ?? ""}`.toLowerCase().includes(q))
      .sort((a, b) => String(b.inicio).localeCompare(String(a.inicio)));
    const activeCenters = costCenters.filter((c) => c.situacao === "ativo");
    return { bySituacao, withBudget, filtered, activeCenters };
  }, [projects, costCenters, situacao, search]);

  return (
    <IuliShell title="Projetos & Cadastros" description="Estrutura cadastrada na IULI: projetos, centros de custo, produtos e cobranças" singleCompany>
      <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          info={S.projects()}
          label="Projetos em andamento"
          value={formatInt(d.bySituacao.em_andamento ?? 0)}
          sub={`de ${formatInt(projects.length)} · ${formatInt(d.bySituacao.cancelado ?? 0)} cancelados`}
        />
        <KpiCard
          info={S.projects()}
          label="Projetos com orçamento"
          value={formatInt(d.withBudget.length)}
          sub="receita ou despesa orçada"
          tone={projects.length && d.withBudget.length / projects.length < 0.2 ? "warn" : "default"}
        />
        <KpiCard info={S.costCenters()} label="Centros de custo ativos" value={formatInt(d.activeCenters.length)} sub={`de ${formatInt(costCenters.length)} cadastrados`} />
        <KpiCard info={S.charges()} label="Cobranças emitidas pela IULI" value={formatInt(charges?.itens.length ?? 0)} sub="boletos/Pix" />
      </section>

      <Panel
        title="Projetos"
        info={S.projects()}
        action={
          <div className="flex flex-wrap gap-2">
            <Input placeholder="Buscar projeto" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 w-48" />
            <select
              aria-label="Situação"
              value={situacao}
              onChange={(e) => setSituacao(e.target.value)}
              className="h-9 rounded-md border border-input bg-card px-3 text-sm font-medium"
            >
              <option value="">Todas as situações</option>
              {Object.entries(PROJECT_STATUS_LABEL).map(([k, label]) => (
                <option key={k} value={k}>
                  {label} ({formatInt(d.bySituacao[k] ?? 0)})
                </option>
              ))}
            </select>
          </div>
        }
      >
        {d.filtered.length ? (
          <div className="-mx-4 max-h-[32rem] overflow-auto md:mx-0">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="sticky top-0 bg-card text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-4 py-2 font-medium md:pl-0">Projeto</th>
                  <th className="px-3 py-2 font-medium">Período</th>
                  <th className="px-3 py-2 font-medium">Situação</th>
                  <th className="px-3 py-2 text-right font-medium">Receita orçada</th>
                  <th className="px-3 py-2 text-right font-medium">Despesa orçada</th>
                  <th className="px-4 py-2 font-medium md:pr-0">Confiável</th>
                </tr>
              </thead>
              <tbody>
                {d.filtered.map((p) => (
                  <tr key={p.id} className="border-b border-border/60 last:border-0">
                    <td className="max-w-80 px-4 py-2.5 md:pl-0">
                      <span className="block truncate font-medium">{p.nome}</span>
                      {(p.cliente || p.familia) && <span className="block truncate text-xs text-muted-foreground">{[p.cliente, p.familia].filter(Boolean).join(" · ")}</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-muted-foreground">
                      {formatDate(p.inicio)} – {formatDate(p.fim)}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusPill tone={PROJECT_TONE[p.situacao]}>{PROJECT_STATUS_LABEL[p.situacao]}</StatusPill>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{p.receita_orcada ? formatBRL(p.receita_orcada) : "—"}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{p.despesa_orcada ? formatBRL(p.despesa_orcada) : "—"}</td>
                    <td className="px-4 py-2.5 md:pr-0">{p.confiavel ? "Sim" : <StatusPill tone="warn">Pendência</StatusPill>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState>Nenhum projeto com esse filtro.</EmptyState>
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Centros de custo" info={S.costCenters()}>
          {costCenters.length ? (
            <ul className="flex max-h-96 flex-col divide-y divide-border overflow-auto">
              {[...costCenters]
                .sort((a, b) => (a.situacao === b.situacao ? a.nome.localeCompare(b.nome) : a.situacao === "ativo" ? -1 : 1))
                .map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <div className="min-w-0">
                      <span className="block truncate font-medium">{c.nome}</span>
                      {c.descricao && c.descricao !== c.nome && <span className="block truncate text-xs text-muted-foreground">{c.descricao}</span>}
                    </div>
                    <StatusPill tone={c.situacao === "ativo" ? "ok" : "neutral"}>{c.situacao === "ativo" ? "Ativo" : "Inativo"}</StatusPill>
                  </li>
                ))}
            </ul>
          ) : (
            <EmptyState>Nenhum centro de custo.</EmptyState>
          )}
        </Panel>

        <Panel title="Produtos e serviços" info={S.products()} action={<span className="text-sm text-muted-foreground">{products.length >= 100 ? "Primeiros 100" : formatInt(products.length)}</span>}>
          {products.length ? (
            <ul className="flex max-h-96 flex-col divide-y divide-border overflow-auto">
              {products.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <span className="block truncate font-medium">{p.nome}</span>
                    {p.codigo && <span className="block truncate font-mono text-xs text-muted-foreground">{p.codigo}</span>}
                  </div>
                  <span className="shrink-0 font-semibold tabular-nums">{formatBRL(p.preco)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>Nenhum produto.</EmptyState>
          )}
        </Panel>
      </div>

      <Panel title="Cobranças emitidas pela IULI" info={S.charges()}>
        {charges?.itens.length ? (
          <p className="text-sm">{formatInt(charges.itens.length)} cobranças encontradas.</p>
        ) : (
          <EmptyState>Nenhum boleto ou Pix emitido pela própria IULI. As cobranças devem estar saindo por outra plataforma.</EmptyState>
        )}
      </Panel>
      <CounterpartyRulesPanel info={S.counterparties()} />
    </IuliShell>
  );
}
