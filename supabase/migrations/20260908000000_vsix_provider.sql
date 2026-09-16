-- Integração VSIX: mensageria de WhatsApp (por onde o módulo de Eventos vai
-- disparar as mensagens da Fase 7). Precisa ser o único statement da
-- migration — ALTER TYPE ... ADD VALUE não pode rodar na mesma transação que
-- usa o valor novo, então nenhuma outra migration deve tocar 'vsix' hoje.
alter type public.integration_provider add value if not exists 'vsix';
