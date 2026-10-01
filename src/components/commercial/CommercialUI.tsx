import { useMemo, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, ChevronDown, Info, Search } from "lucide-react";
import type { DataSource } from "@/lib/commercialSources";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  addMonths,
  currentYM,
  daysInMonth,
  dayLabelLong,
  formatBRLShort,
  formatInt,
  formatPct,
  monthLabel,
  ymOf,
  type CommercialFilters,
  type CustomerRow,
  type SalesPipeline,
} from "@/lib/commercial";

// ---------------------------------------------------------------------------
// Navegação da seção (no celular o menu lateral não aparece — vira abas roláveis)
// ---------------------------------------------------------------------------

export interface ShellSection {
  id: string;
  label: string;
}

const COMMERCIAL_SECTIONS: ShellSection[] = [
  { id: "comercial/visao-geral", label: "Visão Geral" },
  { id: "comercial/agenda", label: "Agenda" },
  { id: "comercial/pipeline", label: "Pipeline" },
  { id: "comercial/fechamento", label: "Fechamento" },
  { id: "comercial/vendedor", label: "Vendedor" },
  { id: "comercial/metas", label: "Metas" },
];

function SectionTabs({ label, sections }: { label: string; sections: ShellSection[] }) {
  const location = useLocation();
  const current = location.pathname.replace(/^\//, "");
  return (
    <nav aria-label={`Seções de ${label}`} className="-mx-4 overflow-x-auto px-4 md:hidden">
      <div className="flex w-max gap-1.5">
        {sections.map((s) => (
          <Link
            key={s.id}
            to={{ pathname: `/${s.id}`, search: location.search }}
            className={cn(
              "whitespace-nowrap rounded-full border px-3.5 py-2 text-sm font-medium",
              current === s.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground",
            )}
          >
            {s.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

export function CommercialShell({
  title,
  description,
  filters,
  children,
  eyebrow = "Comercial",
  sections = COMMERCIAL_SECTIONS,
}: {
  title: string;
  description?: string;
  filters?: ReactNode;
  children: ReactNode;
  eyebrow?: string;
  sections?: ShellSection[];
}) {
  return (
    <div className="flex flex-col gap-5 p-4 md:p-6 lg:p-8">
      <header className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-muted-foreground">{eyebrow}</span>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        <SectionTabs label={eyebrow} sections={sections} />
        {filters}
      </header>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filtros
// ---------------------------------------------------------------------------

const triggerClass =
  "inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-md border border-input bg-card px-3 text-sm font-medium hover:bg-accent";

interface PeriodOption {
  value: string;
  label: string;
}

function periodOptions(): { presets: PeriodOption[]; months: PeriodOption[] } {
  const now = currentYM();
  const year = now.slice(0, 4);
  const presets = [
    { value: `${now}|${now}`, label: "Mês atual" },
    { value: `${addMonths(now, -2)}|${now}`, label: "Últimos 3 meses" },
    { value: `${addMonths(now, -5)}|${now}`, label: "Últimos 6 meses" },
    { value: `${year}-01|${now}`, label: `Ano de ${year}` },
  ];
  const months = Array.from({ length: 18 }, (_, i) => {
    const ym = addMonths(now, -i);
    return { value: `${ym}|${ym}`, label: monthLabel(ym, true) };
  });
  return { presets, months };
}

export interface PeriodPatch {
  from: string;
  to: string;
  fromDay: string | null;
  toDay: string | null;
}

export function PeriodSelect({
  from,
  to,
  fromDay,
  toDay,
  onChange,
  allowDayPicker = false,
}: {
  from: string;
  to: string;
  fromDay?: string | null;
  toDay?: string | null;
  onChange: (patch: PeriodPatch) => void;
  /** Mostra o seletor "Período personalizado (por dia)". Só ligue em telas cujos dados já
   * respeitam fromDay/toDay — hoje só a Visão Geral. Nas demais o filtro viraria alcance de
   * mês mesmo que o usuário escolha dias, dando números errados. */
  allowDayPicker?: boolean;
}) {
  const { presets, months } = periodOptions();
  const dayMode = !!(fromDay && toDay);
  const value = `${from}|${to}`;
  const current = !dayMode ? [...presets, ...months].find((o) => o.value === value) : undefined;
  const label = dayMode
    ? `${dayLabelLong(fromDay!)} a ${dayLabelLong(toDay!)}`
    : (current?.label ?? (from === to ? monthLabel(from, true) : `${monthLabel(from)} a ${monthLabel(to)}`));

  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(fromDay ?? `${from}-01`);
  const [draftTo, setDraftTo] = useState(toDay ?? `${to}-${String(daysInMonth(to)).padStart(2, "0")}`);

  const selectPreset = (f: string, t: string) => onChange({ from: f, to: t, fromDay: null, toDay: null });

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setDraftFrom(fromDay ?? `${from}-01`);
          setDraftTo(toDay ?? `${to}-${String(daysInMonth(to)).padStart(2, "0")}`);
        }
      }}
    >
      <DropdownMenuTrigger className={triggerClass} aria-label="Período">
        {label}
        <ChevronDown className="size-4 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-96 overflow-y-auto">
        {presets.map((o) => (
          <DropdownMenuItem key={o.label} onSelect={() => selectPreset(...(o.value.split("|") as [string, string]))}>
            {o.label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Mês</DropdownMenuLabel>
        {months.map((o) => (
          <DropdownMenuItem key={o.value} onSelect={() => selectPreset(...(o.value.split("|") as [string, string]))}>
            {o.label}
          </DropdownMenuItem>
        ))}
        {allowDayPicker && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Período personalizado (por dia){dayMode ? " · ativo" : ""}</DropdownMenuLabel>
            <div className="flex flex-col gap-2 px-2 pb-2 pt-1">
              <div className="flex items-center gap-2">
                <label className="flex flex-1 flex-col gap-1 text-xs text-muted-foreground">
                  De
                  <input
                    type="date"
                    value={draftFrom}
                    onChange={(e) => setDraftFrom(e.target.value)}
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
                  />
                </label>
                <label className="flex flex-1 flex-col gap-1 text-xs text-muted-foreground">
                  Até
                  <input
                    type="date"
                    value={draftTo}
                    onChange={(e) => setDraftTo(e.target.value)}
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
                  />
                </label>
              </div>
              <button
                type="button"
                disabled={!draftFrom || !draftTo}
                onClick={() => {
                  const [f, t] = draftFrom <= draftTo ? [draftFrom, draftTo] : [draftTo, draftFrom];
                  onChange({ from: ymOf(f), to: ymOf(t), fromDay: f, toDay: t });
                  setOpen(false);
                }}
                className="h-9 rounded-md bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                Aplicar
              </button>
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function OwnerSelect({
  value,
  owners,
  onChange,
  allowAll = true,
  placeholder = "Todos os vendedores",
}: {
  value: string | null;
  owners: { id: string; name: string }[];
  onChange: (owner: string | null) => void;
  allowAll?: boolean;
  placeholder?: string;
}) {
  return (
    <select
      aria-label="Vendedor"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      className="h-10 max-w-[16rem] rounded-md border border-input bg-card px-3 text-sm font-medium"
    >
      {allowAll ? <option value="">{placeholder}</option> : !value && <option value="">{placeholder}</option>}
      {owners.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}

export function MultiSelect({
  label,
  allLabel,
  options,
  selected,
  onChange,
}: {
  label: string;
  allLabel: string;
  options: { value: string; label: string }[];
  selected: string[] | null;
  onChange: (values: string[] | null) => void;
}) {
  const active = new Set(selected ?? []);
  const text = !selected?.length ? allLabel : selected.length === 1 ? options.find((o) => o.value === selected[0])?.label ?? "1 selecionado" : `${selected.length} selecionados`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={triggerClass} aria-label={label}>
        <span className="max-w-[14rem] truncate">{text}</span>
        <ChevronDown className="size-4 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
        <DropdownMenuItem onSelect={() => onChange(null)}>{allLabel}</DropdownMenuItem>
        <DropdownMenuSeparator />
        {options.map((o) => (
          <DropdownMenuCheckboxItem
            key={o.value}
            checked={active.has(o.value)}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={(checked) => {
              const next = new Set(active);
              if (checked) next.add(o.value);
              else next.delete(o.value);
              onChange(next.size ? [...next] : null);
            }}
          >
            {o.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function PipelineSelect({
  pipelines,
  selected,
  onChange,
}: {
  pipelines: SalesPipeline[];
  selected: string[] | null;
  onChange: (values: string[] | null) => void;
}) {
  const sales = pipelines.filter((p) => p.countsAsSales);
  return (
    <MultiSelect
      label="Pipelines"
      allLabel={`Pipelines de venda (${sales.length})`}
      options={sales.map((p) => ({ value: p.id, label: p.label }))}
      selected={selected}
      onChange={onChange}
    />
  );
}

export function AttributionToggle({ value, onChange }: { value: CommercialFilters["attribution"]; onChange: (v: CommercialFilters["attribution"]) => void }) {
  return (
    <div role="group" aria-label="Atribuir venda a" className="flex h-10 items-center rounded-md border border-input bg-card p-1">
      {(["owner", "closer"] as const).map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={cn(
            "h-full rounded px-3 text-sm font-medium transition-colors",
            value === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {v === "owner" ? "Dono" : "Closer"}
        </button>
      ))}
    </div>
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

// ---------------------------------------------------------------------------
// Origem do dado (ícone "i") — abre por clique/toque, funciona no celular
// ---------------------------------------------------------------------------

export function InfoTip({ source }: { source: DataSource }) {
  const systems = [...new Set(source.fields.map((f) => f.system))];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`De onde vem: ${source.title}`}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Info className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <div className="flex flex-col gap-3 p-4 text-sm">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Origem do dado</span>
            <span className="font-semibold">{source.title}</span>
            <span className="text-xs text-muted-foreground">{systems.join(" · ")}</span>
          </div>
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {source.fields.map((f) => (
              <li key={`${f.system}-${f.name}`} className="flex flex-col gap-0.5 px-3 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{f.label}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{f.system.replace(/^HubSpot · /, "")}</span>
                </div>
                <code className="break-all font-mono text-xs text-primary">{f.name}</code>
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Como é calculado</span>
            <p className="leading-relaxed">{source.rule}</p>
          </div>
          {source.note && <p className="rounded-md bg-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground">{source.note}</p>}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------------------
// Blocos visuais
// ---------------------------------------------------------------------------

export function Panel({
  title,
  info,
  action,
  className,
  children,
}: {
  title?: string;
  info?: DataSource;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-4 rounded-xl border border-border bg-card p-4 md:p-5", className)}>
      {(title || action) && (
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          {title && (
            <div className="flex items-center gap-1.5">
              <h2 className="text-base font-semibold">{title}</h2>
              {info && <InfoTip source={info} />}
            </div>
          )}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function KpiCard({
  label,
  value,
  sub,
  change,
  tone = "default",
  loading,
  info,
}: {
  label: string;
  value: string;
  sub?: string;
  change?: number | null;
  tone?: "default" | "warn";
  loading?: boolean;
  info?: DataSource;
}) {
  const warn = tone === "warn";
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1 rounded-xl border p-4",
        warn ? "border-amber-300/70 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-950/30" : "border-border bg-card",
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <span className={cn("text-sm font-medium", warn ? "text-amber-800 dark:text-amber-300" : "text-muted-foreground")}>{label}</span>
        {info && <InfoTip source={info} />}
      </div>
      {loading ? (
        <Skeleton className="my-1 h-8 w-28" />
      ) : (
        <span className="truncate text-2xl font-semibold tracking-tight md:text-[1.75rem]">{value}</span>
      )}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
        {change !== undefined && change !== null && !loading && (
          <span className={cn("inline-flex items-center font-medium", change >= 0 ? "text-primary" : "text-destructive")}>
            {change >= 0 ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}
            {formatPct(Math.abs(change))}
          </span>
        )}
        {sub && <span className={cn(warn ? "text-amber-800 dark:text-amber-300" : "text-muted-foreground")}>{sub}</span>}
      </div>
    </div>
  );
}

export function ProgressBar({ ratio, tone = "primary" }: { ratio: number | null; tone?: "primary" | "blue" }) {
  const pct = Math.max(0, Math.min(1, ratio ?? 0)) * 100;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="presentation">
      <div
        className={cn("h-full rounded-full", tone === "blue" ? "bg-sky-600 dark:bg-sky-400" : "bg-primary")}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function WarnNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-2.5 rounded-lg border border-amber-300/70 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-200">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div className="leading-relaxed">{children}</div>
    </div>
  );
}

export function LoadingBlock({ className }: { className?: string }) {
  return <Skeleton className={cn("h-48 w-full", className)} />;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{children}</p>;
}

// ---------------------------------------------------------------------------
// Mapa de calor (vendedor × mês)
// ---------------------------------------------------------------------------

export function Heatmap({
  rows,
  months,
  format,
  onRowClick,
}: {
  rows: { id: string; name: string; values: number[]; total: number; warn?: boolean }[];
  months: string[];
  format: (v: number) => string;
  onRowClick?: (id: string) => void;
}) {
  const max = Math.max(1, ...rows.filter((r) => !r.warn).flatMap((r) => r.values));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-separate border-spacing-1 text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-muted-foreground">
            <th className="w-48 text-left font-medium">Vendedor</th>
            {months.map((m) => (
              <th key={m} className="text-center font-medium">
                {monthLabel(m)}
              </th>
            ))}
            <th className="text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <th scope="row" className="max-w-48 truncate text-left font-medium">
                {onRowClick && !r.warn ? (
                  <button type="button" className="truncate text-left hover:text-primary hover:underline" onClick={() => onRowClick(r.id)}>
                    {r.name}
                  </button>
                ) : (
                  <span className={cn(r.warn && "text-amber-700 dark:text-amber-400")}>{r.name}</span>
                )}
              </th>
              {r.values.map((v, i) => {
                const a = v / max;
                const strong = !r.warn && a > 0.55;
                return (
                  <td
                    key={months[i]}
                    className={cn(
                      "h-10 rounded-md text-center font-medium tabular-nums",
                      v === 0 && "text-muted-foreground/60",
                      r.warn && v > 0 && "bg-amber-200 text-amber-950 dark:bg-amber-500/70",
                      strong && "text-primary-foreground",
                    )}
                    style={!r.warn && v > 0 ? { background: `hsl(var(--primary) / ${(0.1 + Math.min(a, 1) * 0.85).toFixed(2)})` } : undefined}
                  >
                    {v === 0 ? "—" : format(v)}
                  </td>
                );
              })}
              <td className="text-right font-semibold tabular-nums">{format(r.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Barras horizontais simples (ranking / funil)
// ---------------------------------------------------------------------------

export function BarList({
  items,
  tone = "primary",
}: {
  items: { key: string; label: string; value: number; display: string }[];
  tone?: "primary" | "blue";
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="flex flex-col gap-3">
      {items.map((i) => (
        <li key={i.key} className="flex flex-col gap-1.5">
          <div className="flex justify-between gap-3 text-sm">
            <span className="truncate">{i.label}</span>
            <span className="font-semibold tabular-nums">{i.display}</span>
          </div>
          <ProgressBar ratio={i.value / max} tone={tone} />
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Visão por cliente — quanto cada cliente pagou e o que comprou, no período.
// ---------------------------------------------------------------------------

export function CustomerTable({ rows, loading, ownerName }: { rows: CustomerRow[]; loading: boolean; ownerName: (id: string) => string }) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) => r.customer_name.toLowerCase().includes(q) || r.produto.toLowerCase().includes(q) || (r.customer_email ?? "").toLowerCase().includes(q),
    );
  }, [rows, search]);

  const hasUnlinked = rows.some((r) => r.contact_id === "(sem contato)");

  if (loading) return <LoadingBlock />;

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por cliente ou produto..."
          className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm"
        />
      </div>

      {hasUnlinked && (
        <p className="text-xs text-muted-foreground">
          "Sem contato vinculado" = negócio sem um contato associado na HubSpot (ou que ainda não passou pelo vínculo).
        </p>
      )}

      {filtered.length === 0 ? (
        <EmptyState>Nenhum cliente encontrado.</EmptyState>
      ) : (
        <div className="-mx-4 max-h-96 overflow-y-auto overflow-x-auto md:mx-0">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="sticky top-0 bg-card text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-4 py-2 font-medium md:pl-0">Cliente</th>
                <th className="px-3 py-2 font-medium">Produto</th>
                <th className="px-3 py-2 font-medium">Vendedor</th>
                <th className="px-3 py-2 text-right font-medium">Negócios</th>
                <th className="px-4 py-2 text-right font-medium md:pr-0">Total pago</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={`${r.contact_id}-${r.produto}-${r.owner_id}-${i}`} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-2.5 md:pl-0">
                    <div className="flex flex-col">
                      <span className="font-medium">{r.customer_name}</span>
                      {r.customer_email && <span className="text-xs text-muted-foreground">{r.customer_email}</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">{r.produto}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{ownerName(r.owner_id)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatInt(r.deal_count)}</td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums md:pr-0">{formatBRLShort(r.total_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
