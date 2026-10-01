// Dicionário de origem dos números do menu "Resultado" — o que o ícone "i" mostra.
// Manter em sincronia com as funções sales_* (supabase/migrations/20260930080000_sales_result.sql
// e 20260930090000_sales_dedupe.sql).

import type { DataSource, SourceField } from "@/lib/commercialSources";

const deal = (name: string, label: string): SourceField => ({ system: "HubSpot · Negócios", name, label });
const farol = (name: string, label: string): SourceField => ({ system: "FAROL · Configuração", name, label });

const F = {
  amount: deal("amount", "Amount"),
  closedate: deal("closedate", "Close Date"),
  won: deal("hs_is_closed_won", "Is Closed Won"),
  pipeline: deal("pipeline", "Pipeline"),
  owner: deal("hubspot_owner_id", "Deal owner"),
  dealname: deal("dealname", "Deal Name"),
  produtoContratos: deal("produto_de_interesse", "Produto de interesse (pipeline de Contratos)"),
  produtoHubla: deal("produtos", "Produtos (pipeline Vendas Hubla & TMB)"),
  roles: farol("sales_pipeline_roles", "Quais pipelines são Contratos e Hubla & TMB"),
  catalog: farol("sales_product_catalog", "Quais produtos são dos 6 (high ticket)"),
  overrides: farol("sales_product_overrides", "Correções do de-para de produto"),
  settings: farol("sales_settings", "Janela de dias da dedupe"),
};

const rec = (name: string, label: string): SourceField => ({ system: "IULI · get_accounts_receivable", name, label });
const tx = (name: string, label: string): SourceField => ({ system: "IULI · list_transactions", name, label });
const CX = {
  due: rec("itens[].due_date", "Data de vencimento"),
  valor: rec("itens[].valor", "Valor previsto"),
  pago: rec("itens[].valor_pago", "Valor recebido"),
  status: rec("itens[].status", "Status (recebida / sem baixa)"),
  cliente: rec("itens[].empresa", "Cliente"),
  categoria: tx("itens[].categoria", "Categoria do lançamento"),
  map: farol("iuli_category_map", "De-para categoria da IULI → produto"),
};
const RECEITA_RULE =
  "Receita = o que entrou na IULI: títulos com baixa, pelo valor recebido, na data do pagamento. Só categorias de produto (de-para em Categorias). Cada entrada é ligada ao negócio ganho do HubSpot (pipelines Contratos e Hubla & TMB) pelo cliente e pelo produto; a data do ganho do negócio diz se a venda é do mês da entrada ou de outro mês.";
const RX = {
  pago: rec("itens[].valor_pago", "Valor recebido"),
  pagamento: rec("itens[].pagamento", "Data do pagamento"),
  venda: tx("itens[].venda_id", "Venda na IULI"),
  closedate: deal("closedate", "Close Date (data do ganho)"),
  dealname: deal("dealname", "Deal Name"),
  links: farol("receita_links", "Vínculo entrada × negócio (atualizado de hora em hora)"),
};
const LINK_NOTE =
  "Vínculo: nome do cliente da IULI igual ao do negócio (ou a uma das pessoas de um combo \"A e B\"), mesmo produto; vale o negócio ganho mais próximo da data da entrada (até 45 dias depois). Sem negócio do mesmo cliente e produto, a entrada continua contando, só não dá para datar a venda.";
const CAIXA_RULE =
  "Caixa = receitas da IULI pela data de vencimento. Só entram categorias de produto (de-para em Categorias). Recebido = valor pago; a vencer e vencido = valor previsto. Vencido = sem baixa e com vencimento anterior a hoje (fuso de São Paulo).";

const SP = "Dia do ganho no fuso de São Paulo.";
const SCOPE =
  "Só negócios ganhos. High ticket = produtos dos 6 (MI, IPM, Dynastia, Inspiratori, PI, Dubai) e Combo, em Contratos ou na Hubla & TMB. Demais = Hubla & TMB de outros produtos. Os produtos de Contratos que não são dos 6 ficam fora da soma.";
