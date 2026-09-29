import type { ShellSection } from "@/components/commercial/CommercialUI";

export const IULI_SECTIONS: ShellSection[] = [
  { id: "iuli/visao-geral", label: "Visão Geral" },
  { id: "iuli/vendas", label: "Vendas" },
  { id: "iuli/receber", label: "A Receber" },
  { id: "iuli/notas", label: "Notas Fiscais" },
  { id: "iuli/assinaturas", label: "Assinaturas" },
  { id: "iuli/cadastros", label: "Projetos & Cadastros" },
];

// Cores dos grupos — primária = dinheiro efetivo, âmbar = em aberto, vermelho = perdido.
export const TONE = {
  primary: "hsl(var(--primary))",
  primarySoft: "hsl(var(--primary) / 0.35)",
  amber: "hsl(38 92% 50%)",
  red: "hsl(var(--destructive))",
  muted: "hsl(var(--muted-foreground) / 0.45)",
  blue: "hsl(199 89% 48%)",
};

export const axisProps = {
  stroke: "hsl(var(--muted-foreground))",
  fontSize: 12,
  tickLine: false,
  axisLine: false,
} as const;

export const tooltipStyle = {
  contentStyle: { background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 },
  cursor: { fill: "hsl(var(--muted))" },
};
