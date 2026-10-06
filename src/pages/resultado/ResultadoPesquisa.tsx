import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download, Search } from "lucide-react";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { useHubspotOwners } from "@/lib/hubspotMeta";
import { ownerDisplay } from "@/lib/commercial";
import { resultPeriodText, useResultFilters } from "@/lib/resultFilters";
import { BASE_LABEL, METHOD_LABEL, fetchAllSearch, useSearch, type SearchBase, type SearchRow } from "@/lib/searchData";
import { downloadCsv } from "@/lib/detailData";
import { useRevenueProducts } from "@/lib/receitaData";
import { formatCount, formatMoney } from "@/lib/money";
import { RESULT_SOURCES as S } from "@/lib/resultSources";
import { EmptyState, LoadingBlock, MultiSelect, Panel } from "@/components/commercial/CommercialUI";
import { ResultCompanyFilter, ResultPeriodBar, ResultShell } from "@/components/result/ResultUI";
import { LancamentoDetail } from "@/components/result/LancamentoDetail";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const PAGE = 50;
const dayBR = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "");
const selectClass = "h-10 max-w-[18rem] rounded-md border border-input bg-card px-3 text-sm font-medium";
const SITUATION: Record<string, { text: string; className: string }> = {
  recebido: { text: "Recebido", className: "bg-primary/10 text-primary" },
  a_vencer: { text: "A vencer", className: "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-200" },
  vencido: { text: "Vencido", className: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200" },
};
const PIPELINE_LABEL: Record<string, string> = { contratos: "Contratos", hubla_tmb: "Hubla & TMB" };

const COLUMNS: { key: string; label: string; sort?: string; align?: "right" }[] = [
  { key: "competencia", label: "Competência", sort: "competencia" },
  { key: "due_date", label: "Vencimento", sort: "due_date" },
  { key: "pagamento", label: "Pago em", sort: "pagamento" },
  { key: "cliente", label: "Cliente", sort: "cliente" },
  { key: "contato", label: "E-mail · telefone · CPF/CNPJ" },
  { key: "produto", label: "Produto", sort: "produto" },
  { key: "situacao", label: "Situação", sort: "situacao" },
  { key: "valor", label: "Valor", sort: "valor", align: "right" },
  { key: "ganho", label: "Data do ganho (Contratos)", sort: "dia_ganho" },
  { key: "negocio", label: "Negócio vinculado" },
  { key: "acao", label: "" },
];

export default function ResultadoPesquisa() {
  const { workspace } = useWorkspace();
  const ws = workspace?.id;
  const owners = useHubspotOwners(ws);
  const { filters, set } = useResultFilters();
  const products = useRevenueProducts(ws, filters);

  const base: SearchBase = filters.base;
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState("");
  const [situacao, setSituacao] = useState("");
  const [vinculo, setVinculo] = useState<"" | "com" | "sem">("");
  const [sort, setSort] = useState<string>("competencia");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);
  const [detail, setDetail] = useState<SearchRow | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchText);
      setPage(0);
    }, 400);
    return () => clearTimeout(t);
  }, [searchText]);

  // a data da ordenação padrão acompanha a data de referência escolhida
  useEffect(() => {
    setSort(base === "vencimento" ? "due_date" : base === "pagamento" ? "pagamento" : base === "ganho" ? "dia_ganho" : "competencia");
    setPage(0);
  }, [base]);

  const query = useMemo(
    () => ({ base, search, situacoes: situacao ? [situacao] : null, vinculo: (vinculo || null) as "com" | "sem" | null, sort, dir, limit: PAGE, offset: page * PAGE }),
    [base, search, situacao, vinculo, sort, dir, page],
  );
  const result = useSearch(ws, filters, query);
  const total = result.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const ownerName = (id: string | null) => (id ? ownerDisplay(owners, id) : "");

  const toggleSort = (key?: string) => {
    if (!key) return;
    if (sort === key) setDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSort(key);
      setDir("desc");
    }
    setPage(0);
  };

  const exportCsv = async () => {
    if (!ws) return;
    setExporting(true);
    try {
      const rows = await fetchAllSearch(ws, filters, { base, search, situacoes: query.situacoes, vinculo: query.vinculo, sort, dir });
      downloadCsv(
        `pesquisa-${filters.from}-a-${filters.to}.csv`,
        ["Competência", "Vencimento", "Pago em", "Cliente", "E-mail", "Telefone", "CPF/CNPJ", "Empresa", "Produto", "Categoria na IULI", "Situação", "Valor (recebido ou previsto)", "Valor previsto", "Nota fiscal", "Venda na IULI", "Data do ganho (Contratos)", "Negócio vinculado", "Pipeline", "Etapa", "Valor do negócio", "Vendedor", "Closer", "Como foi ligado", "ID IULI"],
        rows.map((r) => [dayBR(r.competencia), dayBR(r.due_date), dayBR(r.pagamento), r.cliente, r.contact_email, r.contact_phone, r.documento, r.empresa, r.produto, r.categoria, SITUATION[r.situacao]?.text ?? r.situacao, r.valor, r.valor_previsto, r.nf_numero, r.venda_id, dayBR(r.dia_ganho), r.dealname, PIPELINE_LABEL[r.pipeline_kind ?? ""] ?? r.pipeline_kind, r.etapa, r.deal_amount, ownerName(r.owner_id), ownerName(r.closer_owner_id), METHOD_LABEL[r.metodo ?? ""] ?? r.metodo, r.iuli_id]),
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <ResultShell
      title="Pesquisa"
      description={`${resultPeriodText(filters)} · lançamentos de receita de produto da IULI, pela data de ${BASE_LABEL[base].toLowerCase()}, com o negócio de Contratos vinculado`}
      filters={
        <>
          <ResultPeriodBar filters={filters} set={set} />
          <label className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            Pesquisar pela data de
            <select className={selectClass} aria-label="Data de referência" value={base} onChange={(e) => set({ base: e.target.value === "competencia" ? null : e.target.value })}>
              {(Object.keys(BASE_LABEL) as SearchBase[]).map((b) => (
                <option key={b} value={b}>
                  {BASE_LABEL[b]}
                </option>
              ))}
            </select>
          </label>
          <div className="flex-1" />
          <ResultCompanyFilter filters={filters} set={set} />
          <MultiSelect label="Produto" allLabel="Todos os produtos" options={(products.data ?? []).map((p) => ({ value: p, label: p }))} selected={filters.produto} onChange={(v) => set({ produto: v })} />
        </>
      }
    >
      <Panel title="Pesquisar lançamentos" info={S.pesquisa()}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[18rem] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="h-11 pl-9" aria-label="Pesquisar pessoa" placeholder="Nome, e-mail, telefone ou CPF da pessoa (ou produto)" value={searchText} onChange={(e) => setSearchText(e.target.value)} />
          </div>
          <select className={selectClass} aria-label="Situação" value={situacao} onChange={(e) => { setSituacao(e.target.value); setPage(0); }}>
            <option value="">Todas as situações</option>
            <option value="recebido">Recebido</option>
            <option value="a_vencer">A vencer</option>
            <option value="vencido">Vencido</option>
          </select>
          <select className={selectClass} aria-label="Vínculo com Contratos" value={vinculo} onChange={(e) => { setVinculo(e.target.value as typeof vinculo); setPage(0); }}>
            <option value="">Com ou sem negócio vinculado</option>
            <option value="com">Só com negócio vinculado</option>
            <option value="sem">Só sem negócio vinculado</option>
          </select>
          <Button variant="outline" className="h-10" onClick={exportCsv} disabled={exporting || !total}>
            <Download className="mr-1.5 size-4" />
            {exporting ? "Exportando…" : "Exportar CSV"}
          </Button>
        </div>

        <p className="text-sm text-muted-foreground" aria-live="polite">
          {result.isLoading ? (
            "Carregando…"
          ) : (
            <>
              <b className="text-foreground">{formatCount(total)}</b> {total === 1 ? "lançamento" : "lançamentos"} · soma <b className="text-foreground">{formatMoney(result.data?.sum ?? 0)}</b> · uma linha por título (cada parcela é uma linha)
            </>
          )}
        </p>

        {result.isLoading ? (
          <LoadingBlock />
        ) : result.error ? (
          <p className="text-sm text-destructive">Não foi possível pesquisar: {(result.error as Error).message}</p>
        ) : result.data?.rows.length ? (
          <div className="-mx-4 overflow-x-auto md:mx-0">
            <table className="w-full min-w-[1280px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr className="border-b border-border">
                  {COLUMNS.map((c) => (
                    <th key={c.key} className={cn("whitespace-nowrap px-3 py-2 font-medium", c.align === "right" && "text-right")}>
                      {c.sort ? (
                        <button type="button" className="inline-flex items-center gap-1 uppercase hover:text-foreground" onClick={() => toggleSort(c.sort)}>
                          {c.label}
                          {sort === c.sort && (dir === "desc" ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
                        </button>
                      ) : (
                        c.label
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.data.rows.map((r) => (
                  <tr key={`${r.integration_id}-${r.iuli_id}`} className="border-b border-border/60 align-top last:border-0">
                    <td className="px-3 py-2.5 tabular-nums">{dayBR(r.competencia)}</td>
                    <td className="px-3 py-2.5 tabular-nums">{dayBR(r.due_date)}</td>
                    <td className="px-3 py-2.5 tabular-nums">{dayBR(r.pagamento)}</td>
                    <td className="px-3 py-2.5">
                      <span className="font-medium">{r.cliente}</span>
                      <span className="block text-xs text-muted-foreground">{r.empresa}</span>
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {r.contact_email && <span className="block">{r.contact_email}</span>}
                      {r.contact_phone && <span className="block">{r.contact_phone}</span>}
                      {r.documento && <span className="block">{r.documento}</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      {r.produto}
                      {r.categoria && r.categoria !== r.produto && <span className="block text-xs text-muted-foreground">{r.categoria}</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", SITUATION[r.situacao]?.className)}>{SITUATION[r.situacao]?.text ?? r.situacao}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{formatMoney(r.valor)}</td>
                    <td className="px-3 py-2.5 tabular-nums">
                      {r.dia_ganho ? (
                        <>
                          {dayBR(r.dia_ganho)}
                          {r.pipeline_kind && <span className="block text-xs text-muted-foreground">{PIPELINE_LABEL[r.pipeline_kind] ?? r.pipeline_kind}</span>}
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="max-w-72 px-3 py-2.5">
                      {r.dealname ? (
                        <>
                          <span className="block truncate" title={r.dealname}>{r.dealname}</span>
                          <span className="block text-xs text-muted-foreground">
                            {[r.etapa, ownerName(r.owner_id), r.metodo && r.metodo !== "nome" ? METHOD_LABEL[r.metodo] : ""].filter(Boolean).join(" · ")}
                          </span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">Sem negócio vinculado</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <Button variant="outline" size="sm" onClick={() => setDetail(r)}>
                        Detalhar
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState>Nenhum lançamento de produto com esses filtros.</EmptyState>
        )}

        {total > PAGE && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">
              Mostrando {formatCount(page * PAGE + 1)}–{formatCount(Math.min(total, (page + 1) * PAGE))} de {formatCount(total)}
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
      </Panel>

      <LancamentoDetail row={detail} onClose={() => setDetail(null)} />
    </ResultShell>
  );
}
