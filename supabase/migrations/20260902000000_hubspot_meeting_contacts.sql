-- Contato(s) associado(s) a cada reunião (a HubSpot guarda isso como associação,
-- não como propriedade) — pra responder "quem é o cliente" na tela de Agendas.

alter table public.hubspot_meetings add column if not exists contact_ids text[] not null default '{}';

create index if not exists hubspot_meetings_contact_ids_idx on public.hubspot_meetings using gin (contact_ids);