const DEDUPE =
  "Negócio da Hubla & TMB de produto dos 6 que repete um ganho de Contratos (mesmo cliente e mesmo produto, até a janela de dias configurada) sai da soma para não contar duas vezes.";

export const RESULT_SOURCES = {
  ovSales: (): DataSource => ({
    title: "Vendas (visão geral)",
    fields: [F.amount, F.won, F.closedate, F.pipeline, F.produtoContratos, F.produtoHubla, F.catalog],
    rule: `Mesmo número da tela Vendas: negócios ganhos de Contratos e Hubla & TMB pela data do ganho. ${DEDUPE} O filtro de empresa não se aplica (é só HubSpot).`,
    note: SP,
  }),
  ovRevenue: (): DataSource => ({
    title: "Receita (visão geral)",
    fields: [RX.pago, RX.pagamento, CX.categoria, CX.map, RX.closedate, RX.links],
    rule: RECEITA_RULE,
    note: LINK_NOTE,
  }),
  ovCash: (): DataSource => ({
    title: "Caixa (visão geral)",
    fields: [CX.due, CX.valor, CX.pago, CX.status, CX.categoria, CX.map],
    rule: CAIXA_RULE,
  }),
  ovBridge: (): DataSource => ({
    title: "Do vendido ao que entra",
    fields: [F.amount, F.closedate, RX.pago, RX.pagamento, CX.due, CX.valor],
    rule: "Vendido = negócios ganhos no período (HubSpot). Entrou = receita do período (IULI, por data de pagamento) separada por mês da venda. A receber = títulos de produto com vencimento no período que ainda não tiveram baixa. São três datas diferentes (ganho, pagamento, vencimento), por isso não fecham entre si: a ponte mostra o caminho, não uma conta.",
  }),
  ovChart: (): DataSource => ({
    title: "Vendas × Receita × Caixa por mês",
    fields: [F.amount, F.closedate, RX.pago, RX.pagamento, CX.due, CX.valor],
    rule: "Por mês: vendido (data do ganho), receita (data do pagamento) e caixa (data de vencimento; recebido + a receber). Os 12 meses até a data final do filtro.",
  }),
  ovProducts: (): DataSource => ({
    title: "Por produto",
    fields: [F.produtoContratos, F.produtoHubla, CX.categoria, CX.map, F.amount, RX.pago, CX.valor],
    rule: "Vendido, receita e caixa do período por produto padronizado. Produtos de Contratos fora dos 6 não entram (fora da soma).",
  }),
  ovAttention: (): DataSource => ({
    title: "O que precisa de atenção",
    fields: [F.catalog, CX.map, RX.links, CX.status],
    rule: "Pendências que afetam a qualidade dos números: produtos fora dos 6, negócios removidos por duplicidade, receita a classificar, entradas sem negócio, vencido antigo e categorias a revisar.",
  }),
  revTotal: (): DataSource => ({
    title: "Receita do período",
    fields: [RX.pago, RX.pagamento, CX.categoria, CX.map, RX.closedate, RX.links],
    rule: RECEITA_RULE,
    note: LINK_NOTE,
  }),
  revMes: (): DataSource => ({
    title: "Receita de vendas do mês",
    fields: [RX.pago, RX.pagamento, RX.closedate, RX.dealname, RX.links],
    rule: "Entradas cujo negócio foi ganho no MESMO mês do pagamento.",
    note: LINK_NOTE,
  }),
  revOutros: (): DataSource => ({
    title: "Receita de vendas de outros meses",
    fields: [RX.pago, RX.pagamento, RX.closedate, RX.dealname, RX.links],
    rule: "Entradas cujo negócio foi ganho em OUTRO mês (parcelas de vendas anteriores, por exemplo).",
    note: LINK_NOTE,
  }),
  revSem: (): DataSource => ({
    title: "Sem negócio vinculado",
    fields: [RX.pago, CX.categoria, CX.cliente, RX.links],
    rule: "Entradas de categoria de produto para as quais não achei negócio ganho do mesmo cliente e produto. Continuam contando na receita; não dá para dizer de que mês é a venda.",
    note: "Causas comuns: comprador pessoa jurídica (o negócio está no nome de outra pessoa), nome diferente entre IULI e HubSpot, venda fora das pipelines Contratos e Hubla & TMB.",
  }),
  revSeries: (): DataSource => ({
    title: "Receita por período",
    fields: [RX.pago, RX.pagamento, RX.closedate, RX.links],
    rule: RECEITA_RULE,
  }),
  revSafra: (): DataSource => ({
    title: "Safra",
    fields: [RX.pago, RX.pagamento, RX.closedate, RX.links],
    rule: "Cada linha é o mês da entrada; cada coluna, o mês em que a venda foi ganha no HubSpot. Mostra de quando vem o dinheiro que entra em cada mês. Usa os 6 meses até a data final do filtro.",
  }),
  revProducts: (): DataSource => ({
    title: "Receita por produto",
    fields: [CX.categoria, CX.map, RX.pago],
    rule: "Valor recebido por produto do de-para (categoria da IULI → produto).",
  }),
  revTitles: (): DataSource => ({
    title: "Maiores entradas",
    fields: [RX.pago, RX.pagamento, CX.cliente, CX.categoria, RX.dealname, RX.closedate],
    rule: "As entradas de maior valor do período, com o negócio vinculado.",
  }),
  revOut: (): DataSource => ({
    title: "Entradas fora da soma",
    fields: [CX.categoria, CX.map, RX.pago, RX.pagamento],
    rule: "Entradas do período que não são receita de produto: a classificar, outras receitas, não operacionais, a revisar e sem categoria carregada. Não entram em nenhum total da Receita.",
  }),
  cashTotal: (): DataSource => ({
    title: "Caixa previsto no período",
    fields: [CX.due, CX.valor, CX.pago, CX.status, CX.categoria, CX.map],
    rule: CAIXA_RULE,
    note: "Soma recebido + a vencer + vencido do período. É caixa de entradas: contas a pagar não estão liberadas no token da IULI.",
  }),
  cashReceived: (): DataSource => ({
    title: "Recebido",
    fields: [CX.due, CX.pago, CX.status, CX.categoria, CX.map],
    rule: "Títulos com baixa cujo vencimento cai no período, pelo valor recebido.",
  }),
  cashOpen: (): DataSource => ({
    title: "A vencer",
    fields: [CX.due, CX.valor, CX.status, CX.categoria, CX.map],
    rule: "Títulos sem baixa com vencimento de hoje em diante, pelo valor previsto.",
  }),
  cashOverdue: (): DataSource => ({
    title: "Vencido",
    fields: [CX.due, CX.valor, CX.status, CX.categoria, CX.map],
    rule: "Títulos sem baixa com vencimento anterior a hoje, pelo valor previsto.",
    note: "Parte do vencido antigo pode ser baixa que ninguém registrou na IULI, e não inadimplência.",
  }),
  cashSeries: (): DataSource => ({
    title: "Entradas por vencimento",
    fields: [CX.due, CX.valor, CX.pago, CX.status, CX.map],
    rule: CAIXA_RULE + " A linha é o acumulado do período.",
  }),
  cashProducts: (): DataSource => ({
    title: "Caixa por produto",
    fields: [CX.categoria, CX.map, CX.valor, CX.pago],
    rule: "Valor por produto do de-para (categoria da IULI → produto do Farol).",
  }),
  cashAging: (): DataSource => ({
    title: "Vencido por tempo de atraso",
    fields: [CX.due, CX.valor, CX.status, CX.map],
    rule: "Todo o vencido de hoje (não depende do período), por dias de atraso, só receita de produto.",
  }),
  cashClients: (): DataSource => ({
    title: "Maiores clientes do período",
    fields: [CX.cliente, CX.due, CX.valor, CX.pago],
    rule: "Clientes com maior valor de caixa no período (recebido + em aberto).",
  }),
  cashTitles: (): DataSource => ({
    title: "Maiores títulos do período",
    fields: [CX.cliente, CX.categoria, CX.due, CX.valor, CX.pago],
    rule: "Os títulos de maior valor com vencimento no período.",
  }),
  cashOut: (): DataSource => ({
    title: "Fora da soma",
    fields: [CX.categoria, CX.map, CX.due, CX.valor],
    rule: "Receitas com vencimento no período que não são de produto: a classificar, outras receitas, não operacionais, a revisar e sem categoria carregada. Não entram em nenhum total do Caixa.",
  }),
  total: (): DataSource => ({
    title: "Total vendido",
    fields: [F.amount, F.won, F.closedate, F.pipeline, F.produtoContratos, F.produtoHubla, F.roles, F.catalog],
    rule: `${SCOPE} ${DEDUPE}`,
    note: SP,
  }),
  high: (): DataSource => ({
    title: "High ticket",
    fields: [F.amount, F.won, F.closedate, F.pipeline, F.produtoContratos, F.produtoHubla, F.catalog],
    rule: `Soma dos negócios ganhos dos produtos dos 6 (e Combo), nas pipelines Contratos e Hubla & TMB. ${DEDUPE}`,
    note: SP,
  }),
  demais: (): DataSource => ({
    title: "Demais vendas",
    fields: [F.amount, F.won, F.closedate, F.pipeline, F.produtoHubla, F.catalog],
    rule: "Negócios ganhos da pipeline Vendas Hubla & TMB cujo produto não é um dos 6.",
    note: SP,
  }),
  ticket: (): DataSource => ({
    title: "Ticket médio",
    fields: [F.amount, F.won, F.closedate],
    rule: "Total vendido dividido pela quantidade de negócios ganhos do período (mesmas regras do total).",
  }),
  split: (): DataSource => ({
    title: "High ticket × Demais",
    fields: [F.amount, F.pipeline, F.catalog],
    rule: "Participação de cada grupo no total vendido do período.",
  }),
  series: (): DataSource => ({
    title: "Vendas por dia",
    fields: [F.amount, F.closedate, F.pipeline],
    rule: `Valor ganho por dia (semana ou mês em períodos longos), separado pela pipeline de origem. ${DEDUPE}`,
    note: SP,
  }),
  products: (): DataSource => ({
    title: "Produtos dos 6",
    fields: [F.produtoContratos, F.produtoHubla, F.overrides, F.catalog, F.amount],
    rule: "Valor por produto padronizado (ex.: \"Imperium\" e \"[MI] Mentoria Imperium\" viram MI). O de-para pode ser corrigido na tela Produtos.",
  }),
  demaisProducts: (): DataSource => ({
    title: "Demais vendas por produto",
    fields: [F.produtoHubla, F.overrides, F.amount],
    rule: "Valor por produto das vendas da Hubla & TMB que não são dos 6.",
  }),
  fora: (): DataSource => ({
    title: "Produtos fora dos 6",
    fields: [F.produtoContratos, F.pipeline, F.catalog, F.amount],
    rule: "Negócios ganhos na pipeline de Contratos cujo produto não é um dos 6. Não deveriam estar nessa pipeline; ficam FORA da soma e aparecem aqui só para correção na origem.",
    note: SP,
  }),
  duplicates: (): DataSource => ({
    title: "Removidos por duplicidade",
    fields: [F.dealname, F.produtoHubla, F.produtoContratos, F.closedate, F.settings],
    rule: DEDUPE,
    note: "O cliente é comparado pelo nome do negócio (sem a etiqueta entre colchetes e sem acento).",
  }),
  deals: (): DataSource => ({
    title: "Maiores negócios",
    fields: [F.dealname, F.amount, F.closedate, F.pipeline, F.owner, F.produtoContratos, F.produtoHubla],
    rule: "Os negócios ganhos de maior valor no período (mesmas regras do total).",
  }),
};
