import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

// Peças dos painéis de lançamento (DP100K / IPL Fortaleza): selos, mini-cartões, barras e seletores.

export type PillTone = "good" | "warn" | "crit" | "neu";

const PILL: Record<PillTone, string> = {
  good: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
  warn: "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-300",
  crit: "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300",
  neu: "bg-muted text-muted-foreground",
};

export function Pill({ tone = "neu", children }: { tone?: PillTone; children: ReactNode }) {
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold", PILL[tone])}>{children}</span>;
}

/** Bloco cuja fonte de dados ainda não existe no FAROL — fica visível e explica o motivo. */
export function SemFonte({ children, inline }: { children?: ReactNode; inline?: boolean }) {
  return inline ? (
    <span title={typeof children === "string" ? children : "Fonte ainda não integrada ao FAROL"} className="cursor-help rounded border border-dashed border-border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      sem fonte
    </span>
  ) : (
    <div className="flex flex-col gap-1 rounded-lg border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">
      <span className="text-xs font-semibold uppercase tracking-wide">Sem fonte de dados</span>
      <span>{children}</span>
    </div>
  );
}

export function Tile({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "warn" }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1 rounded-xl border p-4", tone === "warn" ? "border-amber-300/70 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-950/30" : "border-border bg-card")}>
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      <span className="break-words text-xl font-semibold tracking-tight tabular-nums md:text-2xl">{value}</span>
      {sub && <span className="text-sm text-muted-foreground">{sub}</span>}
    </div>
  );
}

/** Grupo de botões segmentados (abas, ordenação, filtros). */
export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; label?: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={cn("h-9 whitespace-nowrap rounded-md px-3.5 text-sm font-medium transition-colors", value === o.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export interface BarItem {
  key: string;
  label: string;
  txt: ReactNode;
  a: number;
  b?: number | null;
  color?: string;
  dim?: boolean;
  swatch?: string;
}

/** Barras horizontais; com `b`, mostra uma segunda barra cinza atrás (ex.: investimento × receita). */
export function Bars({ items, empty }: { items: BarItem[]; empty?: string }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">{empty ?? "Sem dados."}</p>;
  const mx = Math.max(1, ...items.map((i) => Math.max(i.a || 0, i.b || 0)));
  return (
    <ul className="flex flex-col gap-3">
      {items.map((i) => (
        <li key={i.key} className={cn("flex flex-col gap-1.5", i.dim && "opacity-55")}>
          <div className="flex justify-between gap-3 text-sm">
            <span className="flex items-center gap-1.5 truncate">
              {i.swatch && <i className="inline-block size-2.5 shrink-0 rounded-sm" style={{ background: i.swatch }} />}
              {i.label}
            </span>
            <span className="shrink-0 font-semibold tabular-nums">{i.txt}</span>
          </div>
          <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
            {i.b != null && <span className="absolute inset-y-0 left-0 rounded-full bg-muted-foreground/30" style={{ width: `${(100 * (i.b || 0)) / mx}%` }} />}
            <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(100 * (i.a || 0)) / mx}%`, background: i.color ?? "hsl(var(--primary))" }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function DateRange({ from, to, min, max, onChange }: { from: string; to: string; min?: string; max?: string; onChange: (from: string, to: string) => void }) {
  const cls = "h-10 rounded-md border border-input bg-card px-3 text-sm font-medium";
  return (
    <div className="inline-flex items-center gap-2">
      <input type="date" className={cls} value={from} min={min} max={max} onChange={(e) => e.target.value && onChange(e.target.value, to)} />
      <span className="text-sm text-muted-foreground">até</span>
      <input type="date" className={cls} value={to} min={min} max={max} onChange={(e) => e.target.value && onChange(from, e.target.value)} />
    </div>
  );
}
