import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";

// Filtros do Dashboard Financeiro IULI — ficam na URL, então um link abre
// exatamente a mesma visão. Datas no formato YYYY-MM-DD; "hoje" no fuso de SP.

export type PeriodPreset = "hoje" | "7d" | "30d" | "mes" | "mes_passado" | "3m" | "6m" | "12m" | "ano" | "custom";
export type Grain = "day" | "week" | "month";

export const PERIOD_PRESETS: { value: Exclude<PeriodPreset, "custom">; label: string }[] = [
  { value: "hoje", label: "Hoje" },
  { value: "7d", label: "Últimos 7 dias" },
  { value: "30d", label: "Últimos 30 dias" },
  { value: "mes", label: "Este mês" },
  { value: "mes_passado", label: "Mês passado" },
  { value: "3m", label: "Últimos 3 meses" },
  { value: "6m", label: "Últimos 6 meses" },
  { value: "12m", label: "Últimos 12 meses" },
  { value: "ano", label: "Este ano" },
];

export function todaySP(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

export function addDaysISO(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function monthStart(iso: string, offsetMonths = 0): string {
  const [y, m] = iso.split("-").map(Number);
  const total = y * 12 + (m - 1) + offsetMonths;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-01`;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1;
}

export function presetRange(preset: Exclude<PeriodPreset, "custom">, today = todaySP()): { from: string; to: string } {
  switch (preset) {
    case "hoje":
      return { from: today, to: today };
    case "7d":
      return { from: addDaysISO(today, -6), to: today };
    case "30d":
      return { from: addDaysISO(today, -29), to: today };
    case "mes":
      return { from: monthStart(today), to: today };
    case "mes_passado":
      return { from: monthStart(today, -1), to: addDaysISO(monthStart(today), -1) };
    case "3m":
      return { from: monthStart(today, -2), to: today };
    case "6m":
      return { from: monthStart(today, -5), to: today };
    case "12m":
      return { from: monthStart(today, -11), to: today };
    case "ano":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
  }
}

/** Agrupamento automático do gráfico: dia até 45 dias, semana até 6 meses, mês acima. */
export function autoGrain(from: string, to: string): Grain {
  const days = daysBetween(from, to);
  if (days <= 45) return "day";
  if (days <= 186) return "week";
  return "month";
}

/** Período anterior de mesmo tamanho (pra comparar nos indicadores). */
export function previousRange(from: string, to: string) {
  const days = daysBetween(from, to);
  return { from: addDaysISO(from, -days), to: addDaysISO(from, -1) };
}

export function formatDayBR(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

export function periodText(preset: PeriodPreset, from: string, to: string) {
  const p = PERIOD_PRESETS.find((x) => x.value === preset);
  const range = from === to ? formatDayBR(from) : `${formatDayBR(from)} a ${formatDayBR(to)}`;
  return p ? `${p.label} · ${range}` : range;
}

const csv = (v: string | null) => (v ? v.split(",").filter(Boolean) : null);

export interface IuliFilters {
  preset: PeriodPreset;
  from: string;
  to: string;
  grain: Grain;
  empresa: string; // "todas" ou id da integração
  cliente: string | null;
  status: string[] | null;
  produto: string[] | null;
  origem: string[] | null;
  entreEmpresas: "excluir" | "incluir";
  // específicos de tela
  situacao: string[] | null; // A Receber: recebido | vencido | a_vencer
  nf: "com" | "sem" | null; // A Receber
  notaStatus: string[] | null; // Notas
  ciclo: string[] | null; // Assinaturas
  assinaturaStatus: string[] | null; // Assinaturas
}

export function useIuliFilters(defaultCompany: string = "todas") {
  const [params, setParams] = useSearchParams();

  const filters = useMemo<IuliFilters>(() => {
    const preset = (params.get("p") as PeriodPreset) || "mes";
    let from: string;
    let to: string;
    if (preset === "custom" && params.get("de") && params.get("ate")) {
      from = params.get("de")!;
      to = params.get("ate")!;
      if (from > to) [from, to] = [to, from];
    } else {
      ({ from, to } = presetRange(preset === "custom" ? "mes" : preset));
    }
    const empresa = params.get("empresa") || defaultCompany;
    return {
      preset: preset === "custom" && !params.get("de") ? "mes" : preset,
      from,
      to,
      grain: autoGrain(from, to),
      empresa,
      cliente: params.get("cliente") || null,
      status: csv(params.get("status")),
      produto: csv(params.get("produto")),
      origem: csv(params.get("origem")),
      entreEmpresas: (params.get("ee") as "excluir" | "incluir") || (empresa === "todas" ? "excluir" : "incluir"),
      situacao: csv(params.get("situacao")),
      nf: (params.get("nf") as "com" | "sem") || null,
      notaStatus: csv(params.get("nstatus")),
      ciclo: csv(params.get("ciclo")),
      assinaturaStatus: csv(params.get("astatus")),
    };
  }, [params, defaultCompany]);

  const set = (patch: Record<string, string | string[] | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "" || (Array.isArray(v) && !v.length)) next.delete(k);
      else next.set(k, Array.isArray(v) ? v.join(",") : v);
    }
    setParams(next, { replace: true });
  };

  return { filters, set };
}
