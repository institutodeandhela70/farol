import { type ReactNode } from "react";
import { CommercialShell, FilterBar, MultiSelect, WarnNote } from "@/components/commercial/CommercialUI";
import { ResultPeriodBar } from "@/components/result/ResultUI";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { useMetaAccounts, useMetaFilters, useMetaFreshness } from "@/lib/metaAds";
import { useIgAccounts, useIgFreshness } from "@/lib/metaInstagram";
import { formatDayBR } from "@/lib/iuliFilters";
import { META_SECTIONS } from "@/lib/metaFormat";

// Peças do menu "Marketing · Meta Ads": mesma casca do Comercial/Resultado.

export function MetaShell({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  const { workspace } = useWorkspace();
  const { filters, set, accounts } = useMetaFilters();
  const accountList = useMetaAccounts(workspace?.id);
  return (
    <CommercialShell
      eyebrow="Marketing"
      sections={META_SECTIONS}
      title={title}
      description={description}
      filters={
        <FilterBar>
          <ResultPeriodBar filters={filters} set={set} />
          <MultiSelect
            label="Contas de anúncio"
            allLabel="Todas as contas"
            options={(accountList.data ?? []).map((a) => ({ value: a.account_id, label: a.name ?? a.account_id }))}
            selected={accounts}
            onChange={(v) => set({ contas: v })}
          />
        </FilterBar>
      }
    >
      <FreshnessNote />
      {children}
    </CommercialShell>
  );
}

/** Avisa quando a carga do histórico ainda não terminou: os totais são parciais até lá. */
function FreshnessNote() {
  const { workspace } = useWorkspace();
  const { data } = useMetaFreshness(workspace?.id);
  if (!data) return null;
  if (data.accountsTotal === 0) {
    return <WarnNote>Nenhuma conta de anúncio habilitada. Conecte a Meta em Configurações → Integrações.</WarnNote>;
  }
  if (data.accountsLoaded < data.accountsTotal || data.running) {
    return (
      <WarnNote>
        Carga do histórico em andamento: {data.accountsLoaded} de {data.accountsTotal} contas com métricas completas
        {data.loadedThrough ? ` (até ${formatDayBR(data.loadedThrough)})` : ""}. Os números abaixo podem estar parciais até terminar.
      </WarnNote>
    );
  }
  return null;
}

/** Casca das telas do Instagram: período + aviso de carga em andamento. */
export function IgShell({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  const { filters, set } = useMetaFilters();
  return (
    <CommercialShell
      eyebrow="Marketing"
      sections={META_SECTIONS}
      title={title}
      description={description}
      filters={
        <FilterBar>
          <ResultPeriodBar filters={filters} set={set} />
        </FilterBar>
      }
    >
      <IgFreshnessNote />
      {children}
    </CommercialShell>
  );
}

function IgFreshnessNote() {
  const { workspace } = useWorkspace();
  const accounts = useIgAccounts(workspace?.id);
  const { data } = useIgFreshness(workspace?.id);
  if (!accounts.data) return null;
  if (accounts.data.length === 0) return <WarnNote>Nenhum perfil do Instagram habilitado. Conecte a Meta em Configurações → Integrações.</WarnNote>;
  if (!data) return null;
  if (data.running) {
    return (
      <WarnNote>
        Carga do histórico em andamento: {data.mediaListed.toLocaleString("pt-BR")} posts e reels listados, {data.mediaWithInsights.toLocaleString("pt-BR")} com métricas
        {data.accountDaysThrough ? `; métricas diárias da conta até ${formatDayBR(data.accountDaysThrough)}` : ""}. Os números podem estar parciais até terminar.
      </WarnNote>
    );
  }
  return null;
}
