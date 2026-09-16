-- Fase 7: configuração de disparo automático de WhatsApp por evento. Nada
-- dispara sozinho — cada gatilho tem um liga/desliga explícito (`enabled`)
-- e um template editável com variáveis {{nome}}/{{evento}}/{{produto}}/{{valor}}
-- (o conjunto disponível varia por trigger_type, ver render no código).
create table if not exists public.event_message_templates (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  trigger_type text not null check (trigger_type in ('participante_aprovado', 'ficha_preenchida', 'venda_finalizada')),
  enabled boolean not null default false,
  message_template text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, trigger_type)
);

alter table public.event_message_templates enable row level security;

drop policy if exists "event_message_templates_select_member" on public.event_message_templates;
create policy "event_message_templates_select_member"
  on public.event_message_templates for select
  using (public.is_workspace_member((select workspace_id from public.events where id = event_id)));

drop policy if exists "event_message_templates_insert_member" on public.event_message_templates;
create policy "event_message_templates_insert_member"
  on public.event_message_templates for insert
  with check (public.is_workspace_member((select workspace_id from public.events where id = event_id)));

drop policy if exists "event_message_templates_update_member" on public.event_message_templates;
create policy "event_message_templates_update_member"
  on public.event_message_templates for update
  using (public.is_workspace_member((select workspace_id from public.events where id = event_id)));

drop policy if exists "event_message_templates_delete_member" on public.event_message_templates;
create policy "event_message_templates_delete_member"
  on public.event_message_templates for delete
  using (public.is_workspace_member((select workspace_id from public.events where id = event_id)));

-- event_participants também precisa registrar status de WhatsApp (só existia
-- em event_applications desde a Fase 4) — o gatilho "participante aprovado" é
-- em cima dessa tabela.
alter table public.event_participants add column if not exists whatsapp_status text not null default 'nao_enviado' check (whatsapp_status in ('nao_enviado', 'enviado', 'erro'));
alter table public.event_participants add column if not exists whatsapp_sync_error text;
