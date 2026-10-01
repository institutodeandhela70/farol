-- Resultado — Fase 5 (Receita): base para ligar entradas da IULI a negócios do HubSpot.
-- Nome do negócio quebrado em pessoas ("A e B", "A & B") como coluna gerada e indexada:
-- um combo de Contratos com duas pessoas casa com qualquer uma delas.
alter table public.hubspot_deals
  add column if not exists dealname_parts text[] generated always as (regexp_split_to_array(public.sales_client_norm(dealname), '\s+(e|&)\s+')) stored;

create index if not exists hubspot_deals_parts_idx on public.hubspot_deals using gin (dealname_parts);

-- Nome do cliente da IULI normalizado igual ao do negócio.
create or replace function public.receita_client_norm(p text)
returns text
language sql
immutable
as $$
  select btrim(regexp_replace(public.iuli_norm(coalesce(p, '')), '\s+', ' ', 'g'));
$$;
