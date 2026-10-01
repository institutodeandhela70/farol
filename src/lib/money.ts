// Valores do menu Resultado sempre com centavos (R$ 3.511.234,56). Só o eixo dos
// gráficos usa a forma abreviada.

const full = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatMoney(value: number | null | undefined): string {
  return full.format(Number.isFinite(value as number) ? (value as number) : 0);
}

/** Eixo de gráfico: 1,2 mi / 350 mil (nunca em KPI, tabela ou dica). */
export function formatAxis(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (abs >= 1_000) return `${(value / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil`;
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

export function formatCount(value: number): string {
  return value.toLocaleString("pt-BR");
}

export function formatPercent(ratio: number | null, digits = 1): string {
  if (ratio === null || !Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toLocaleString("pt-BR", { maximumFractionDigits: digits })}%`;
}
