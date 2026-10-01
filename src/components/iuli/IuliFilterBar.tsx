import { useEffect, useState, type ReactNode } from "react";
import { CalendarRange, ChevronDown, Search, X } from "lucide-react";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MultiSelect } from "@/components/commercial/CommercialUI";
import { useIuliCompanies } from "@/lib/iuli";
import { useCounterpartyRules } from "@/lib/iuliData";
import { PERIOD_PRESETS, periodText, type IuliFilters, type PeriodPreset } from "@/lib/iuliFilters";

// Barra de filtros das telas da IULI — mesmo visual dos filtros do Comercial.

const triggerClass =
  "inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-md border border-input bg-card px-3 text-sm font-medium hover:bg-accent";

type SetFilters = (patch: Record<string, string | string[] | null>) => void;

export function PeriodFilter({ filters, set }: { filters: IuliFilters; set: SetFilters }) {
  const [customOpen, setCustomOpen] = useState(false);
  const [from, setFrom] = useState(filters.from);
  const [to, setTo] = useState(filters.to);

  const label = PERIOD_PRESETS.find((p) => p.value === filters.preset)?.label ?? periodText("custom", filters.from, filters.to);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className={triggerClass} aria-label="Período">
          <CalendarRange className="size-4 text-muted-foreground" />
          {label}
          <ChevronDown className="size-4 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {PERIOD_PRESETS.map((p) => (
            <DropdownMenuItem key={p.value} onSelect={() => set({ p: p.value, de: null, ate: null })}>
              {p.label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              setFrom(filters.from);
              setTo(filters.to);
              setCustomOpen(true);
            }}
          >
            Personalizado…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={customOpen} onOpenChange={setCustomOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Período personalizado</DialogTitle>
            <DialogDescription>Escolha a data inicial e a final (as duas entram no período).</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="iuli-de">De</Label>
              <Input id="iuli-de" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="iuli-ate">Até</Label>
              <Input id="iuli-ate" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          <Button
            disabled={!from || !to}
            onClick={() => {
              set({ p: "custom" satisfies PeriodPreset, de: from <= to ? from : to, ate: from <= to ? to : from });
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

export function CompanyFilter({ filters, set }: { filters: IuliFilters; set: SetFilters }) {
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
      <option value="todas">Todas as empresas</option>
      {companies.map((c) => (
        <option key={c.id} value={c.id}>
          {c.label ?? "Empresa sem nome"}
        </option>
      ))}
    </select>
  );
}

/** Busca por cliente — aplica depois que a pessoa para de digitar. */
export function ClientFilter({ filters, set, placeholder = "Buscar cliente" }: { filters: IuliFilters; set: SetFilters; placeholder?: string }) {
  const [text, setText] = useState(filters.cliente ?? "");
  // "Limpar filtros" zera o cliente na URL → zera o campo também.
  const [applied, setApplied] = useState(filters.cliente);
  if (filters.cliente !== applied) {
    setApplied(filters.cliente);
    if (filters.cliente === null) setText("");
  }
  useEffect(() => {
    const t = setTimeout(() => {
      if ((text.trim() || null) !== filters.cliente) set({ cliente: text.trim() || null });
    }, 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input aria-label="Cliente" placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} className="h-10 w-52 bg-card pl-9" />
      {text && (
        <button type="button" aria-label="Limpar busca" onClick={() => setText("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground">
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

export function OptionFilter({
  label,
  allLabel,
  param,
  value,
  options,
  set,
}: {
  label: string;
  allLabel: string;
  param: string;
  value: string[] | null;
  options: { value: string; label: string }[];
  set: SetFilters;
}) {
  if (!options.length) return null;
  return <MultiSelect label={label} allLabel={allLabel} options={options} selected={value} onChange={(v) => set({ [param]: v })} />;
}

/** No consolidado: tirar (ou não) as operações entre as empresas do grupo. */
export function IntercompanyToggle({ filters, set }: { filters: IuliFilters; set: SetFilters }) {
  const { workspace } = useWorkspace();
  const { data: rules = [] } = useCounterpartyRules(workspace?.id);
  if (filters.empresa !== "todas" || !rules.length) return null;
  const excluding = filters.entreEmpresas === "excluir";
  return (
    <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-input bg-card px-3 text-sm font-medium" title={rules.map((r) => r.label ?? r.pattern).join(" · ")}>
      <input type="checkbox" checked={excluding} onChange={() => set({ ee: excluding ? "incluir" : "excluir" })} />
      Sem operações entre empresas
    </label>
  );
}

export function ClearFilters({ filters, set, extra = [] }: { filters: IuliFilters; set: SetFilters; extra?: string[] }) {
  const active = filters.cliente || filters.status || filters.produto || filters.origem || filters.situacao || filters.nf || filters.notaStatus || filters.ciclo || filters.assinaturaStatus;
  if (!active) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-10"
      onClick={() => set(Object.fromEntries(["cliente", "status", "produto", "origem", "situacao", "nf", "nstatus", "ciclo", "astatus", ...extra].map((k) => [k, null])))}
    >
      <X className="size-4" />
      Limpar filtros
    </Button>
  );
}

export function IuliFilterRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}
