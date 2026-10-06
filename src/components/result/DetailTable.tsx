import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Columns3, Download, Filter, X } from "lucide-react";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { useHubspotOwners } from "@/lib/hubspotMeta";
import { ownerDisplay } from "@/lib/commercial";
import { useIuliCompanies } from "@/lib/iuli";
import { useCategoryMap } from "@/lib/categoryMap";
import { EMPTY_TABLE_FILTERS, downloadCsv, fetchAllDetail, useDetail, type DetailRow, type Drill, type TableFilters } from "@/lib/detailData";
import { formatCount, formatMoney } from "@/lib/money";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { EmptyState, LoadingBlock, MultiSelect } from "@/components/commercial/CommercialUI";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

// Tabela de detalhe: as linhas que formam um número (painel lateral) e a "Base de
// dados" no fim de cada tela. Filtros da tela valem sempre; os da tabela somam a eles.

const PAGE_SIZE = 50;

const dayBR = (iso: string | null | undefined) => (iso ? iso.split("-").reverse().join("/") : "");

function formatDocument(doc: string | null | undefined): string {
  if (!doc) return "";
  const d = doc.replace(/\D/g, "");
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return doc;
}

const ORIGIN_LABEL: Record<string, string> = { mes: "Venda do mês", outros: "Venda de outros meses", sem_negocio: "Sem negócio vinculado" };
const SITUATION_LABEL: Record<string, string> = { recebido: "Recebido", a_vencer: "A vencer", vencido: "Vencido", a_receber: "A receber" };
const PIPELINE_LABEL: Record<string, string> = { contratos: "Contratos", hubla_tmb: "Hubla & TMB" };
const GROUP_LABEL: Record<string, string> = { high: "High ticket", demais: "Demais", fora_dos_6: "Fora dos 6" };
const TREATMENT_LABEL: Record<string, string> = {
  soma: "Receita de produto",
  a_classificar: "A classificar",
  fora_outros_produtos: "Outras receitas",
  nao_operacional: "Não operacional",
  revisar: "A revisar",
  sem_categoria: "Sem categoria carregada",
};

interface Ctx {
  ownerName: (id: string | null) => string;
  today: string;
}

interface Col {
  key: string;
  label: string;
  sort?: string;
  align?: "right";
  defaultOn: boolean;
  render: (r: DetailRow, c: Ctx) => ReactNode;
  csv: (r: DetailRow, c: Ctx) => unknown;
}

const daysLate = (r: DetailRow, c: Ctx) => (r.situacao === "vencido" && r.due_date ? Math.round((Date.parse(`${c.today}T12:00:00Z`) - Date.parse(`${r.due_date}T12:00:00Z`)) / 86_400_000) : null);

