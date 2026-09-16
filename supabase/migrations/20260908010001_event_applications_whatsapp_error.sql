-- Paridade com event_participants (mesma migration anterior): guarda o
-- motivo do erro de envio de WhatsApp, não só o status.
alter table public.event_applications add column if not exists whatsapp_sync_error text;
