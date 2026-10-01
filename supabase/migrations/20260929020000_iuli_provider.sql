-- Integração IULI: ERP financeiro, acessado pelo MCP deles com token Bearer
-- fixo. Precisa ser o único statement da migration — ALTER TYPE ... ADD VALUE
-- não pode rodar na mesma transação que usa o valor novo.
alter type public.integration_provider add value if not exists 'iuli';