const COLUMNS: Record<Drill["domain"], Col[]> = {
  vendas: [
    { key: "dia", label: "Ganho em", sort: "dia", defaultOn: true, render: (r) => dayBR(r.dia), csv: (r) => dayBR(r.dia) },
    { key: "cliente", label: "Cliente", sort: "dealname", defaultOn: true, render: (r) => <span className="font-medium">{r.cliente}</span>, csv: (r) => r.cliente },
    { key: "dealname", label: "Negócio", defaultOn: false, render: (r) => r.dealname, csv: (r) => r.dealname },
    { key: "email", label: "E-mail", defaultOn: true, render: (r) => r.contact_email, csv: (r) => r.contact_email },
    { key: "phone", label: "Telefone", defaultOn: true, render: (r) => r.contact_phone, csv: (r) => r.contact_phone },
    { key: "doc", label: "CPF/CNPJ", defaultOn: true, render: (r) => formatDocument(r.documento), csv: (r) => formatDocument(r.documento) },
    {
      key: "produto",
      label: "Produto",
      sort: "produto",
      defaultOn: true,
      render: (r) => (
        <>
          {r.produto}
          {r.produto_raw && r.produto_raw !== r.produto && <span className="block text-xs text-muted-foreground">{r.produto_raw}</span>}
        </>
      ),
      csv: (r) => r.produto,
    },
    { key: "produto_raw", label: "Produto no HubSpot", defaultOn: false, render: (r) => r.produto_raw, csv: (r) => r.produto_raw },
    { key: "pipeline", label: "Pipeline", sort: "pipeline", defaultOn: true, render: (r) => PIPELINE_LABEL[r.pipeline_kind ?? ""] ?? r.pipeline_kind, csv: (r) => PIPELINE_LABEL[r.pipeline_kind ?? ""] ?? r.pipeline_kind },
    { key: "grupo", label: "Grupo", defaultOn: false, render: (r) => GROUP_LABEL[r.grupo ?? ""] ?? r.grupo, csv: (r) => GROUP_LABEL[r.grupo ?? ""] ?? r.grupo },
    { key: "owner", label: "Vendedor", sort: "owner", defaultOn: true, render: (r, c) => c.ownerName(r.owner_id), csv: (r, c) => c.ownerName(r.owner_id) },
    { key: "closer", label: "Closer", defaultOn: false, render: (r, c) => (r.closer_owner_id ? c.ownerName(r.closer_owner_id) : ""), csv: (r, c) => (r.closer_owner_id ? c.ownerName(r.closer_owner_id) : "") },
    { key: "dup", label: "Fora das Vendas (pagamento Hubla)", defaultOn: false, render: (r) => (r.duplicado ? "Sim" : ""), csv: (r) => (r.duplicado ? "Sim" : "Não") },
    { key: "valor", label: "Valor", sort: "amount", align: "right", defaultOn: true, render: (r) => <span className="font-semibold">{formatMoney(r.valor)}</span>, csv: (r) => r.valor },
    { key: "hubspot", label: "ID HubSpot", defaultOn: false, render: (r) => r.hubspot_id, csv: (r) => r.hubspot_id },
  ],
  receita: [
    { key: "competencia", label: "Competência", sort: "competencia", defaultOn: true, render: (r) => dayBR(r.competencia), csv: (r) => dayBR(r.competencia) },
    { key: "situacao", label: "Situação", sort: "situacao", defaultOn: true, render: (r) => SITUATION_LABEL[r.situacao ?? ""] ?? r.situacao, csv: (r) => SITUATION_LABEL[r.situacao ?? ""] ?? r.situacao },
    { key: "pagamento", label: "Pago em", sort: "pagamento", defaultOn: false, render: (r) => dayBR(r.pagamento), csv: (r) => dayBR(r.pagamento) },
    { key: "cliente", label: "Cliente", sort: "cliente", defaultOn: true, render: (r) => <span className="font-medium">{r.cliente}</span>, csv: (r) => r.cliente },
    { key: "email", label: "E-mail", defaultOn: true, render: (r) => r.contact_email, csv: (r) => r.contact_email },
    { key: "phone", label: "Telefone", defaultOn: true, render: (r) => r.contact_phone, csv: (r) => r.contact_phone },
    { key: "doc", label: "CPF/CNPJ", defaultOn: true, render: (r) => formatDocument(r.documento), csv: (r) => formatDocument(r.documento) },
    { key: "produto", label: "Produto", sort: "produto", defaultOn: true, render: (r) => r.produto, csv: (r) => r.produto },
    { key: "categoria", label: "Categoria na IULI", sort: "categoria", defaultOn: true, render: (r) => r.categoria, csv: (r) => r.categoria },
    { key: "tratamento", label: "Tratamento", defaultOn: false, render: (r) => TREATMENT_LABEL[r.tratamento ?? ""] ?? r.tratamento, csv: (r) => TREATMENT_LABEL[r.tratamento ?? ""] ?? r.tratamento },
    { key: "empresa", label: "Empresa", sort: "empresa", defaultOn: true, render: (r) => r.empresa, csv: (r) => r.empresa },
    { key: "due", label: "Vencimento", sort: "due_date", defaultOn: false, render: (r) => dayBR(r.due_date), csv: (r) => dayBR(r.due_date) },
    { key: "origem", label: "Origem", defaultOn: true, render: (r) => ORIGIN_LABEL[r.origem ?? ""] ?? r.origem, csv: (r) => ORIGIN_LABEL[r.origem ?? ""] ?? r.origem },
    { key: "dealname", label: "Negócio vinculado", defaultOn: true, render: (r) => r.dealname, csv: (r) => r.dealname },
    { key: "ganho", label: "Ganho em", sort: "dia_ganho", defaultOn: true, render: (r) => dayBR(r.dia_ganho), csv: (r) => dayBR(r.dia_ganho) },
    { key: "pipeline", label: "Pipeline", defaultOn: false, render: (r) => PIPELINE_LABEL[r.pipeline_kind ?? ""] ?? r.pipeline_kind, csv: (r) => PIPELINE_LABEL[r.pipeline_kind ?? ""] ?? r.pipeline_kind },
    { key: "owner", label: "Vendedor", defaultOn: true, render: (r, c) => (r.owner_id ? c.ownerName(r.owner_id) : ""), csv: (r, c) => (r.owner_id ? c.ownerName(r.owner_id) : "") },
    { key: "closer", label: "Closer", defaultOn: false, render: (r, c) => (r.closer_owner_id ? c.ownerName(r.closer_owner_id) : ""), csv: (r, c) => (r.closer_owner_id ? c.ownerName(r.closer_owner_id) : "") },
    { key: "nf", label: "Nota fiscal", defaultOn: false, render: (r) => r.nf_numero, csv: (r) => r.nf_numero },
    { key: "venda", label: "Venda na IULI", defaultOn: false, render: (r) => r.venda_id, csv: (r) => r.venda_id },
    { key: "descricao", label: "Descrição na IULI", defaultOn: false, render: (r) => <span className="block max-w-72 truncate" title={r.descricao ?? ""}>{r.descricao}</span>, csv: (r) => r.descricao },
    { key: "previsto", label: "Valor previsto", align: "right", defaultOn: false, render: (r) => (r.valor_previsto != null ? formatMoney(r.valor_previsto) : ""), csv: (r) => r.valor_previsto },
    { key: "valor", label: "Valor (recebido ou previsto)", sort: "valor", align: "right", defaultOn: true, render: (r) => <span className="font-semibold">{formatMoney(r.valor)}</span>, csv: (r) => r.valor },
    { key: "iuli", label: "ID IULI", defaultOn: false, render: (r) => r.iuli_id, csv: (r) => r.iuli_id },
  ],
  caixa: [
    { key: "due", label: "Vencimento", sort: "due_date", defaultOn: true, render: (r) => dayBR(r.due_date), csv: (r) => dayBR(r.due_date) },
    {
      key: "situacao",
      label: "Situação",
      sort: "situacao",
      defaultOn: true,
      render: (r, c) => {
        const late = daysLate(r, c);
        return (
          <>
            {SITUATION_LABEL[r.situacao ?? ""] ?? r.situacao}
            {late !== null && <span className="block text-xs text-muted-foreground">{formatCount(late)} dias de atraso</span>}
          </>
        );
      },
      csv: (r) => SITUATION_LABEL[r.situacao ?? ""] ?? r.situacao,
    },
    { key: "atraso", label: "Dias de atraso", defaultOn: false, render: (r, c) => daysLate(r, c), csv: (r, c) => daysLate(r, c) },
    { key: "cliente", label: "Cliente", sort: "cliente", defaultOn: true, render: (r) => <span className="font-medium">{r.cliente}</span>, csv: (r) => r.cliente },
    { key: "email", label: "E-mail", defaultOn: true, render: (r) => r.contact_email, csv: (r) => r.contact_email },
    { key: "phone", label: "Telefone", defaultOn: true, render: (r) => r.contact_phone, csv: (r) => r.contact_phone },
    { key: "doc", label: "CPF/CNPJ", defaultOn: true, render: (r) => formatDocument(r.documento), csv: (r) => formatDocument(r.documento) },
    { key: "produto", label: "Produto", sort: "produto", defaultOn: true, render: (r) => r.produto, csv: (r) => r.produto },
    { key: "categoria", label: "Categoria na IULI", sort: "categoria", defaultOn: true, render: (r) => r.categoria, csv: (r) => r.categoria },
    { key: "tratamento", label: "Tratamento", defaultOn: false, render: (r) => TREATMENT_LABEL[r.tratamento ?? ""] ?? r.tratamento, csv: (r) => TREATMENT_LABEL[r.tratamento ?? ""] ?? r.tratamento },
    { key: "empresa", label: "Empresa", sort: "empresa", defaultOn: true, render: (r) => r.empresa, csv: (r) => r.empresa },
    { key: "pagamento", label: "Pago em", sort: "pagamento", defaultOn: false, render: (r) => dayBR(r.pagamento), csv: (r) => dayBR(r.pagamento) },
    { key: "dealname", label: "Negócio vinculado", defaultOn: true, render: (r) => r.dealname, csv: (r) => r.dealname },
    { key: "ganho", label: "Ganho em", defaultOn: false, render: (r) => dayBR(r.dia_ganho), csv: (r) => dayBR(r.dia_ganho) },
    { key: "owner", label: "Vendedor", defaultOn: true, render: (r, c) => (r.owner_id ? c.ownerName(r.owner_id) : ""), csv: (r, c) => (r.owner_id ? c.ownerName(r.owner_id) : "") },
    { key: "closer", label: "Closer", defaultOn: false, render: (r, c) => (r.closer_owner_id ? c.ownerName(r.closer_owner_id) : ""), csv: (r, c) => (r.closer_owner_id ? c.ownerName(r.closer_owner_id) : "") },
    { key: "nf", label: "Nota fiscal", defaultOn: false, render: (r) => r.nf_numero, csv: (r) => r.nf_numero },
    { key: "venda", label: "Venda na IULI", defaultOn: false, render: (r) => r.venda_id, csv: (r) => r.venda_id },
    { key: "descricao", label: "Descrição na IULI", defaultOn: false, render: (r) => <span className="block max-w-72 truncate" title={r.descricao ?? ""}>{r.descricao}</span>, csv: (r) => r.descricao },
    { key: "previsto", label: "Valor previsto", align: "right", defaultOn: false, render: (r) => (r.valor_previsto != null ? formatMoney(r.valor_previsto) : ""), csv: (r) => r.valor_previsto },
    { key: "valor", label: "Valor (recebido ou previsto)", sort: "valor", align: "right", defaultOn: true, render: (r) => <span className="font-semibold">{formatMoney(r.valor)}</span>, csv: (r) => r.valor },
    { key: "iuli", label: "ID IULI", defaultOn: false, render: (r) => r.iuli_id, csv: (r) => r.iuli_id },
  ],
};

