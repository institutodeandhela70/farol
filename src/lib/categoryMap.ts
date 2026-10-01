import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// De-para categoria da IULI → produto do Farol (migration 20260930180000).

export type Treatment = "soma" | "fora_outros_produtos" | "a_classificar" | "nao_operacional" | "revisar";

export const TREATMENT_LABEL: Record<Treatment, string> = {
  soma: "Receita de produto (entra na soma)",
  fora_outros_produtos: "Outras receitas / Outros Produtos (fora da soma)",
  a_classificar: "A classificar (fora da soma)",
  nao_operacional: "Não operacional (fora da soma)",
  revisar: "A revisar (fora da soma)",
};

export const TREATMENT_SHORT: Record<Treatment, string> = {
  soma: "Entra na soma",
  fora_outros_produtos: "Outras receitas",
  a_classificar: "A classificar",
  nao_operacional: "Não operacional",
  revisar: "A revisar",
};

export interface CategoryMapRow {
  nome_norm: string;
  categoria: string;
  produto: string | null;
  tratamento: Treatment;
  categoria_dre: string | null;
  empresas: string[];
  qtd_recebido: number;
  valor_recebido: number;
  qtd_aberto: number;
  valor_aberto: number;
}

type Num = number | string | null;

export function useCategoryMap(ws: string | undefined) {
  return useQuery({
    queryKey: ["sales", "category-map", ws],
    enabled: !!ws,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("iuli_category_map_list", { p_workspace_id: ws });
      if (error) throw error;
      return ((data ?? []) as (Omit<CategoryMapRow, "qtd_recebido" | "valor_recebido" | "qtd_aberto" | "valor_aberto"> & Record<string, Num>)[]).map((r) => ({
        ...r,
        qtd_recebido: Number(r.qtd_recebido ?? 0),
        valor_recebido: Number(r.valor_recebido ?? 0),
        qtd_aberto: Number(r.qtd_aberto ?? 0),
        valor_aberto: Number(r.valor_aberto ?? 0),
      })) as CategoryMapRow[];
    },
  });
}
