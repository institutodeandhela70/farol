import { useMemo } from "react";
import { usePersistentSearchParams } from "@/lib/iuliPersist";
import { addDaysISO, autoGrain, previousRange, todaySP, type Grain } from "@/lib/iuliFilters";

// Filtros do menu "Resultado" (Vendas · Receita · Caixa) — ficam na URL.
// Período: mês atual, últimos 7 dias, um mês à escolha (?m=AAAA-MM) ou personalizado.

export type ResultPreset = "mes_atual" | "7d" | "mes" | "custom";

export interface ResultFilters {
  /** Pesquisa: data de referência do período (padrão: competência). */
  base: "competencia" | "vencimento" | "pagamento" | "ganho";
  preset: ResultPreset;
  from: string;
  to: string;
  grain: Grain;
  /** Mês escolhido (AAAA-MM) quando preset = "mes". */
  month: string | null;
  /** "todas" (consolidado) ou id da integração IULI — usado por Receita e Caixa. */
  empresa: string;
  produto: string[] | null;
  owner: string | null;
  /** Receita/Caixa: tira as operações entre as empresas do grupo (padrão quando o filtro é "todas"). */
  excluirEE: boolean;
}

const MONTHS_PT = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const MONTHS_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function monthBoundsYM(ym: string): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}` };
}

export function addMonthsYM(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

export function monthLabelYM(ym: string, short = false): string {
  const [y, m] = ym.split("-").map(Number);
  return short ? `${MONTHS_SHORT[m - 1]}/${y}` : `${MONTHS_PT[m - 1]} de ${y}`;
}

/** Últimos `count` meses (do atual para trás) para o seletor. */
export function recentMonths(count = 24, today = todaySP()): string[] {
  const now = today.slice(0, 7);
  return Array.from({ length: count }, (_, i) => addMonthsYM(now, -i));
}

export function resultPeriodText(f: Pick<ResultFilters, "preset" | "from" | "to" | "month">): string {
  const br = (iso: string) => iso.split("-").reverse().join("/");
  switch (f.preset) {
    case "mes_atual":
      return `Mês atual · ${br(f.from)} a ${br(f.to)}`;
    case "7d":
      return `Últimos 7 dias · ${br(f.from)} a ${br(f.to)}`;
    case "mes":
      return `${f.month ? monthLabelYM(f.month) : ""} · ${br(f.from)} a ${br(f.to)}`;
    default:
      return `${br(f.from)} a ${br(f.to)}`;
  }
}

export function useResultFilters() {
  const [params, setParams] = usePersistentSearchParams();

  const filters = useMemo<ResultFilters>(() => {
    const today = todaySP();
    const raw = params.get("p");
    const month = /^\d{4}-\d{2}$/.test(params.get("m") ?? "") ? params.get("m")! : null;
    let preset: ResultPreset = raw === "7d" || raw === "mes" || raw === "custom" ? raw : "mes_atual";
    if (preset === "mes" && !month) preset = "mes_atual";
    if (preset === "custom" && !(params.get("de") && params.get("ate"))) preset = "mes_atual";

    let from: string;
    let to: string;
    if (preset === "7d") {
      from = addDaysISO(today, -6);
      to = today;
    } else if (preset === "mes") {
      ({ from, to } = monthBoundsYM(month!));
    } else if (preset === "custom") {
      from = params.get("de")!;
      to = params.get("ate")!;
      if (from > to) [from, to] = [to, from];
    } else {
      from = `${today.slice(0, 7)}-01`;
      to = today;
    }
    const csv = (v: string | null) => (v ? v.split(",").filter(Boolean) : null);
    return {
      preset,
      from,
      to,
      grain: autoGrain(from, to),
      month: preset === "mes" ? month : null,
      empresa: params.get("empresa") || "todas",
      produto: csv(params.get("produto")),
      owner: params.get("vendedor") || null,
      excluirEE: false,
      base: (["vencimento", "pagamento", "ganho"].includes(params.get("base") ?? "") ? params.get("base") : "competencia") as ResultFilters["base"],
    };
  }, [params]);

  const set = (patch: Record<string, string | string[] | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "" || (Array.isArray(v) && !v.length)) next.delete(k);
      else next.set(k, Array.isArray(v) ? v.join(",") : v);
    }
    setParams(next);
  };

  return { filters, set };
}

export { previousRange };