function loadColumns(domain: string, cols: Col[]): string[] {
  try {
    const raw = window.localStorage.getItem(`farol:result:cols:${domain}`);
    if (raw) {
      const keys = (JSON.parse(raw) as string[]).filter((k) => cols.some((c) => c.key === k));
      if (keys.length) return keys;
    }
  } catch {
    // sem armazenamento: usa o padrão
  }
  return cols.filter((c) => c.defaultOn).map((c) => c.key);
}

function useProductOptions(domain: Drill["domain"], from: string, to: string) {
  const { workspace } = useWorkspace();
  const ws = workspace?.id;
  return useQuery({
    queryKey: ["detail", "products", domain, ws, from, to],
    enabled: !!ws,
    queryFn: async () => {
      if (domain === "vendas") {
        const { data, error } = await supabase.rpc("sales_options", { p_workspace_id: ws, p_from: from, p_to: to });
        if (error) throw error;
        return ((data ?? []) as { kind: string; value: string; qtd: number }[]).filter((r) => r.kind === "produto").sort((a, b) => Number(b.qtd) - Number(a.qtd)).map((r) => r.value);
      }
      const fn = domain === "receita" ? "receita_produtos" : "caixa_produtos";
      const { data, error } = await supabase.rpc(fn, { p_workspace_id: ws, p_from: from, p_to: to });
      if (error) throw error;
      return ((data ?? []) as { produto: string }[]).map((r) => r.produto);
    },
  });
}

