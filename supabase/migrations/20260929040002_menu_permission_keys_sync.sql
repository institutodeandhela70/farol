-- O catálogo de permission_keys (criado na Fase 3 do bootstrap) ficou defasado
-- do menu real (navConfig.ts): faltavam comercial/*, iuli/*, hubspot-*, financeiro/*
-- e integracoes-logs. Sincroniza aqui para a Fase 1 de gestão de equipe poder
-- montar defaults de permissão por perfil sobre o catálogo completo.
-- key = "menu." + id da rota em navConfig.ts (com "/" virando "."), convenção
-- já usada pelas chaves originais (ex.: id "dashboards/hubla" -> "menu.dashboards.hubla").
insert into public.permission_keys (key, category, label, sort_order) values
  ('menu.dashboard', 'top', 'Visão geral', 0),
  ('menu.eventos', 'top', 'Eventos', 1),

  ('menu.comercial.visao-geral', 'comercial', 'Comercial · Visão Geral', 10),
  ('menu.comercial.agenda', 'comercial', 'Comercial · Agenda & Produtividade', 11),
  ('menu.comercial.pipeline', 'comercial', 'Comercial · Pipeline & Previsão', 12),
  ('menu.comercial.fechamento', 'comercial', 'Comercial · Fechamento Mensal', 13),
  ('menu.comercial.vendedor', 'comercial', 'Comercial · Ficha do Vendedor', 14),
  ('menu.comercial.metas', 'comercial', 'Comercial · Metas', 15),

  ('menu.iuli.visao-geral', 'iuli', 'Financeiro IULI · Visão Geral', 20),
  ('menu.iuli.vendas', 'iuli', 'Financeiro IULI · Vendas', 21),
  ('menu.iuli.receber', 'iuli', 'Financeiro IULI · Contas a Receber', 22),
  ('menu.iuli.notas', 'iuli', 'Financeiro IULI · Notas Fiscais', 23),
  ('menu.iuli.assinaturas', 'iuli', 'Financeiro IULI · Assinaturas', 24),
  ('menu.iuli.cadastros', 'iuli', 'Financeiro IULI · Projetos & Cadastros', 25),

  ('menu.dashboards.hubla', 'dashboards', 'Dashboards · Hubla', 30),
  ('menu.dashboards.asaas', 'dashboards', 'Dashboards · Asaas', 31),
  ('menu.dashboards.hubspot-negocios', 'dashboards', 'Dashboards · HubSpot Negócios', 32),
  ('menu.dashboards.hubspot-contatos', 'dashboards', 'Dashboards · HubSpot Contatos', 33),
  ('menu.dashboards.hubspot-agendas', 'dashboards', 'Dashboards · HubSpot Agendas', 34),
  ('menu.dashboards.hotmart', 'dashboards', 'Dashboards · Hotmart', 35),
  ('menu.dashboards.tmb', 'dashboards', 'Dashboards · TMB', 36),
  ('menu.dashboards.planilhas', 'dashboards', 'Dashboards · Planilhas', 37),

  ('menu.financeiro.dashboard', 'financeiro', 'Financeiro · Dashboard', 40),
  ('menu.financeiro.receitas', 'financeiro', 'Financeiro · Receitas', 41),

  ('menu.settings.integracoes', 'settings', 'Configurações · Integrações', 50),
  ('menu.settings.integracoes-logs', 'settings', 'Configurações · Logs de Integrações', 51),
  ('menu.settings.equipe', 'settings', 'Configurações · Equipe', 52),
  ('menu.settings.geral', 'settings', 'Configurações · Geral', 53)
on conflict (key) do update set
  category = excluded.category,
  label = excluded.label,
  sort_order = excluded.sort_order;
