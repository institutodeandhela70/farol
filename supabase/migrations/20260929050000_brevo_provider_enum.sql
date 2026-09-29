-- Brevo como mais um provider de integração — mesmo padrão de Asaas/Hubla/
-- HubSpot/TMB/VSIX/IULI (chave configurada pela tela, não por env var/secret).
-- Precisa estar em sua própria migration: um valor de enum recém-criado não
-- pode ser usado na mesma transação em que foi adicionado.
alter type public.integration_provider add value if not exists 'brevo';
