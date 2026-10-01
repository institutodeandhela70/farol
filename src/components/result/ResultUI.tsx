import { useState, type ReactNode } from "react";
import { CalendarRange, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CommercialShell, FilterBar, type ShellSection } from "@/components/commercial/CommercialUI";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { useIuliCompanies } from "@/lib/iuli";
import { cn } from "@/lib/utils";
import { monthLabelYM, recentMonths, resultPeriodText, type ResultFilters } from "@/lib/resultFilters";

// Peças do menu "Resultado" (Vendas · Receita · Caixa): mesma casca do Comercial/IULI.

export const RESULT_SECTIONS: ShellSection[] = [
  { id: "resultado/visao-geral", label: "Visão Geral" },
  { id: "resultado/vendas", label: "Vendas" },
  { id: "resultado/receita", label: "Receita" },
  { id: "resultado/caixa", label: "Caixa" },
  { id: "resultado/produtos", label: "Produtos" },
  { id: "resultado/categorias", label: "Categorias" },
];

type SetFilters = (patch: Record<string, string | string[] | null>) => void;

const segBase = "inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-md px-3.5 text-sm font-medium transition-colors";
const segOn = "bg-primary text-primary-foreground";
const segOff = "text-muted-foreground hover:bg-accent hover:text-foreground";

export function ResultShell({
  title,
  description,
  filters,
  children,
}: {
  title: string;
  description?: string;
  filters?: ReactNode;
  children: ReactNode;
}) {
  return (
    <CommercialShell eyebrow="Resultado" sections={RESULT_SECTIONS} title={title} description={description} filters={filters ? <FilterBar>{filters}</FilterBar> : undefined}>
      {children}
    </CommercialShell>
  );
}

/** Barra de período: Mês (qualquer mês) · Últimos 7 dias · Mês atual · Personalizado. */
export function ResultPeriodBar({ filters, set }: { filters: ResultFilters; set: SetFilters }) {
  const [customOpen, setCustomOpen] = useState(false);
  const [from, setFrom] = useState(filters.from);
  const [to, setTo] = useState(filters.to);
  const months = recentMonths(24);

  return (
    <>
      <div role="group" aria-label="Período" className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-border bg-card p-1">
        <DropdownMenu>
          <DropdownMenuTrigger className={cn(segBase, filters.preset === "mes" ? segOn : segOff)} aria-label="Escolher mês">
            <CalendarRange className="size-4" />
            {filters.preset === "mes" && filters.month ? monthLabelYM(filters.month, true) : "Mês"}
            <ChevronDown className="size-4 opacity-70" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
            {months.map((ym) => (
              <DropdownMenuItem key={ym} onSelect={() => set({ p: "mes", m: ym, de: null, ate: null })}>
                {monthLabelYM(ym)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <button type="button" className={cn(segBase, filters.preset === "7d" ? segOn : segOff)} onClick={() => set({ p: "7d", m: null, de: null, ate: null })}>
          Últimos 7 dias
        </button>
        <button type="button" className={cn(segBase, filters.preset === "mes_atual" ? segOn : segOff)} onClick={() => set({ p: "mes_atual", m: null, de: null, ate: null })}>
          Mês atual
        </button>
        <button
          type="button"
          className={cn(segBase, filters.preset === "custom" ? segOn : segOff)}
          onClick={() => {
            setFrom(filters.from);
            setTo(filters.to);
            setCustomOpen(true);
          }}
        >
          Personalizado
        </button>
      </div>

      <Dialog open={customOpen} onOpenChange={setCustomOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Período personalizado</DialogTitle>
            <DialogDescription>Escolha a data inicial e a final (as duas entram no período).</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="res-de">De</Label>
              <Input id="res-de" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="res-ate">Até</Label>
              <Input id="res-ate" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          <Button
            disabled={!from || !to}
            onClick={() => {
              set({ p: "custom", m: null, de: from <= to ? from : to, ate: from <= to ? to : from });
              setCustomOpen(false);
            }}
          >
            Aplicar
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

export { resultPeriodText };


/** Empresa da IULI: consolidado (todas) ou cada uma. */
export function ResultCompanyFilter({ filters, set }: { filters: ResultFilters; set: SetFilters }) {
  const { workspace } = useWorkspace();
  const { data: companies = [] } = useIuliCompanies(workspace?.id);
  if (companies.length < 2) return null;
  return (
    <select
      aria-label="Empresa"
      value={filters.empresa}
      onChange={(e) => set({ empresa: e.target.value === "todas" ? null : e.target.value, ee: null })}
      className="h-10 max-w-[16rem] rounded-md border border-input bg-card px-3 text-sm font-medium"
    >
      <option value="todas">Todas as empresas (consolidado)</option>
      {companies.map((c) => (
        <option key={c.id} value={c.id}>
          {c.label ?? "Empresa sem nome"}
        </option>
      ))}
    </select>
  );
}
