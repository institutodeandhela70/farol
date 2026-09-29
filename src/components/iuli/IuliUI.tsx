import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CommercialShell, EmptyState, FilterBar, LoadingBlock, WarnNote } from "@/components/commercial/CommercialUI";
import { axisProps, IULI_SECTIONS, tooltipStyle } from "@/components/iuli/iuliTheme";
import { formatDateTime, useIuliCompanies, useIuliRefresh, useIuliSelectedCompany, type IuliIntegration } from "@/lib/iuli";
import { useIuliLoadStatus, type CompanyLoadStatus } from "@/lib/iuliData";

const TASK_LABEL: Record<string, string> = {
  "sales:full": "vendas",
  "receivables:full": "títulos",
  "invoices:full": "notas",
};

/** Seletor de uma empresa só — usado nas telas que ainda leem os totais fixos (Projetos & Cadastros). */
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

function SyncStatus({ companies, status }: { companies: IuliIntegration[]; status: Map<string, CompanyLoadStatus> | undefined }) {
  const { workspace } = useWorkspace();
  const refresh = useIuliRefresh(workspace?.id, companies.map((c) => c.id));
  const newest = companies.map((c) => status?.get(c.id)?.lastRecordsSync).filter((d): d is string => !!d).sort().at(-1);

  let message: string | null = null;
  if (refresh.isPending) message = "Buscando na IULI… pode levar até 2 minutos por empresa.";
  else if (refresh.isError) message = `Falha ao atualizar: ${(refresh.error as Error).message}`;
  else if (refresh.data?.pausedUntil)
    message = `A IULI pediu uma pausa (limite de consultas). Voltamos a buscar às ${new Date(refresh.data.pausedUntil).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.`;
  else if (refresh.data?.busy) message = "Já tem uma atualização rodando — os dados chegam em instantes.";
  else if (refresh.data) message = "Atualizado.";

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground md:ml-auto">
      <span>{newest ? `Dados da IULI · ${formatDateTime(newest)}` : "Ainda sem dados da IULI"}</span>
      <Button size="sm" variant="outline" onClick={() => refresh.mutate()} disabled={refresh.isPending || !companies.length}>
        <RefreshCw className={cn("size-4", refresh.isPending && "animate-spin")} />
        Atualizar agora
      </Button>
      {message && <span className={cn("w-full md:w-auto", refresh.isError && "text-destructive")}>{message}</span>}
    </div>
  );
}

/** Carga inicial em andamento e divergências da conferência, por empresa. */
function DataStatus({ companies, status }: { companies: IuliIntegration[]; status: Map<string, CompanyLoadStatus> | undefined }) {
  const loading = companies.filter((c) => status && !status.get(c.id)?.initialLoadDone);
  const mismatched = companies.filter((c) => (status?.get(c.id)?.mismatches.length ?? 0) > 0);
  if (!loading.length && !mismatched.length) return null;
  return (
    <div className="flex flex-col gap-2">
      {loading.length > 0 && (
        <WarnNote>
          <strong>Carga inicial em andamento</strong> — os números abaixo ainda estão incompletos.{" "}
          {loading
            .map((c) => {
              const parts = (status?.get(c.id)?.progress ?? [])
                .filter((p) => TASK_LABEL[p.task])
                .map((p) => `${TASK_LABEL[p.task]} ${p.done ? "100%" : p.total ? `${Math.min(99, Math.floor((p.rows / p.total) * 100))}%` : "…"}`);
              return `${c.label ?? "Empresa"}: ${parts.length ? parts.join(", ") : "começando"}`;
            })
            .join(" · ")}
          . A carga segue sozinha, no ritmo que a IULI permite.
        </WarnNote>
      )}
      {mismatched.map((c) => {
        const s = status!.get(c.id)!;
        return (
          <WarnNote key={c.id}>
            <strong>{c.label}: {s.mismatches.length} divergência(s) com os totais da IULI</strong> na última conferência
            {s.checkedAt ? ` (${formatDateTime(s.checkedAt)})` : ""}. O Farol já está relendo esses períodos; se persistir, é diferença de regra entre os dois lados.
          </WarnNote>
        );
      })}
    </div>
  );
}

export function IuliShell({
  title,
  description,
  filters,
  children,
  scope,
  singleCompany = false,
}: {
  title: string;
  description?: string;
  filters?: ReactNode;
  children: ReactNode;
  /** Empresa do filtro ("todas" ou id) — define quais empresas o status e o "Atualizar" cobrem. */
  scope?: string;
  /** Tela que lê os totais fixos de uma empresa por vez (usa o seletor simples). */
  singleCompany?: boolean;
}) {
  const { workspace } = useWorkspace();
  const companiesQuery = useIuliCompanies(workspace?.id);
  const selected = useIuliSelectedCompany(workspace?.id).selected;
  const { data: status } = useIuliLoadStatus(workspace?.id);
  const all = companiesQuery.data ?? [];
  const inScope = singleCompany ? (selected ? [selected] : []) : scope && scope !== "todas" ? all.filter((c) => c.id === scope) : all;

  const notConnected = !companiesQuery.isLoading && all.length === 0;

  return (
    <CommercialShell
      eyebrow="Financeiro · IULI"
      sections={IULI_SECTIONS}
      title={title}
      description={description}
      filters={
        notConnected ? undefined : (
          <div className="flex flex-col gap-3">
            <FilterBar>
              {singleCompany && <CompanySelect />}
              {filters}
              <SyncStatus companies={inScope} status={status} />
            </FilterBar>
            {!singleCompany && <DataStatus companies={inScope} status={status} />}
          </div>
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
      ) : companiesQuery.isLoading ? (
        <LoadingBlock className="h-96" />
      ) : (
        children
      )}
    </CommercialShell>
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
