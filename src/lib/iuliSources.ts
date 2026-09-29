// Dicionário de origem dos dados do Dashboard Financeiro (IULI): de qual função
// do MCP da IULI e de qual campo cada número sai e como é calculado. É o que o
// ícone "i" de cada indicador mostra — manter em sincronia com buildPlan() em
// supabase/functions/sync-iuli/index.ts e com as telas em src/pages/financeiro-iuli.

import type { DataSource, SourceField } from "@/lib/commercialSources";

const f = (tool: string, name: string, label: string): SourceField => ({ system: `IULI · ${tool}`, name, label });

const SYNC_NOTE =
  "Os dados vêm do MCP da IULI e ficam guardados no Farol: o mês atual é atualizado a cada hora, os meses fechados a cada 7 dias (o mês passado a cada 6h). Use \"Atualizar agora\" pra forçar.";

const EFFECTIVE_RULE =
  "Venda efetiva = status aprovada + concluída. Iniciada, boleto gerado, aguardando pagamento e em análise contam como \"em aberto\"; cancelada, reembolsada, chargeback e expirada como \"perdidas\".";

export const IULI_SOURCES = {
  effectiveSales: (): DataSource => ({
    title: "Vendas efetivas",
    fields: [
      f("list_sales", "por_status[].total", "Valor total por status"),
      f("list_sales", "por_status[].status", "Status da venda"),
      f("list_sales", "start_date / end_date", "Filtro por competência"),
    ],
    rule: `Soma do valor das vendas com competência no período e status aprovada ou concluída. ${EFFECTIVE_RULE}`,
    note: SYNC_NOTE,
  }),
  grossSales: (): DataSource => ({
    title: "Vendas brutas (todas)",
    fields: [f("get_sales_summary", "total_vendas", "Total de vendas"), f("get_sales_summary", "quantidade", "Quantidade")],
    rule: "Total que a IULI devolve no resumo de vendas do período, por competência.",
    note: "Atenção: esse total da IULI inclui TODOS os status, inclusive canceladas, reembolsadas e vendas só iniciadas. Por isso o Farol mostra \"vendas efetivas\" como número principal.",
  }),
  salesCount: (): DataSource => ({
    title: "Quantidade e ticket médio",
    fields: [f("list_sales", "por_status[].qtd", "Quantidade por status"), f("list_sales", "por_status[].total", "Valor por status")],
    rule: `Quantidade de vendas efetivas no período; ticket médio = valor efetivo ÷ quantidade efetiva. ${EFFECTIVE_RULE}`,
  }),
  lostSales: (): DataSource => ({
    title: "Vendas perdidas",
    fields: [f("list_sales", "por_status[].total", "Valor por status")],
    rule: "Soma de cancelada + reembolsada + chargeback + expirada no período, por competência.",
  }),
  openSales: (): DataSource => ({
    title: "Vendas em aberto",
    fields: [f("list_sales", "por_status[].total", "Valor por status")],
    rule: "Soma de iniciada + boleto gerado + aguardando pagamento + em análise no período — vendas que ainda não viraram dinheiro.",
  }),
  salesChart: (): DataSource => ({
    title: "Vendas por mês",
    fields: [f("list_sales", "por_status[]", "Status × valor, uma consulta por mês")],
    rule: `Uma consulta por mês de competência (13 meses), empilhando os grupos. ${EFFECTIVE_RULE}`,
    note: SYNC_NOTE,
  }),
  salesStatus: (): DataSource => ({
    title: "Vendas por status",
    fields: [f("list_sales", "por_status[].status", "Status"), f("list_sales", "por_status[].qtd", "Quantidade"), f("list_sales", "por_status[].total", "Valor")],
    rule: "Quantidade e valor por status, somando os meses do período selecionado.",
  }),
  topProducts: (): DataSource => ({
    title: "Produtos que mais venderam",
    fields: [f("get_sales_summary", "top_produtos[].produto", "Produto"), f("get_sales_summary", "top_produtos[].total", "Total"), f("get_sales_summary", "top_produtos[].qty", "Quantidade")],
    rule: "Ranking que a própria IULI calcula para o período (top 10 no mês, top 15 em 12 meses/ano).",
    note: "Como vem do resumo de vendas, o valor por produto inclui todos os status (inclusive cancelados). \"Sem produto\" são vendas sem produto vinculado na IULI.",
  }),
  topClients: (): DataSource => ({
    title: "Clientes que mais compraram",
    fields: [f("get_sales_summary", "top_clientes[].cliente", "Cliente"), f("get_sales_summary", "top_clientes[].total", "Total"), f("get_sales_summary", "top_clientes[].qty", "Quantidade")],
    rule: "Ranking que a própria IULI calcula para o período. O CPF/CNPJ não é guardado no Farol.",
    note: "Plataformas que repassam vendas (ex: HUBLA TECNOLOGIA LTDA) aparecem como cliente quando a venda foi lançada no nome delas.",
  }),
  salesHistory: (): DataSource => ({
    title: "Histórico completo de vendas",
    fields: [f("list_sales", "por_status[]", "Status × valor, sem filtro de data"), f("list_sales", "total_encontrado", "Total de vendas")],
    rule: "Todas as vendas já registradas na IULI, sem filtro de período.",
  }),

  receivablePending: (): DataSource => ({
    title: "A receber (sem baixa)",
    fields: [f("get_accounts_receivable", "total_a_receber", "Total a receber"), f("get_accounts_receivable", "quantidade", "Quantidade de títulos")],
    rule: "Soma do VALOR PREVISTO de todos os títulos de contas a receber que ainda não tiveram baixa, de qualquer vencimento.",
    note: SYNC_NOTE,
  }),
  receivableOverdue: (): DataSource => ({
    title: "Vencido sem baixa",
    fields: [f("get_accounts_receivable", "total_vencidas", "Total vencidas"), f("get_accounts_receivable", "qtd_vencidas", "Quantidade vencidas")],
    rule: "Títulos sem baixa cujo vencimento já passou.",
    note: "Valor muito alto e antigo costuma ser baixa não registrada na IULI (recebeu mas ninguém deu baixa), e não inadimplência real. Veja o aging e os títulos mais antigos.",
  }),
  receivableUpcoming: (): DataSource => ({
    title: "A vencer",
    fields: [f("get_accounts_receivable", "total_a_receber", "Total a receber"), f("get_accounts_receivable", "total_vencidas", "Total vencidas")],
    rule: "A receber sem baixa − vencido sem baixa = o que ainda vai vencer.",
  }),
  received: (): DataSource => ({
    title: "Recebido",
    fields: [f("get_accounts_receivable", "total_recebidas", "Total recebidas"), f("get_accounts_receivable", "qtd_recebidas", "Quantidade recebidas"), f("get_accounts_receivable", "due_date", "Filtro por vencimento")],
    rule: "Soma do VALOR RECEBIDO (efetivo) dos títulos que venciam no período e já tiveram baixa.",
    note: "O filtro de data da IULI é pelo VENCIMENTO do título, não pela data do pagamento. Um título que venceu em agosto e foi pago em setembro conta em agosto.",
  }),
  receivableMonthly: (): DataSource => ({
    title: "Recebido × em aberto por mês de vencimento",
    fields: [
      f("get_accounts_receivable", "total_recebidas", "Total recebidas"),
      f("get_accounts_receivable", "total_a_receber", "Total a receber (sem baixa)"),
      f("get_accounts_receivable", "due_date", "Filtro por vencimento"),
    ],
    rule: "Uma consulta por mês de vencimento (12 meses para trás, 6 para frente), com status = todos. Verde = já recebido; âmbar = sem baixa.",
    note: "Meses passados com muito \"sem baixa\" indicam títulos vencidos ou baixas não registradas.",
  }),
  aging: (): DataSource => ({
    title: "Aging — idade do que está sem baixa",
    fields: [f("get_accounts_receivable", "total_a_receber", "Total a receber"), f("get_accounts_receivable", "quantidade", "Quantidade"), f("get_accounts_receivable", "due_date", "Faixa de vencimento")],
    rule: "Uma consulta por faixa de vencimento, só títulos sem baixa, contando os dias a partir de hoje.",
  }),
  documents: (): DataSource => ({
    title: "Cobertura documental",
    fields: [
      f("get_accounts_receivable", "cobertura_documental.com_nota_fiscal", "Com nota fiscal"),
      f("get_accounts_receivable", "cobertura_documental.sem_nota_fiscal", "Sem nota fiscal"),
      f("get_accounts_receivable", "cobertura_documental.com_anexo", "Com anexo"),
    ],
    rule: "Dos títulos a receber sem baixa, quantos têm nota fiscal (emitida pela IULI para a parcela ou venda) e quantos têm algum anexo.",
    note: "O tipo do anexo é declarado por quem anexa na IULI, não é inferido do arquivo.",
  }),
  oldestTitles: (): DataSource => ({
    title: "Títulos sem baixa mais antigos",
    fields: [
      f("get_accounts_receivable", "itens[].due_date", "Vencimento"),
      f("get_accounts_receivable", "itens[].valor", "Valor previsto"),
      f("get_accounts_receivable", "itens[].empresa", "Cliente"),
      f("get_accounts_receivable", "itens[].description", "Descrição"),
    ],
    rule: "Os 10 primeiros títulos sem baixa na ordem da IULI (vencimento mais antigo primeiro).",
    note: "São os melhores candidatos a revisar: baixa esquecida, negociação antiga ou título a cancelar.",
  }),
  interest: (): DataSource => ({
    title: "Juros e descontos recebidos",
    fields: [
      f("get_accounts_receivable", "soma_valores_recebidas.juros_acrescimos", "Juros e acréscimos"),
      f("get_accounts_receivable", "soma_valores_recebidas.descontos_pagamentos_parciais", "Descontos / pagamentos parciais"),
    ],
    rule: "Diferença entre o previsto e o efetivamente recebido em todo o histórico de títulos baixados.",
  }),

  invoicesStatus: (): DataSource => ({
    title: "Notas fiscais por status",
    fields: [f("list_invoices", "por_status[].status", "Status"), f("list_invoices", "por_status[].qtd", "Quantidade")],
    rule: "Notas fiscais emitidas pela IULI, em todo o histórico.",
    note: SYNC_NOTE,
  }),
  invoicesMonthly: (): DataSource => ({
    title: "Notas fiscais por mês",
    fields: [f("list_invoices", "por_status[]", "Status × quantidade, uma consulta por mês"), f("list_invoices", "criada_em", "Filtro por data de criação")],
    rule: "Uma consulta por mês de criação da nota (13 meses).",
  }),
  invoicesDenied: (): DataSource => ({
    title: "Notas negadas — motivo",
    fields: [
      f("list_invoices", "itens[].numero", "Número"),
      f("list_invoices", "itens[].detalhe_status", "Motivo da prefeitura/SEFAZ"),
      f("list_invoices", "itens[].valor", "Valor"),
      f("list_invoices", "itens[].venda_id", "Venda"),
    ],
    rule: "As 20 notas mais recentes com status negada ou cancelamento negado, com a mensagem de erro que a IULI recebeu.",
  }),
  invoiceCoverage: (): DataSource => ({
    title: "Vendas efetivas × notas autorizadas no mês",
    fields: [f("list_sales", "por_status[].qtd", "Vendas por status"), f("list_invoices", "por_status[].qtd", "Notas por status")],
    rule: "Compara a quantidade de vendas efetivas (aprovada + concluída) com a de notas autorizadas criadas no mesmo mês.",
    note: "É uma aproximação: uma venda pode ter nota em outro mês ou várias notas (parcelas). Serve como sinal, não como conciliação.",
  }),

  subscriptionsTotal: (): DataSource => ({
    title: "Assinaturas",
    fields: [f("list_subscriptions", "total_encontrado", "Total de assinaturas"), f("list_subscriptions", "por_status[]", "Por status")],
    rule: "Todas as assinaturas/recorrências cadastradas na IULI.",
    note: "Quase todas vêm com status \"1\" (não é ACTIVE nem CANCELED) — é um valor não padronizado na IULI, provavelmente das assinaturas importadas de plataformas. Não dá pra saber quais estão ativas de fato.",
  }),
  mrr: (): DataSource => ({
    title: "Receita recorrente declarada (MRR)",
    fields: [f("list_subscriptions", "por_status[].mrr", "MRR"), f("list_subscriptions", "itens[].valor_mensalizado", "Valor mensalizado")],
    rule: "Regra da IULI: assinaturas mensais somam direto, anuais entram a 1/12. Soma de todos os status.",
    note: "Como o status está quase todo como \"1\", esse número soma assinaturas possivelmente encerradas — trate como teto, não como MRR real.",
  }),
  subscriptionsByProduct: (): DataSource => ({
    title: "Assinaturas por produto",
    fields: [f("list_subscriptions", "itens[].produto", "Produto"), f("list_subscriptions", "itens[].valor_mensalizado", "Valor mensalizado")],
    rule: "O Farol pagina todas as assinaturas (100 por vez) e agrupa por produto.",
  }),
  subscriptionsByMonth: (): DataSource => ({
    title: "Novas assinaturas por mês",
    fields: [f("list_subscriptions", "itens[].criada_em", "Data de criação"), f("list_subscriptions", "itens[].valor_mensalizado", "Valor mensalizado")],
    rule: "Assinaturas agrupadas pelo mês de criação.",
  }),
  subscriptionsByCycle: (): DataSource => ({
    title: "Composição das assinaturas",
    fields: [
      f("list_subscriptions", "itens[].ciclo", "Ciclo"),
      f("list_subscriptions", "itens[].status", "Status"),
      f("list_subscriptions", "itens[].forma_pagamento", "Forma de pagamento"),
      f("list_subscriptions", "itens[].origem", "Origem"),
    ],
    rule: "Assinaturas agrupadas por ciclo, status, forma de pagamento e origem, com a quantidade e o valor mensalizado de cada grupo.",
    note: "Forma de pagamento e origem vêm da IULI como códigos numéricos (ex: origem 14), sem descrição no MCP. Dá pra mapear pra nomes se a IULI informar a tabela de códigos.",
  }),
  subscriptionsRecent: (): DataSource => ({
    title: "Assinaturas mais recentes",
    fields: [f("list_subscriptions", "itens[].cliente", "Cliente"), f("list_subscriptions", "itens[].produto", "Produto"), f("list_subscriptions", "itens[].valor", "Valor da parcela"), f("list_subscriptions", "itens[].criada_em", "Criada em")],
    rule: "As 15 assinaturas criadas mais recentemente.",
  }),

  projects: (): DataSource => ({
    title: "Projetos",
    fields: [
      f("list_projects", "nome / sigla", "Projeto"),
      f("list_projects", "situacao", "Situação"),
      f("list_projects", "receita_orcada / despesa_orcada", "Orçado"),
      f("list_projects", "confiavel", "Resultado confiável"),
    ],
    rule: "Todos os projetos cadastrados na IULI. \"Confiável = não\" marca projeto encerrado com pendência no checklist.",
    note: "O resultado realizado por projeto (get_project_result) não está liberado no token atual — só o orçado.",
  }),
  costCenters: (): DataSource => ({
    title: "Centros de custo",
    fields: [f("list_cost_centers", "nome / sigla", "Centro de custo"), f("list_cost_centers", "situacao", "Situação")],
    rule: "Centros de custo cadastrados na IULI.",
  }),
  products: (): DataSource => ({
    title: "Produtos e serviços",
    fields: [f("list_products", "nome / codigo", "Produto"), f("list_products", "preco", "Preço"), f("list_products", "product_type", "Tipo")],
    rule: "Os primeiros 100 produtos do catálogo (limite da IULI por consulta).",
  }),
  charges: (): DataSource => ({
    title: "Cobranças emitidas pela IULI",
    fields: [f("list_charges", "por_status[]", "Status"), f("list_charges", "itens[]", "Cobranças")],
    rule: "Boletos/Pix emitidos pela própria IULI, incluindo falhas de emissão.",
  }),
  dataQuality: (): DataSource => ({
    title: "Qualidade dos dados",
    fields: [
      f("get_accounts_receivable", "total_vencidas", "Vencido sem baixa"),
      f("list_subscriptions", "por_status[].status", "Status das assinaturas"),
      f("get_sales_summary", "total_vendas", "Total de vendas"),
    ],
    rule: "Alertas calculados pelo Farol a partir dos dados da IULI, para não tomar decisão em cima de número distorcido.",
  }),
};
