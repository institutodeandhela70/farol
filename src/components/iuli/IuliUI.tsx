import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CommercialShell, EmptyState, FilterBar, LoadingBlock } from "@/components/commercial/CommercialUI";
import { axisProps, IULI_SECTIONS, tooltipStyle } from "@/components/iuli/iuliTheme";
import { formatDateTime, useIuliIntegration, useIuliRefresh, useIuliSelectedCompany, useIuliSnapshots } from "@/lib/iuli";

function CompanySelect() {
  const { workspace } = useWorkspace();
  const { companies, selected, select } = useIuliSelectedCompany(workspace?.id);
  if (companies.length < 2) return null;
  return (
    <select
      aria-label="Empresa"
      value={selected?.id ?? ""}
      onChange={(e) => select(e.target.value)}
      className="h-10 max-w-[16rem] rounded-md border border-input bg-card px-3 text-sm font-medium"
    >
      {companies.map((c) => (
        <option key={c.id} value={c.id}>
          {c.label ?? "Empresa sem nome"}
        </option>
      ))}
    </select>
  );
}

function SyncStatus() {
  const { workspace } = useWorkspace();
  const integration = useIuliIntegration(workspace?.id);
  const snapshots = useIuliSnapshots(workspace?.id);
  const refresh = useIuliRefresh(workspace?.id, integration.data?.id);

  const fetched = [...(snapshots.data?.values() ?? [])].map((s) => s.fetched_at).filter((d): d is string => !!d).sort();
  const newest = fetched.at(-1);

  let message: string | null = null;
  if (refresh.isPending) message = "Buscando na IULI… pode levar até 2 minutos.";
  else if (refresh.isError) message = `Falha ao atualizar: ${(refresh.error as Error).message}`;
  else if (refresh.data?.pausedUntil)
    message = `A IULI pediu uma pausa (limite de consultas). Voltamos a buscar às ${new Date(refresh.data.pausedUntil).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.`;
  else if (refresh.data?.busy) message = "Já tem uma atualização rodando — os dados chegam em instantes.";
  else if (refresh.data) message = refresh.data.remaining ? `${refresh.data.refreshed} consulta(s) atualizada(s); o resto continua em segundo plano.` : "Tudo atualizado.";

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground md:ml-auto">
      <span>{newest ? `Dados da IULI · ${formatDateTime(newest)}` : "Ainda sem dados da IULI"}</span>
      <Button size="sm" variant="outline" onClick={() => refresh.mutate()} disabled={refresh.isPending || !integration.data}>
        <RefreshCw className={cn("size-4", refresh.isPending && "animate-spin")} />
        Atualizar agora
      </Button>
      {message && <span className={cn("w-full md:w-auto", refresh.isError && "text-destructive")}>{message}</span>}
    </div>
  );
}

export function IuliShell({
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
  const { workspace } = useWorkspace();
  const integration = useIuliIntegration(workspace?.id);
  const snapshots = useIuliSnapshots(workspace?.id);

  const notConnected = !integration.isLoading && !integration.data;
  const empty = !snapshots.isLoading && (snapshots.data?.size ?? 0) === 0;

  return (
    <CommercialShell
      eyebrow="Financeiro · IULI"
      sections={IULI_SECTIONS}
      title={title}
      description={description}
      filters={
        notConnected ? undefined : (
          <FilterBar>
            <CompanySelect />
            {filters}
            <SyncStatus />
          </FilterBar>
        )
      }
    >
      {notConnected ? (
        <EmptyState>
          A IULI ainda não está conectada neste workspace.{" "}
          <Link to="/settings/integracoes" className="font-medium text-primary hover:underline">
            Conectar em Integrações
          </Link>
        </EmptyState>
      ) : snapshots.isLoading ? (
        <LoadingBlock className="h-96" />
      ) : empty ? (
        <EmptyState>Os dados da IULI ainda não foram buscados. Clique em "Atualizar agora" — a primeira carga leva alguns minutos.</EmptyState>
      ) : (
        children
      )}
    </CommercialShell>
  );
}

/** Seletor simples de período das telas da IULI (mês a mês + atalhos). */
export function PeriodPicker({ value, options, onChange }: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <select
      aria-label="Período"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-10 rounded-md border border-input bg-card px-3 text-sm font-medium"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export interface StackSeries {
  key: string;
  label: string;
  color: string;
}

/** Barras empilhadas por mês (vendas por grupo, recebido × em aberto, notas por status). */
export function StackedMonthChart({
  data,
  series,
  format,
  height = "h-72",
}: {
  data: Record<string, number | string>[];
  series: StackSeries[];
  format: (v: number) => string;
  height?: string;
}) {
  return (
    <div className={height}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="label" {...axisProps} />
          <YAxis {...axisProps} width={68} tickFormatter={(v: number) => format(v).replace("R$ ", "")} />
          <Tooltip formatter={(v: number, name: string) => [format(v), name]} {...tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              stackId="stack"
              fill={s.color}
              maxBarSize={56}
              radius={i === series.length - 1 ? [6, 6, 0, 0] : [0, 0, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Barras lado a lado por mês (ex: vendido × recebido). */
export function GroupedMonthChart({
  data,
  series,
  format,
  tooltipFormat = format,
  height = "h-64",
}: {
  data: Record<string, number | string>[];
  series: StackSeries[];
  format: (v: number) => string;
  tooltipFormat?: (v: number) => string;
  height?: string;
}) {
  return (
    <div className={height}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="label" {...axisProps} />
          <YAxis {...axisProps} width={68} tickFormatter={(v: number) => format(v).replace("R$ ", "")} />
          <Tooltip formatter={(v: number, name: string) => [tooltipFormat(v), name]} {...tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
          {series.map((s) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[6, 6, 0, 0]} maxBarSize={40} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function StatusPill({ tone, children }: { tone: "ok" | "warn" | "bad" | "neutral"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        tone === "ok" && "bg-primary/10 text-primary",
        tone === "warn" && "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
        tone === "bad" && "bg-destructive/10 text-destructive",
        tone === "neutral" && "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}
