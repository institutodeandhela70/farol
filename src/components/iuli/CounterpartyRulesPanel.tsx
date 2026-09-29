import { useState } from "react";
import { Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { supabase } from "@/lib/supabase";
import { useCounterpartyRules } from "@/lib/iuliData";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, Panel } from "@/components/commercial/CommercialUI";
import type { DataSource } from "@/lib/commercialSources";

// Contrapartes que são as próprias empresas do grupo. No consolidado ("Todas
// as empresas") as operações com esses nomes saem da soma, pra não contar em
// dobro (o a receber de uma é o a pagar da outra).

function toPattern(text: string) {
  const norm = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  return `%${norm}%`;
}

export function CounterpartyRulesPanel({ info }: { info: DataSource }) {
  const { workspace } = useWorkspace();
  const queryClient = useQueryClient();
  const { data: rules = [], isLoading } = useCounterpartyRules(workspace?.id);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["iuli"] });

  const add = async () => {
    if (!workspace || text.trim().length < 4) {
      setError("Digite pelo menos 4 letras do nome.");
      return;
    }
    const { error: e } = await supabase.from("iuli_counterparty_rules").insert({ workspace_id: workspace.id, pattern: toPattern(text), label: text.trim() });
    if (e) {
      setError(e.code === "23505" ? "Esse nome já está na lista." : e.message);
      return;
    }
    setText("");
    setError(null);
    refresh();
  };

  const remove = async (id: string) => {
    await supabase.from("iuli_counterparty_rules").delete().eq("id", id);
    refresh();
  };

  return (
    <Panel title="Operações entre as empresas do grupo" info={info}>
      <p className="text-sm text-muted-foreground">
        Clientes com estes nomes são as próprias empresas. Na visão "Todas as empresas", as vendas e títulos com eles saem da soma — a menos que você desmarque "Sem operações entre empresas".
      </p>
      {isLoading ? null : rules.length ? (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {rules.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div className="min-w-0">
                <span className="block truncate font-medium">{r.label ?? r.pattern}</span>
                <code className="block truncate text-xs text-muted-foreground">{r.pattern}</code>
              </div>
              <Button size="icon" variant="ghost" aria-label={`Remover ${r.label ?? r.pattern}`} onClick={() => remove(r.id)}>
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState>Nenhuma contraparte cadastrada.</EmptyState>
      )}
      <div className="flex gap-2">
        <Input placeholder="Nome (ou parte do nome) da empresa" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <Button variant="outline" onClick={add}>
          Adicionar
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </Panel>
  );
}
