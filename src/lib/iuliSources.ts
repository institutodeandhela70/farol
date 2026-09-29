// Dicionário de origem dos dados do Dashboard Financeiro (IULI): de qual função
// do MCP da IULI e de qual campo cada número sai e como é calculado. É o que o
// ícone "i" de cada indicador mostra — manter em sincronia com:
//   - supabase/functions/sync-iuli-records (o que é baixado e quando)
//   - supabase/migrations/20260929070000_iuli_dashboard_filters.sql (views e agregações)
//   - supabase/functions/sync-iuli (totais fixos: conferência e Cadastros)

import type { DataSource, SourceField } from "@/lib/commercialSources";

const f = (tool: string, name: string, label: string): SourceField => ({ system: `IULI · ${tool}`, name, label });
const farol = (name: string, label: string): SourceField => ({ system: "FAROL", name, label });

export const ORIGEM_LABEL: Record<string, string> = {
  hubla: "Hubla",
  tmb: "TMB",
  hotmart: "Hotmart",
  importacao: "Importação manual",
  sem_id: "Lançamento direto",
  outra: "Outra plataforma",
};

const SYNC_NOTE =
  "O Farol guarda cada registro da IULI: os últimos 90 dias são relidos de hora em hora, os títulos sem baixa e 12 meses de vendas uma vez por dia, e o histórico inteiro uma vez por mês. Uma conferência diária compara com os totais da própria IULI.";

const FILTERS_NOTE = "Respeita todos os filtros da tela: período, empresa, cliente, status, produto, origem e operações entre empresas.";

const EFFECTIVE_RULE =
  "Venda efetiva = status aprovada ou concluída. Iniciada, boleto gerado, aguardando pagamento e em análise contam como \"em aberto\"; cancelada, reembolsada, chargeback e expirada como \"perdidas\".";

const SALE = {
  valor: f("list_sales", "itens[].valor_total", "Valor total da venda"),
  liquido: f("list_sales", "itens[].valor_liquido", "Valor líquido"),
  status: f("list_sales", "itens[].status", "Status da venda"),
  competencia: f("list_sales", "itens[].competencia", "Competência (data da venda)"),
  cliente: f("list_sales", "itens[].cliente", "Cliente"),
  external: f("list_sales", "itens[].external_id", "ID na plataforma de origem"),
};

const REC = {
  valor: f("get_accounts_receivable", "itens[].valor", "Valor previsto"),
  pago: f("get_accounts_receivable", "itens[].valor_pago", "Valor recebido"),
  due: f("get_accounts_receivable", "itens[].due_date", "Vencimento"),
  pagamento: f("get_accounts_receivable", "itens[].pagamento", "Data do pagamento (baixa)"),
  status: f("get_accounts_receivable", "itens[].status", "Situação (recebida / sem baixa)"),
  cliente: f("get_accounts_receivable", "itens[].empresa", "Cliente"),
};

