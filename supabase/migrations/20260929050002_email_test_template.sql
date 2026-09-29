-- Template usado só pelo botão "Enviar e-mail de teste" da tela de
-- Integrações, pra validar chave + remetente do Brevo sem misturar com o
-- fluxo real de boas-vindas/reset de senha.
insert into public.email_templates (key, subject, html_content) values
(
  'integration-test',
  'Teste de integração — Farol ID',
  '<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
    <h1 style="font-size: 20px;">Teste de integração com o Brevo</h1>
    <p>Se você recebeu este e-mail, a integração do Farol ID com o Brevo está funcionando — remetente e chave da API configurados corretamente.</p>
    <p style="color:#64748b;font-size:12px;">Disparado em {{sentAt}} pelo workspace {{workspaceName}}.</p>
  </div>'
)
on conflict (key) do nothing;
