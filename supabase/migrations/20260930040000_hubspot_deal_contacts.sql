-- Vínculo negócio↔contato — é associação, não propriedade, igual a
-- hubspot_meetings.contact_ids (ver sync-hubspot/index.ts). Usado pra achar
-- quem é o "cliente" de um negócio ganho, já que os campos de texto no negócio
-- (e-mail, nome) estão em grande parte vazios nesta conta.
alter table public.hubspot_deals
  add column if not exists contact_ids text[] not null default '{}'::text[];
