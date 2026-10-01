-- Adiciona HubSpot como provedor de integração válido.
alter type public.integration_provider add value if not exists 'hubspot';