export const IULI_SOURCES = {
  // --- Vendas ---
  effectiveSales: (): DataSource => ({
    title: "Vendas efetivas",
    fields: [SALE.valor, SALE.status, SALE.competencia],
    rule: `Soma do valor das vendas com competência no período e status aprovada ou concluída. A comparação é com o período imediatamente anterior, de mesmo tamanho. ${EFFECTIVE_RULE}`,
    note: `${FILTERS_NOTE} A data da venda segue o fuso UTC, igual à IULI (assim os totais batem com os dela). ${SYNC_NOTE}`,
  }),
  salesCount: (): DataSource => ({
    title: "Quantidade e ticket médio",
    fields: [SALE.status, SALE.valor],
    rule: `Quantidade de vendas efetivas; ticket médio = valor efetivo ÷ quantidade. ${EFFECTIVE_RULE}`,
  }),
  netSales: (): DataSource => ({
    title: "Líquido das vendas efetivas",
    fields: [SALE.liquido, SALE.status],
    rule: "Soma do valor líquido (depois das taxas da plataforma) das vendas efetivas do período.",
  }),
  openSales: (): DataSource => ({
    title: "Vendas em aberto",
    fields: [SALE.status, SALE.valor],
    rule: "Soma de iniciada + boleto gerado + aguardando pagamento + em análise — vendas que ainda não viraram dinheiro.",
  }),
  lostSales: (): DataSource => ({
    title: "Vendas perdidas",
    fields: [SALE.status, SALE.valor],
    rule: "Soma de cancelada + reembolsada + chargeback + expirada no período. O percentual é sobre o total de todos os status.",
  }),
  salesChart: (): DataSource => ({
    title: "Vendas no período",
    fields: [SALE.competencia, SALE.status, SALE.valor],
    rule: `Valor por dia (períodos de até 45 dias), semana (até 6 meses) ou mês, empilhando efetivas, em aberto e perdidas. ${EFFECTIVE_RULE}`,
    note: FILTERS_NOTE,
  }),
  salesStatus: (): DataSource => ({
    title: "Vendas por status",
    fields: [SALE.status, SALE.valor],
    rule: "Quantidade e valor de cada status no período, com o peso no valor total.",
  }),
  topProducts: (): DataSource => ({
    title: "Produtos que mais venderam",
    fields: [SALE.external, farol("hubla_sales.product_name", "Produto na Hubla"), farol("tmb_sales.product_name", "Produto na TMB")],
    rule: "A venda da IULI não traz o produto. O Farol cruza o ID da plataforma (external_id) com as vendas da Hubla (invoice_id) e da TMB (pedido_id) que ele já sincroniza e pega o produto de lá. Soma todos os status que estiverem no filtro.",
    note: "\"(não identificado)\" = venda que não veio da Hubla nem da TMB: importações manuais, lançamentos diretos na IULI e outras plataformas.",
  }),
  topClients: (): DataSource => ({
    title: "Clientes que mais compraram",
    fields: [SALE.cliente, SALE.valor],
    rule: "Soma por nome de cliente no período. Clique no nome pra filtrar a tela por ele. O CPF/CNPJ não é guardado no Farol.",
    note: "Plataformas que repassam vendas (ex: HUBLA TECNOLOGIA LTDA) aparecem como cliente quando a venda foi lançada no nome delas.",
  }),
  salesOrigin: (): DataSource => ({
    title: "Vendas por origem",
    fields: [SALE.external],
    rule: "Origem deduzida do ID da plataforma: bate com a Hubla ou TMB do Farol (ou começa com TMB_) → Hubla/TMB; começa com HP → Hotmart; formato Vda_AAAAMMDD_N ou AAAAMMDD_N → importação manual; sem ID → lançamento direto; o resto → outra plataforma.",
  }),
  salesList: (): DataSource => ({
    title: "Maiores vendas do período",
    fields: [SALE.competencia, SALE.cliente, SALE.status, SALE.valor],
    rule: "As 50 maiores vendas (por valor) com os filtros aplicados.",
  }),
  salesVsReceived: (): DataSource => ({
    title: "Vendas × recebimentos",
    fields: [SALE.valor, SALE.competencia, REC.pago, REC.pagamento],
    rule: "Verde: vendas efetivas pela data da venda. Azul: dinheiro recebido pela data do pagamento (baixa) dos títulos. Não são o mesmo dinheiro no tempo — venda parcelada entra de uma vez e é recebida ao longo dos meses.",
  }),

  // --- Contas a receber ---
  receivedByPayment: (): DataSource => ({
    title: "Recebido no período",
    fields: [REC.pago, REC.pagamento, REC.status],
    rule: "Soma do valor efetivamente recebido dos títulos que tiveram baixa com data de pagamento dentro do período — o dinheiro que entrou, independente de quando vencia.",
    note: `${FILTERS_NOTE} ${SYNC_NOTE}`,
  }),
  dueInPeriod: (): DataSource => ({
    title: "Venceu/vence no período",
    fields: [REC.due, REC.valor, REC.pago, REC.status],
    rule: "Títulos com vencimento dentro do período: os já recebidos pelo valor pago, os sem baixa pelo valor previsto. O percentual é quanto disso já foi recebido.",
  }),
  dueOpenInPeriod: (): DataSource => ({
    title: "Sem baixa do período",
    fields: [REC.due, REC.valor, REC.status],
    rule: "Títulos que vencem (ou venceram) dentro do período e ainda estão sem baixa.",
  }),
  receivablePending: (): DataSource => ({
    title: "A receber hoje (sem baixa)",
    fields: [REC.valor, REC.status],
    rule: "Posição de hoje: soma do valor previsto de todos os títulos sem baixa, de qualquer vencimento. Não depende do período escolhido (os outros filtros valem).",
    note: SYNC_NOTE,
  }),
  receivableOverdue: (): DataSource => ({
    title: "Vencido sem baixa",
    fields: [REC.valor, REC.due, REC.status],
    rule: "Posição de hoje: títulos sem baixa com vencimento anterior a hoje.",
    note: "Valor muito alto e antigo costuma ser baixa não registrada na IULI (recebeu mas ninguém deu baixa), e não inadimplência real. Veja o aging.",
  }),
  receivableUpcoming: (): DataSource => ({
    title: "A vencer",
    fields: [REC.valor, REC.due, REC.status],
    rule: "Posição de hoje: títulos sem baixa com vencimento de hoje em diante.",
  }),
  dueChart: (): DataSource => ({
    title: "Vencimentos do período",
    fields: [REC.due, REC.valor, REC.pago, REC.status],
    rule: "Títulos agrupados pelo vencimento (dia, semana ou mês): verde = já recebido, âmbar = sem baixa.",
  }),
  aging: (): DataSource => ({
    title: "Aging — idade do que está sem baixa",
    fields: [REC.valor, REC.due, REC.status],
    rule: "Títulos sem baixa hoje, por faixa de dias desde (ou até) o vencimento. Não depende do período escolhido.",
  }),
  documents: (): DataSource => ({
    title: "Cobertura documental",
    fields: [f("get_accounts_receivable", "itens[].tem_nf", "Tem nota fiscal"), f("get_accounts_receivable", "itens[].tem_anexo", "Tem anexo")],
    rule: "Dos títulos sem baixa hoje, quantos têm nota fiscal (emitida pela IULI para a parcela ou venda) e quantos têm algum anexo.",
    note: "O tipo do anexo é declarado por quem anexa na IULI, não é inferido do arquivo.",
  }),
  receivablesList: (): DataSource => ({
    title: "Títulos que vencem no período",
    fields: [REC.due, REC.cliente, f("get_accounts_receivable", "itens[].description", "Descrição"), REC.status, REC.valor, REC.pago],
    rule: "Os 50 títulos com vencimento no período, ordenados por valor ou por vencimento, com os filtros aplicados (inclusive situação e nota fiscal).",
  }),

  // --- Notas ---
  invoicesStatus: (): DataSource => ({
    title: "Notas fiscais",
    fields: [f("list_invoices", "itens[].status", "Status"), f("list_invoices", "itens[].valor", "Valor"), f("list_invoices", "itens[].criada_em", "Criada em")],
    rule: "Notas emitidas pela IULI com data de criação no período, por status. \"Negadas\" soma negada e cancelamento negado.",
    note: SYNC_NOTE,
  }),
  invoicesMonthly: (): DataSource => ({
    title: "Notas no período",
    fields: [f("list_invoices", "itens[].criada_em", "Criada em"), f("list_invoices", "itens[].status", "Status")],
    rule: "Quantidade de notas por dia, semana ou mês de criação, empilhada por status.",
  }),
  invoicesDenied: (): DataSource => ({
    title: "Notas negadas — motivo",
    fields: [f("list_invoices", "itens[].numero", "Número"), f("list_invoices", "itens[].detalhe_status", "Motivo da prefeitura/SEFAZ"), f("list_invoices", "itens[].valor", "Valor")],
    rule: "As 30 notas mais recentes do período com status negada ou cancelamento negado, com a mensagem de erro que a IULI recebeu.",
  }),
  invoiceCoverage: (): DataSource => ({
    title: "Vendas efetivas × notas autorizadas",
    fields: [SALE.status, f("list_invoices", "itens[].status", "Status da nota")],
    rule: "Compara, em cada dia/semana/mês, a quantidade de vendas efetivas com a de notas autorizadas criadas.",
    note: "É uma aproximação: uma venda pode ter nota em outra data ou várias notas (parcelas). Serve como sinal, não como conciliação.",
  }),

  // --- Assinaturas ---
  subscriptionsTotal: (): DataSource => ({
    title: "Assinaturas",
    fields: [f("list_subscriptions", "itens[]", "Assinaturas"), f("list_subscriptions", "itens[].status", "Status")],
    rule: "Todas as assinaturas/recorrências cadastradas na IULI (com os filtros de cliente, produto, ciclo e status; o período não se aplica aqui).",
    note: "Quase todas vêm com status \"1\" (nem ACTIVE nem CANCELED) — valor não padronizado na IULI. Não dá pra saber quais estão ativas de fato.",
  }),
  mrr: (): DataSource => ({
    title: "Receita recorrente declarada (MRR)",
    fields: [f("list_subscriptions", "itens[].valor_mensalizado", "Valor mensalizado")],
    rule: "Soma do valor mensalizado da IULI (mensais direto, anuais a 1/12) de todas as assinaturas no filtro.",
    note: "Como o status está quase todo como \"1\", esse número soma assinaturas possivelmente encerradas — trate como teto, não como MRR real.",
  }),
  subscriptionsByProduct: (): DataSource => ({
    title: "Assinaturas por produto",
    fields: [f("list_subscriptions", "itens[].produto", "Produto"), f("list_subscriptions", "itens[].valor_mensalizado", "Valor mensalizado")],
    rule: "Quantidade e valor mensalizado por produto (o produto vem da própria IULI nas assinaturas).",
  }),
  subscriptionsByMonth: (): DataSource => ({
    title: "Novas assinaturas",
    fields: [f("list_subscriptions", "itens[].criada_em", "Criada em"), f("list_subscriptions", "itens[].valor_mensalizado", "Valor mensalizado")],
    rule: "Assinaturas criadas no período, por dia, semana ou mês, comparadas com o período anterior de mesmo tamanho.",
  }),
  subscriptionsByCycle: (): DataSource => ({
    title: "Composição das assinaturas",
    fields: [f("list_subscriptions", "itens[].ciclo", "Ciclo"), f("list_subscriptions", "itens[].status", "Status")],
    rule: "Quantidade e valor mensalizado por ciclo de cobrança e por status.",
  }),
  subscriptionsRecent: (): DataSource => ({
    title: "Criadas no período",
    fields: [f("list_subscriptions", "itens[].cliente", "Cliente"), f("list_subscriptions", "itens[].produto", "Produto"), f("list_subscriptions", "itens[].valor", "Valor da parcela")],
    rule: "As 20 assinaturas criadas mais recentemente dentro do período.",
  }),

  // --- Visão geral / qualidade ---
  dataQuality: (): DataSource => ({
    title: "Qualidade dos dados",
    fields: [REC.status, f("list_subscriptions", "itens[].status", "Status das assinaturas"), SALE.external],
    rule: "Alertas calculados pelo Farol a partir dos dados da IULI, pra não tomar decisão em cima de número distorcido.",
  }),

  // --- Cadastros (totais fixos, uma empresa por vez) ---
  projects: (): DataSource => ({
    title: "Projetos",
    fields: [f("list_projects", "nome / sigla", "Projeto"), f("list_projects", "situacao", "Situação"), f("list_projects", "receita_orcada / despesa_orcada", "Orçado"), f("list_projects", "confiavel", "Resultado confiável")],
    rule: "Todos os projetos cadastrados na IULI. \"Confiável = não\" marca projeto encerrado com pendência no checklist.",
    note: "O resultado realizado por projeto (get_project_result) não está liberado no token — só o orçado.",
  }),
  costCenters: (): DataSource => ({
    title: "Centros de custo",
    fields: [f("list_cost_centers", "nome / sigla", "Centro de custo"), f("list_cost_centers", "situacao", "Situação")],
    rule: "Centros de custo cadastrados na IULI.",
  }),
  products: (): DataSource => ({
    title: "Produtos e serviços",
    fields: [f("list_products", "nome / codigo", "Produto"), f("list_products", "preco", "Preço")],
    rule: "Os primeiros 100 produtos do catálogo (limite da IULI por consulta).",
  }),
  charges: (): DataSource => ({
    title: "Cobranças emitidas pela IULI",
    fields: [f("list_charges", "itens[]", "Cobranças")],
    rule: "Boletos/Pix emitidos pela própria IULI, incluindo falhas de emissão.",
  }),
  counterparties: (): DataSource => ({
    title: "Operações entre empresas",
    fields: [farol("iuli_counterparty_rules", "Contrapartes do grupo"), SALE.cliente, REC.cliente],
    rule: "Venda ou título cujo cliente bate com um destes nomes (sem acento, maiúscula/minúscula tanto faz) é marcado como operação entre empresas e sai da soma na visão \"Todas as empresas\".",
    note: "Encontradas nos dados em 29/09/2026: títulos a receber da Instituto contra a Memorável Global e vice-versa.",
  }),
};
