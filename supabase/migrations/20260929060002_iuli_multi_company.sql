-- IULI com várias empresas: na IULI cada empresa tem seu próprio token do
-- MCP, então o workspace passa a poder ter mais de uma integração IULI — uma
-- por empresa, identificada pelo nome que o usuário der (label).
--
-- Todas as tabelas iuli_* já são chaveadas por integration_id, então a
-- empresa é simplesmente a integração de origem de cada registro.
--
-- Os demais providers continuam com no máximo uma integração por workspace.

alter table public.integrations add column if not exists label text;

alter table public.integrations drop constraint if exists integrations_workspace_id_provider_key;

create unique index if not exists integrations_workspace_provider_single_idx
  on public.integrations (workspace_id, provider)
  where provider <> 'iuli';

create unique index if not exists integrations_iuli_label_idx
  on public.integrations (workspace_id, lower(label))
  where provider = 'iuli';

update public.integrations
set label = 'Empresa 1'
where provider = 'iuli' and label is null;
