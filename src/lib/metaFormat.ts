import type { ShellSection } from "@/components/commercial/CommercialUI";

// Formatadores e seções do menu Marketing · Meta Ads.

export const META_SECTIONS: ShellSection[] = [
  { id: "marketing/meta-ads", label: "Visão Geral" },
  { id: "marketing/meta-ads-campanhas", label: "Campanhas" },
  { id: "marketing/meta-ads-publico", label: "Público & Ações" },
];

export const brl = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const int = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : Math.round(v).toLocaleString("pt-BR"));
export const pct = (v: number | null | undefined, digits = 2) =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: digits })}%`;
export const dec = (v: number | null | undefined, digits = 2) =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toLocaleString("pt-BR", { maximumFractionDigits: digits, minimumFractionDigits: digits });
