import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { useHubspotOwners } from "@/lib/hubspotMeta";
import { ownerDisplay } from "@/lib/commercial";
import type { ResultFilters } from "@/lib/resultFilters";
import { useSalesMissing, type MissingSale } from "@/lib/salesData";
import { downloadCsv } from "@/lib/detailData";
import { formatCount, formatMoney } from "@/lib/money";
import { RESULT_SOURCES as S } from "@/lib/resultSources";
import { EmptyState, LoadingBlock, Panel } from "@/components/commercial/CommercialUI";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// "Vendas que deveriam estar na pipeline de Contratos e não foram encontradas lá":
// clientes com pagamento na Hubla & TMB e/ou título faturado na IULI de produto dos 6
// sem negócio GANHO de Contratos do mesmo cliente e produto.

const PAGE = 25;
const dayBR = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "");
const selectClass = "h-10 max-w-[14rem] rounded-md border border-input bg-card px-3 text-sm font-medium";

/** Estimativa do valor da venda: o maior entre o que a Hubla/TMB e a IULI mostram (evita contar dobrado). */
const estimate = (r: MissingSale) => Math.max(r.hubla_valor, r.iuli_valor);

export function MissingSales({ filters }: { filters: ResultFilters }) {
  const { workspace } = useWorkspace();
  const ws = workspace?.id;
  const owners = useHubspotOwners(ws);
  const query = useSalesMissing(ws, filters);

  const [search, setSearch] = useState("");
  const [situacao, setSituacao] = useState<"" | "nao_existe" | "nao_ganho">("");
  const [produto, setProduto] = useState("");
  const [page, setPage] = useState(0);

  const all = useMemo(() => (query.data ?? []).filter((r) => !filters.produto || filters.produto.includes(r.produto)), [query.data, filters.produto]);
  const produtos = useMemo(() => [...new Set(all.map((r) => r.produto))].sort(), [all]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter(
      (r) =>
        (!situacao || r.contratos_situacao === situacao) &&
        (!produto || r.produto === produto) &&
        (!q || [r.cliente, r.produto, r.contact_email, r.contact_phone, r.documento, r.contratos_negocio].some((v) => (v ?? "").toLowerCase().includes(q))),
    );
  }, [all, search, situacao, produto]);

  const totals = (list: MissingSale[]) => ({
    n: list.length,
    hubla: list.reduce((a, r) => a + r.hubla_valor, 0),
    iuli: list.reduce((a, r) => a + r.iuli_valor, 0),
    est: list.reduce((a, r) => a + estimate(r), 0),
  });
  const tAll = totals(all);
  const tNo = totals(all.filter((r) => r.contratos_situacao === "nao_existe"));
  const tNg = totals(all.filter((r) => r.contratos_situacao === "nao_ganho"));
  const tShown = totals(rows);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const shown = rows.slice(page * PAGE, page * PAGE + PAGE);
  const ownerName = (id: string | null) => (id ? ownerDisplay(owners, id) : "");
  const situationText = (r: MissingSale) => (r.contratos_situacao === "nao_existe" ? "Não existe em Contratos" : `Em Contratos, não ganho: ${r.contratos_etapa ?? ""}`);

  const exportCsv = () =>
    downloadCsv(
      `vendas-fora-de-contratos-${filters.from}-a-${filters.to}.csv`,
      [
        "Cliente",
        "Produto",
        "Situação em Contratos",
        "Negócio em Contratos",
        "Valor em Contratos",
        "Data em Contratos",
        "Vendedor (Contratos)",
        "Hubla & TMB: pagamentos",
        "Hubla & TMB: valor",
        "Hubla & TMB: primeiro pagamento",
        "IULI: títulos",
        "IULI: valor faturado",
        "IULI: recebido",
        "IULI: a receber",
        "IULI: primeira competência",
        "Valor estimado da venda",
        "E-mail",
        "Telefone",
        "CPF/CNPJ",
      ],
      rows.map((r) => [
        r.cliente,
        r.produto,
        situationText(r),
        r.contratos_negocio,
        r.contratos_valor,
        dayBR(r.contratos_data),
        ownerName(r.contratos_owner_id),
        r.hubla_qtd || "",
        r.hubla_valor || "",
        dayBR(r.hubla_primeira),
        r.iuli_qtd || "",
        r.iuli_valor || "",
        r.iuli_recebido || "",
        r.iuli_a_receber || "",
        dayBR(r.iuli_primeira),
        estimate(r),
        r.contact_email,
        r.contact_phone,
        r.documento,
      ]),
    );

  return (
    <Panel
      title="Vendas que deveriam estar em Contratos e não foram encontradas lá"
      info={S.missing()}
      action={
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length}>
          <Download className="mr-1.5 size-4" />
          Exportar CSV
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">
        Para os produtos dos 6, a venda é a da pipeline de Contratos. Aqui estão os clientes que têm pagamento na Hubla &amp; TMB e/ou título faturado na IULI no período, mas <b>nenhum negócio ganho em Contratos</b> do mesmo cliente e produto. A comparação de nomes aceita nome abreviado
        (primeiro e último nome); confira os casos limítrofes.
      </p>

      {query.isLoading ? (
        <LoadingBlock />
      ) : !all.length ? (
        <EmptyState>Nenhuma venda de produto dos 6 sem negócio ganho em Contratos no período.</EmptyState>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {[
              { label: "Total que falta em Contratos", t: tAll, tone: "" },
              { label: "Não existe em Contratos", t: tNo, tone: "text-destructive" },
              { label: "Existe em Contratos, mas não ganho", t: tNg, tone: "text-amber-700 dark:text-amber-400" },
            ].map((c) => (
              <div key={c.label} className="flex flex-col gap-0.5 rounded-lg border border-border bg-card p-3">
                <span className={cn("text-sm font-medium", c.tone || "text-muted-foreground")}>{c.label}</span>
                <span className="text-lg font-semibold">
                  {formatCount(c.t.n)} clientes · {formatMoney(c.t.est)}
                </span>
                <span className="text-xs text-muted-foreground">
                  Hubla &amp; TMB {formatMoney(c.t.hubla)} · IULI {formatMoney(c.t.iuli)}
                </span>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="h-10 w-64"
              aria-label="Pesquisar"
              placeholder="Cliente, e-mail, produto…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
            <select
              className={selectClass}
              aria-label="Situação em Contratos"
              value={situacao}
              onChange={(e) => {
                setSituacao(e.target.value as typeof situacao);
                setPage(0);
              }}
            >
              <option value="">Todas as situações</option>
              <option value="nao_existe">Não existe em Contratos</option>
              <option value="nao_ganho">Existe, não ganho</option>
            </select>
            <select
              className={selectClass}
              aria-label="Produto"
              value={produto}
              onChange={(e) => {
                setProduto(e.target.value);
                setPage(0);
              }}
            >
              <option value="">Todos os produtos</option>
              {produtos.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <span className="text-sm text-muted-foreground">
              {formatCount(rows.length)} de {formatCount(all.length)} clientes
            </span>
          </div>

          <div className="-mx-4 overflow-x-auto md:mx-0">
            <table className="w-full min-w-[1100px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 font-medium">Cliente</th>
                  <th className="px-3 py-2 font-medium">Produto</th>
                  <th className="px-3 py-2 font-medium">Em Contratos</th>
                  <th className="px-3 py-2 font-medium">Hubla &amp; TMB</th>
                  <th className="px-3 py-2 font-medium">IULI (faturado)</th>
                  <th className="px-3 py-2 text-right font-medium">Valor estimado</th>
                  <th className="px-3 py-2 font-medium">Contato</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={`${r.cliente}-${r.produto}-${i}`} className="border-b border-border/60 align-top last:border-0">
                    <td className="px-3 py-2.5 font-medium">{r.cliente}</td>
                    <td className="px-3 py-2.5">{r.produto}</td>
                    <td className="px-3 py-2.5">
                      <span
                        className={cn(
                          "rounded-full px-2.5 py-1 text-xs font-semibold",
                          r.contratos_situacao === "nao_existe" ? "bg-destructive/10 text-destructive" : "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
                        )}
                      >
                        {r.contratos_situacao === "nao_existe" ? "Não existe" : r.contratos_etapa}
                      </span>
                      {r.contratos_negocio && (
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {r.contratos_negocio}
                          {r.contratos_valor != null && ` · ${formatMoney(r.contratos_valor)}`}
                          {r.contratos_data && ` · ${dayBR(r.contratos_data)}`}
                          {r.contratos_owner_id && ` · ${ownerName(r.contratos_owner_id)}`}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">
                      {r.hubla_qtd ? (
                        <>
                          {formatMoney(r.hubla_valor)}
                          <span className="block text-xs text-muted-foreground">
                            {r.hubla_qtd} pagamento(s) · desde {dayBR(r.hubla_primeira)}
                          </span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">
                      {r.iuli_qtd ? (
                        <>
                          {formatMoney(r.iuli_valor)}
                          <span className="block text-xs text-muted-foreground">
                            {r.iuli_qtd} título(s) · recebido {formatMoney(r.iuli_recebido)} · a receber {formatMoney(r.iuli_a_receber)}
                          </span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{formatMoney(estimate(r))}</td>
                    <td className="px-3 py-2.5 text-xs">
                      {r.contact_email && <span className="block">{r.contact_email}</span>}
                      {r.contact_phone && <span className="block">{r.contact_phone}</span>}
                      {r.documento && <span className="block">{r.documento}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border font-semibold">
                  <td className="px-3 py-3" colSpan={3}>
                    Total ({formatCount(tShown.n)} clientes)
                  </td>
                  <td className="px-3 py-3 tabular-nums">{formatMoney(tShown.hubla)}</td>
                  <td className="px-3 py-3 tabular-nums">{formatMoney(tShown.iuli)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{formatMoney(tShown.est)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          {rows.length > PAGE && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">
                Mostrando {page * PAGE + 1}–{Math.min(rows.length, (page + 1) * PAGE)} de {formatCount(rows.length)}
              </span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                  <ChevronLeft className="size-4" />
                  Anterior
                </Button>
                <span className="tabular-nums">
                  {page + 1} / {pages}
                </span>
                <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
                  Próxima
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Valor estimado = o maior entre o que a Hubla &amp; TMB e a IULI mostram para o cliente (para não somar a mesma venda duas vezes). O total considera os filtros acima e todas as páginas.
          </p>
        </>
      )}
    </Panel>
  );
}