const selectClass = "h-10 max-w-[14rem] rounded-md border border-input bg-card px-3 text-sm font-medium";

export function DetailTable({ drill, compact = false, title }: { drill: Drill; compact?: boolean; title?: string }) {
  const { workspace } = useWorkspace();
  const ws = workspace?.id;
  const owners = useHubspotOwners(ws);
  const companies = useIuliCompanies(ws);
  const categories = useCategoryMap(ws);
  const cols = COLUMNS[drill.domain];

  const [filters, setFilters] = useState<TableFilters>({ ...EMPTY_TABLE_FILTERS });
  const [searchText, setSearchText] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [sort, setSort] = useState<string>(drill.domain === "vendas" ? "amount" : "valor");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);
  const [visible, setVisible] = useState<string[]>(() => loadColumns(drill.domain, cols));
  const [exporting, setExporting] = useState(false);

  // Nova base (clique em outro número ou mudança de filtro da tela): recomeça.
  const baseKey = JSON.stringify(drill);
  useEffect(() => {
    setFilters({ ...EMPTY_TABLE_FILTERS });
    setSearchText("");
    setPage(0);
  }, [baseKey]);

  // Pesquisa aplica depois que a pessoa para de digitar.
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => (f.search === searchText ? f : { ...f, search: searchText }));
      setPage(0);
    }, 350);
    return () => clearTimeout(t);
  }, [searchText]);

  const query = { sort, dir, limit: PAGE_SIZE, offset: page * PAGE_SIZE };
  const result = useDetail(ws, drill, filters, query);
  const today = useMemo(() => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()), []);
  const ctx: Ctx = { ownerName: (id) => ownerDisplay(owners, id), today };

  const productOptions = useProductOptions(drill.domain, drill.from, drill.to);
  const activeCols = cols.filter((c) => visible.includes(c.key));
  const total = result.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const extraActive = Object.entries(filters).some(([k, v]) => (k === "search" ? !!(v as string).trim() : v !== null && v !== "" && !(Array.isArray(v) && !v.length)));

  const set = (patch: Partial<TableFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(0);
  };

  const toggleSort = (key?: string) => {
    if (!key) return;
    if (sort === key) setDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSort(key);
      setDir("desc");
    }
    setPage(0);
  };

  const toggleColumn = (key: string, on: boolean) => {
    const next = on ? [...visible, key] : visible.filter((k) => k !== key);
    if (!next.length) return;
    setVisible(next);
    try {
      window.localStorage.setItem(`farol:result:cols:${drill.domain}`, JSON.stringify(next));
    } catch {
      // sem armazenamento: só não lembra
    }
  };

  const exportCsv = async () => {
    if (!ws) return;
    setExporting(true);
    try {
      const rows = await fetchAllDetail(ws, drill, filters, { sort, dir });
      downloadCsv(
        `${drill.domain}-${drill.from}-a-${drill.to}.csv`,
        activeCols.map((c) => c.label),
        rows.map((r) => activeCols.map((c) => c.csv(r, ctx))),
      );
    } finally {
      setExporting(false);
    }
  };

  const categoryOptions = useMemo(() => {
    const names = (categories.data ?? []).filter((c) => (drill.tratamento === null || drill.tratamento === undefined ? true : c.tratamento === drill.tratamento)).map((c) => c.categoria);
    return [...new Set(names)].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [categories.data, drill.tratamento]);

  const ownerOptions = Object.keys(owners)
    .map((id) => ({ id, name: ownerDisplay(owners, id) }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          {title && <h3 className="text-base font-semibold">{title}</h3>}
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {result.isLoading ? (
              "Carregando…"
            ) : (
              <>
                <b className="text-foreground">{formatCount(total)}</b> {total === 1 ? "linha" : "linhas"} · soma <b className="text-foreground">{formatMoney(result.data?.sum ?? 0)}</b>
                {extraActive && " · com filtros extras da tabela (a soma pode diferir do número clicado)"}
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input className="h-10 w-56" aria-label="Pesquisar" placeholder="Cliente, e-mail, produto…" value={searchText} onChange={(e) => setSearchText(e.target.value)} />
          <Button variant="outline" className="h-10" onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters}>
            <Filter className="mr-1.5 size-4" />
            Filtros
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex h-10 items-center gap-1.5 rounded-md border border-input bg-card px-3 text-sm font-medium hover:bg-accent" aria-label="Escolher colunas">
              <Columns3 className="size-4" />
              Colunas
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
              <DropdownMenuLabel>Colunas visíveis</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {cols.map((c) => (
                <DropdownMenuCheckboxItem key={c.key} checked={visible.includes(c.key)} onSelect={(e) => e.preventDefault()} onCheckedChange={(on) => toggleColumn(c.key, !!on)}>
                  {c.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" className="h-10" onClick={exportCsv} disabled={exporting || !total}>
            <Download className="mr-1.5 size-4" />
            {exporting ? "Exportando…" : "Exportar CSV"}
          </Button>
        </div>
      </div>

      {showFilters && (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/40 p-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            De
            <Input type="date" className="h-10 w-40" value={filters.from ?? ""} min={drill.from} max={drill.to} onChange={(e) => set({ from: e.target.value || null })} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            Até
            <Input type="date" className="h-10 w-40" value={filters.to ?? ""} min={drill.from} max={drill.to} onChange={(e) => set({ to: e.target.value || null })} />
          </label>
          <div className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            Produto
            <MultiSelect
              label="Produto"
              allLabel="Todos os produtos"
              options={(productOptions.data ?? []).map((p) => ({ value: p, label: p }))}
              selected={filters.produtos}
              onChange={(v) => set({ produtos: v })}
            />
          </div>
          {drill.domain === "vendas" && (
            <>
              <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                Vendedor
                <select className={selectClass} value={filters.owner ?? ""} onChange={(e) => set({ owner: e.target.value || null })}>
                  <option value="">Todos</option>
                  {ownerOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                Pipeline
                <select className={selectClass} value={filters.pipeline ?? ""} onChange={(e) => set({ pipeline: e.target.value || null })}>
                  <option value="">Todos</option>
                  <option value="contratos">Contratos</option>
                  <option value="hubla_tmb">Hubla &amp; TMB</option>
                </select>
              </label>
            </>
          )}
          {drill.domain === "receita" && (
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              Origem
              <select className={selectClass} value={filters.origem ?? ""} onChange={(e) => set({ origem: e.target.value || null })}>
                <option value="">Todas</option>
                {Object.entries(ORIGIN_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          )}
          {(drill.domain === "caixa" || drill.domain === "receita") && (
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              Situação
              <select className={selectClass} value={filters.situacao ?? ""} onChange={(e) => set({ situacao: e.target.value || null })}>
                <option value="">Todas</option>
                {Object.entries(SITUATION_LABEL).filter(([v]) => (drill.domain === "receita" ? v === "recebido" || v === "a_receber" : v !== "a_receber")).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          )}
          {drill.domain !== "vendas" && (
            <>
              <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                Categoria na IULI
                <select className={selectClass} value={filters.categoria ?? ""} onChange={(e) => set({ categoria: e.target.value || null })}>
                  <option value="">Todas</option>
                  {categoryOptions.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              {(companies.data?.length ?? 0) > 1 && drill.empresa === "todas" && (
                <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                  Empresa
                  <select className={selectClass} value={filters.empresa ?? ""} onChange={(e) => set({ empresa: e.target.value || null })}>
                    <option value="">Todas</option>
                    {(companies.data ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label ?? "Empresa"}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            Valor mínimo
            <Input className="h-10 w-32" inputMode="decimal" placeholder="0,00" value={filters.min} onChange={(e) => set({ min: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            Valor máximo
            <Input className="h-10 w-32" inputMode="decimal" placeholder="0,00" value={filters.max} onChange={(e) => set({ max: e.target.value })} />
          </label>
          {extraActive && (
            <Button
              variant="ghost"
              className="h-10"
              onClick={() => {
                setFilters({ ...EMPTY_TABLE_FILTERS });
                setSearchText("");
                setPage(0);
              }}
            >
              <X className="mr-1 size-4" />
              Limpar
            </Button>
          )}
        </div>
      )}

      {result.isLoading ? (
        <LoadingBlock />
      ) : result.error ? (
        <p className="text-sm text-destructive">Não foi possível carregar o detalhamento: {(result.error as Error).message}</p>
      ) : result.data?.rows.length ? (
        <div className={cn("-mx-4 overflow-x-auto md:mx-0", compact && "max-h-[60vh] overflow-y-auto")}>
          <table className="w-full text-sm" style={{ minWidth: `${Math.max(640, activeCols.length * 140)}px` }}>
            <thead className="sticky top-0 bg-card text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border">
                {activeCols.map((c) => (
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
              {result.data.rows.map((r, i) => (
                <tr key={`${r.hubspot_id ?? r.iuli_id ?? i}-${i}`} className="border-b border-border/60 align-top last:border-0">
                  {activeCols.map((c) => (
                    <td key={c.key} className={cn("px-3 py-2.5", c.align === "right" && "text-right tabular-nums")}>
                      {c.render(r, ctx)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState>Nenhuma linha com esses filtros.</EmptyState>
      )}

      {total > PAGE_SIZE && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">
            Mostrando {formatCount(page * PAGE_SIZE + 1)}–{formatCount(Math.min(total, (page + 1) * PAGE_SIZE))} de {formatCount(total)}
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
    </div>
  );
}
