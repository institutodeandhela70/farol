-- Corrige o desenho da migration anterior (email_settings, singleton
-- platform-admin-only): API key e remetente do Brevo são credencial de
-- integração, não config de plataforma — precisam ficar editáveis na tela de
-- Integrações do workspace, no mesmo padrão das demais (Asaas/HubSpot/TMB/
-- VSIX/IULI): integrations(provider='brevo').config = {sender_name,
-- sender_email, reply_to}, integration_secrets.api_key = chave da API.
-- Tabela nunca teve dado real além da linha default — seguro derrubar.
drop table if exists public.email_settings;
