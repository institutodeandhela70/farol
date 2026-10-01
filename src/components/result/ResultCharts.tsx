import { type KeyboardEvent, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { InfoTip } from "@/components/commercial/CommercialUI";
import type { DataSource } from "@/lib/commercialSources";
import { axisProps, tooltipStyle } from "@/components/iuli/iuliTheme";
import { Skeleton } from "@/components/ui/skeleton";
import { formatAxis, formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

// Peças clicáveis do menu Resultado: KPI, barras empilhadas/agrupadas, ranking.
// Clicar abre o detalhamento (DrillContext). Valores com centavos; só o eixo é abreviado.

export function KpiTile({
  label,
  value,
  sub,
  info,
  tone = "default",
  loading,
  onClick,
  hint = "Clique para ver as linhas",
}: {
  label: string;
  value: string;
  sub?: string;
  info?: DataSource;
  tone?: "default" | "warn";
  loading?: boolean;
  onClick?: () => void;
  hint?: string;
}) {
  const warn = tone === "warn";
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (onClick && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      onClick();
    }
  };
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      title={onClick ? hint : undefined}
      onClick={onClick}
      onKeyDown={onKey}
      className={cn(
        "flex min-w-0 flex-col gap-1 rounded-xl border p-4 transition-colors",
        warn ? "border-amber-300/70 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-950/30" : "border-border bg-card",
        onClick && "cursor-pointer hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <span className={cn("text-sm font-medium", warn ? "text-amber-800 dark:text-amber-300" : "text-muted-foreground")}>{label}</span>
        {info && (
          <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <InfoTip source={info} />
          </span>
        )}
      </div>
      {loading ? <Skeleton className="my-1 h-8 w-40" /> : <span className="break-words text-xl font-semibold tracking-tight tabular-nums md:text-2xl">{value}</span>}
      {sub && <span className={cn("text-sm", warn ? "text-amber-800 dark:text-amber-300" : "text-muted-foreground")}>{sub}</span>}
    </div>
  );
}

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
}

type ChartRow = Record<string, number | string>;

/** Barras (empilhadas ou lado a lado) por período; clicar numa barra entrega a linha e a série. */
export function ClickBarChart({
  data,
  series,
  stacked = true,
  height = "h-72",
  onBarClick,
}: {
  data: ChartRow[];
  series: ChartSeries[];
  stacked?: boolean;
  height?: string;
  onBarClick?: (row: ChartRow, seriesKey: string) => void;
}) {
  return (
    <div className={height}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="label" {...axisProps} />
          <YAxis {...axisProps} width={64} tickFormatter={formatAxis} />
          <Tooltip formatter={(v: number, name: string) => [formatMoney(v), name]} {...tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              stackId={stacked ? "stack" : undefined}
              fill={s.color}
              maxBarSize={stacked ? 56 : 40}
              radius={!stacked || i === series.length - 1 ? [6, 6, 0, 0] : [0, 0, 0, 0]}
              cursor={onBarClick ? "pointer" : undefined}
              onClick={onBarClick ? (payload: unknown) => onBarClick((payload as { payload: ChartRow }).payload, s.key) : undefined}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface CashPoint {
  label: string;
  bucket: string;
  recebido: number;
  a_vencer: number;
  vencido: number;
  acumulado: number;
}

/** Caixa: barras empilhadas por situação + linha do acumulado (eixo da direita). */
export function ClickCashChart({ data, onBarClick }: { data: CashPoint[]; onBarClick?: (row: CashPoint, situacao: "recebido" | "a_vencer" | "vencido") => void }) {
  const click = (situacao: "recebido" | "a_vencer" | "vencido") => (onBarClick ? (p: unknown) => onBarClick((p as { payload: CashPoint }).payload, situacao) : undefined);
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="label" {...axisProps} />
          <YAxis yAxisId="left" {...axisProps} width={64} tickFormatter={formatAxis} />
          <YAxis yAxisId="right" orientation="right" {...axisProps} width={64} tickFormatter={formatAxis} />
          <Tooltip formatter={(v: number, name: string) => [formatMoney(v), name]} {...tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
          <Bar yAxisId="left" dataKey="recebido" name="Recebido" stackId="s" fill="hsl(var(--primary))" maxBarSize={56} cursor="pointer" onClick={click("recebido")} />
          <Bar yAxisId="left" dataKey="a_vencer" name="A vencer" stackId="s" fill="hsl(199 89% 48%)" maxBarSize={56} cursor="pointer" onClick={click("a_vencer")} />
          <Bar yAxisId="left" dataKey="vencido" name="Vencido" stackId="s" fill="hsl(38 92% 50%)" maxBarSize={56} radius={[6, 6, 0, 0]} cursor="pointer" onClick={click("vencido")} />
          <Line yAxisId="right" type="monotone" dataKey="acumulado" name="Acumulado" stroke="hsl(var(--foreground))" strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Lista de barras horizontais (ranking): cada item é um botão que abre o detalhe. */
export function ClickBarList({
  items,
  tone = "primary",
  onItemClick,
}: {
  items: { key: string; label: string; sub?: string; value: number; display?: string; segments?: { value: number; className: string }[] }[];
  tone?: "primary" | "blue";
  onItemClick?: (key: string) => void;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const fill = tone === "blue" ? "bg-sky-500" : "bg-primary";
  return (
    <ul className="flex flex-col gap-1">
      {items.map((i) => {
        const inner: ReactNode = (
          <>
            <span className="flex justify-between gap-3 text-sm">
              <span className="truncate font-medium">{i.label}</span>
              <span className="font-semibold tabular-nums">{i.display ?? formatMoney(i.value)}</span>
            </span>
            <span className="flex h-2 w-full overflow-hidden rounded-full bg-muted" role="presentation">
              {i.segments ? (
                i.segments.map((s, idx) => <span key={idx} className={cn("h-full", s.className)} style={{ width: `${(s.value / max) * 100}%` }} />)
              ) : (
                <span className={cn("h-full rounded-full", fill)} style={{ width: `${(i.value / max) * 100}%` }} />
              )}
            </span>
            {i.sub && <span className="text-xs text-muted-foreground">{i.sub}</span>}
          </>
        );
        return (
          <li key={i.key}>
            {onItemClick ? (
              <button type="button" onClick={() => onItemClick(i.key)} className="flex w-full flex-col gap-1.5 rounded-lg px-2 py-2 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" title="Clique para ver as linhas">
                {inner}
              </button>
            ) : (
              <div className="flex flex-col gap-1.5 px-2 py-2">{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Barra de divisão em duas partes (ex.: High ticket × Demais); cada lado é clicável. */
export function SplitBar({
  left,
  right,
}: {
  left: { label: string; value: number; display: string; sub?: string; onClick?: () => void };
  right: { label: string; value: number; display: string; sub?: string; onClick?: () => void };
}) {
  const total = left.value + right.value;
  const leftPct = total > 0 ? (left.value / total) * 100 : 0;
  const Side = ({ s, color, text, align }: { s: typeof left; color: string; text: string; align?: string }) => {
    const body = (
      <>
        <span className={cn("flex items-center gap-2 font-semibold", text)}>
          <span className={cn("size-2.5 rounded-full", color)} aria-hidden />
          {s.label} · {s.display}
        </span>
        {s.sub && <span className="text-muted-foreground">{s.sub}</span>}
      </>
    );
    return s.onClick ? (
      <button type="button" onClick={s.onClick} title="Clique para ver as linhas" className={cn("flex flex-col rounded-lg px-2 py-1 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", align)}>
        {body}
      </button>
    ) : (
      <div className={cn("flex flex-col text-sm", align)}>{body}</div>
    );
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-4 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={`${left.label} ${leftPct.toFixed(1)}%, ${right.label} ${(100 - leftPct).toFixed(1)}%`}>
        <button type="button" tabIndex={-1} aria-hidden className="h-full bg-primary" style={{ width: `${leftPct}%` }} onClick={left.onClick} disabled={!left.onClick} />
        <button type="button" tabIndex={-1} aria-hidden className="h-full bg-amber-500" style={{ width: `${total > 0 ? 100 - leftPct : 0}%` }} onClick={right.onClick} disabled={!right.onClick} />
      </div>
      <div className="flex flex-wrap justify-between gap-x-6 gap-y-2">
        <Side s={left} color="bg-primary" text="text-primary" />
        <Side s={right} color="bg-amber-500" text="text-amber-700 dark:text-amber-400" align="sm:items-end sm:text-right" />
      </div>
    </div>
  );
}
