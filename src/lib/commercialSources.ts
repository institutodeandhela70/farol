// Dicionário de origem dos dados do Dashboard Comercial: de qual objeto/campo da
// integração cada número sai e como é calculado. É o que o ícone "i" de cada
// indicador mostra — manter em sincronia com as funções commercial_* do banco
// (supabase/migrations/20260929000000_commercial_dashboard.sql).

import type { Attribution } from "@/lib/commercial";

export interface SourceField {
  system: string; // "HubSpot · Negócios", "FAROL", ...
  name: string; // nome interno (API)
  label: string; // rótulo como aparece na integração
}

export interface DataSource {
  title: string;
  fields: SourceField[];
  rule: string;
  note?: string;
}

const deal = (name: string, label: string): SourceField => ({ system: "HubSpot · Negócios", name, label });
const meeting = (name: string, label: string): SourceField => ({ system: "HubSpot · Reuniões", name, label });

const D = {
  amount: deal("amount", "Amount"),
  closedate: deal("closedate", "Close Date"),
  stage: deal("dealstage", "Deal Stage"),
  pipeline: deal("pipeline", "Pipeline"),
  owner: deal("hubspot_owner_id", "Deal owner"),
  closer: deal("closer_responsavel", "Closer responsável"),
  probability: deal("hs_deal_stage_probability", "Deal probability"),
  isClosed: deal("hs_is_closed", "Is Deal Closed?"),
  isWon: deal("hs_is_closed_won", "Is Closed Won"),
};

const M = {
  outcome: meeting("hs_meeting_outcome", "Meeting outcome"),
  start: meeting("hs_meeting_start_time", "Meeting start time"),
  owner: meeting("hubspot_owner_id", "Activity assigned to"),
  creator: meeting("hs_created_by_user_id", "Created by user ID"),
  created: meeting("hs_createdate", "Create date"),
  type: meeting("hs_activity_type", "Call and meeting type"),
  allOwners: meeting("hs_user_ids_of_all_owners", "User IDs of all owners"),
};

const OWNERS_API: SourceField = { system: "HubSpot · Proprietários (API)", name: "id / userId / firstName / lastName", label: "Owners" };
const PIPELINES_API: SourceField = { system: "HubSpot · Pipelines (API)", name: "stages[].label / displayOrder", label: "Deal pipelines" };
const GOALS: SourceField = { system: "FAROL · Metas", name: "commercial_goals", label: "Cadastro em Comercial › Metas" };
const SALES_PIPELINES: SourceField = { system: "FAROL · Configuração", name: "commercial_pipeline_settings", label: "Pipelines que contam como venda" };

const attrField = (a: Attribution) => (a === "closer" ? D.closer : D.owner);
const attrText = (a: Attribution) =>
  a === "closer"
    ? "O vendedor é o do campo “Closer responsável” (seletor Dono/Closer em Closer)."
    : "O vendedor é o dono do negócio, campo “Deal owner” (seletor Dono/Closer em Dono).";

const SP = "Datas convertidas para o fuso de São Paulo antes de separar por mês.";
const SALES = "Só entram pipelines marcados como venda em Comercial › Metas (ou os escolhidos no filtro de pipelines).";
const UNRECORDED = "“Sem registro” = reunião cujo horário já passou e o resultado continua “Scheduled” (agendada) ou vazio.";

export const SOURCES = {
  revenue: (a: Attribution): DataSource => ({
    title: "Receita fechada",
    fields: [D.amount, D.isWon, D.closedate, D.pipeline, attrField(a), SALES_PIPELINES],
    rule: `Soma de “Amount” dos negócios com “Is Closed Won” = true e “Close Date” dentro do período. A variação compara com o período anterior de mesmo tamanho. ${SALES}`,
    note: `${attrText(a)} ${SP}`,
  }),
  wonDeals: (a: Attribution): DataSource => ({
    title: "Negócios ganhos, perdidos e conversão",
    fields: [D.isWon, D.isClosed, D.closedate, D.pipeline, attrField(a), SALES_PIPELINES],
    rule: `Ganhos = negócios com “Is Closed Won” = true e “Close Date” no período. Perdidos = “Is Deal Closed?” = true e “Is Closed Won” = false. Conversão = ganhos ÷ (ganhos + perdidos). ${SALES}`,
    note: attrText(a),
  }),
  meetings: (): DataSource => ({
    title: "Reuniões",
    fields: [M.start, M.type],
    rule: "Quantidade de reuniões cujo “Meeting start time” cai dentro do período. “Ainda por vir” = horário depois de agora. O filtro de tipo usa “Call and meeting type”.",
    note: SP,
  }),
  unrecorded: (): DataSource => ({
    title: "Reuniões sem registro",
    fields: [M.outcome, M.start],
    rule: `${UNRECORDED} O percentual é sobre as reuniões que já aconteceram no período.`,
    note: "Na HubSpot, o resultado fica no campo “Meeting outcome” da reunião (Completed, No show, Rescheduled, Canceled).",
  }),
  weighted: (a: Attribution): DataSource => ({
    title: "Previsão ponderada",
    fields: [D.amount, D.probability, D.isClosed, D.pipeline, attrField(a), SALES_PIPELINES],
    rule: `Para cada negócio em aberto (“Is Deal Closed?” = false): “Amount” × “Deal probability” (a probabilidade da etapa atual). “Em aberto” = soma de “Amount” sem ponderar. ${SALES}`,
    note: "Negócio sem “Amount” preenchido entra na contagem, mas soma R$ 0.",
  }),
  closingChart: (a: Attribution): DataSource => ({
    title: "Fechamento mensal",
    fields: [D.amount, D.isWon, D.closedate, D.pipeline, attrField(a), SALES_PIPELINES],
    rule: `Soma de “Amount” dos negócios ganhos (“Is Closed Won” = true), agrupada pelo mês do “Close Date”. Barras destacadas = meses dentro do período filtrado. ${SALES}`,
    note: SP,
  }),
  goals: (a: Attribution): DataSource => ({
    title: "Metas",
    fields: [GOALS, D.amount, D.isWon, attrField(a), M.creator, M.created, OWNERS_API],
    rule: "Metas vêm do cadastro no FAROL (não existem na HubSpot). Closer: receita fechada do período ÷ meta de receita. SDR: reuniões que a pessoa criou no período (“Created by user ID”, por “Create date”) ÷ meta de agendamentos. Período de vários meses soma as metas mensais.",
    note: "A reunião guarda quem criou como ID de usuário; o vínculo com o vendedor vem do campo userId da API de proprietários.",
  }),
  sdrCloser: (): DataSource => ({
    title: "Agenda · SDR → Closer",
    fields: [M.creator, M.allOwners, M.created, M.owner, M.start, OWNERS_API],
    rule: "SDR: reuniões criadas no período (“Create date”) por uma pessoa (“Created by user ID”) para outra conduzir — ou seja, quem criou não está em “User IDs of all owners”. Closer: reuniões atribuídas à pessoa (“Activity assigned to”) com “Meeting start time” no período.",
  }),
  dataQuality: (a: Attribution): DataSource => ({
    title: "Qualidade dos dados",
    fields: [M.outcome, M.start, D.amount, D.isClosed, attrField(a)],
    rule: `Alertas quando: mais de 20% das reuniões passadas estão sem “Meeting outcome”; mais de 30% dos negócios em aberto estão sem “Amount”; existem negócios ganhos sem ${a === "closer" ? "“Closer responsável”" : "“Deal owner”"}.`,
  }),
  ranking: (a: Attribution): DataSource => ({
    title: "Ranking de vendedores",
    fields: [attrField(a), D.amount, D.isWon, D.isClosed, D.closedate, M.owner, M.start, GOALS],
    rule: "Reuniões = reuniões atribuídas ao vendedor (“Activity assigned to”) no período. Ganhos e Valor = negócios ganhos no período. Ticket médio = valor ÷ ganhos. Conversão = ganhos ÷ (ganhos + perdidos). Meta = valor ÷ meta de receita do FAROL.",
    note: attrText(a),
  }),

  agendaTotal: (): DataSource => ({
    title: "Reuniões no período",
    fields: [M.start, M.type, M.owner],
    rule: "Reuniões com “Meeting start time” no período. “Já aconteceram” = horário até agora; “Por vir” = depois de agora. O filtro de pessoa usa “Activity assigned to”.",
    note: SP,
  }),
  agendaOutcome: (outcome: string): DataSource => ({
    title: `Reuniões — ${outcome}`,
    fields: [M.outcome, M.start],
    rule: `Reuniões do período cujo “Meeting outcome” é ${outcome}. Depende do vendedor marcar o resultado na HubSpot depois da reunião.`,
  }),
  agendaMonthly: (): DataSource => ({
    title: "Evolução mensal da agenda",
    fields: [M.start, M.outcome, M.type],
    rule: `Reuniões agrupadas pelo mês do “Meeting start time”. “Com resultado” = já aconteceu e tem “Meeting outcome” diferente de Scheduled. ${UNRECORDED} “Futuras” = horário depois de agora.`,
    note: SP,
  }),
  agendaSdr: (basis: "created" | "meeting"): DataSource => ({
    title: "Por quem agendou (SDR)",
    fields: [M.creator, M.allOwners, basis === "created" ? M.created : M.start, M.outcome, OWNERS_API, GOALS],
    rule: `Agrupa pela pessoa que criou a reunião (“Created by user ID”). ${basis === "created" ? "Conta as reuniões criadas no período (“Create date”)." : "Conta as reuniões que acontecem no período (“Meeting start time”)."} “Para outros” = quem criou não está em “User IDs of all owners”. Meta = meta de agendamentos do FAROL.`,
    note: "Pessoas que aparecem como “Usuário 123…” criaram reuniões mas não são proprietárias na HubSpot (usuário sem owner, integração, etc.).",
  }),
  agendaCloser: (): DataSource => ({
    title: "Por quem conduziu (Closer)",
    fields: [M.owner, M.start, M.outcome, GOALS],
    rule: "Agrupa pela pessoa atribuída à reunião (“Activity assigned to”), com “Meeting start time” no período. Meta = meta de reuniões conduzidas do FAROL, comparada com as que já aconteceram.",
  }),

  openCount: (a: Attribution): DataSource => ({
    title: "Negócios em aberto",
    fields: [D.isClosed, D.pipeline, attrField(a), SALES_PIPELINES],
    rule: `Negócios com “Is Deal Closed?” = false hoje. ${SALES}`,
  }),
  openAmount: (a: Attribution): DataSource => ({
    title: "Valor em aberto",
    fields: [D.amount, D.isClosed, D.pipeline, attrField(a), SALES_PIPELINES],
    rule: `Soma de “Amount” dos negócios em aberto, sem ponderar pela probabilidade. ${SALES}`,
  }),
  withoutAmount: (): DataSource => ({
    title: "Sem valor preenchido",
    fields: [D.amount, D.isClosed],
    rule: "Negócios em aberto com “Amount” vazio. Eles entram na contagem mas somam R$ 0 no valor e na previsão.",
  }),
  overdue: (): DataSource => ({
    title: "Previsão vencida",
    fields: [D.closedate, D.isClosed, D.amount],
    rule: "Negócios ainda em aberto cujo “Close Date” (data prevista de fechamento) é de um mês anterior ao atual.",
    note: SP,
  }),
  funnel: (a: Attribution): DataSource => ({
    title: "Funil por etapa",
    fields: [D.stage, D.pipeline, D.amount, D.isClosed, attrField(a), PIPELINES_API],
    rule: "Negócios em aberto do pipeline escolhido, agrupados por “Deal Stage”. A ordem e os nomes das etapas vêm da configuração do pipeline na HubSpot.",
  }),
  forecastByMonth: (a: Attribution): DataSource => ({
    title: "Previsão por mês de fechamento",
    fields: [D.closedate, D.amount, D.probability, D.isClosed, attrField(a), SALES_PIPELINES],
    rule: "Negócios em aberto agrupados pelo mês do “Close Date”. “Em aberto” = soma de “Amount”; “Ponderado” = “Amount” × “Deal probability”. “Vencidas” = Close Date antes do mês atual; “Sem data” = Close Date vazio.",
    note: SP,
  }),
  openTable: (a: Attribution): DataSource => ({
    title: "Negócios em aberto — tabela",
    fields: [D.pipeline, attrField(a), D.amount, D.probability, D.closedate, D.isClosed],
    rule: "Negócios em aberto somados por pipeline ou por vendedor: quantidade, “Amount”, “Amount” × “Deal probability”, quantos estão sem “Amount” e quantos têm “Close Date” vencido.",
    note: attrText(a),
  }),

  heatmap: (a: Attribution): DataSource => ({
    title: "Vendedor × mês",
    fields: [attrField(a), D.amount, D.isWon, D.closedate, D.pipeline, SALES_PIPELINES],
    rule: `Cada célula = negócios ganhos (“Is Closed Won” = true) do vendedor no mês do “Close Date”: soma de “Amount” ou quantidade. Com um mês só no filtro, mostra os 6 meses até ele. ${SALES}`,
    note: `${attrText(a)} ${SP}`,
  }),
  closingMonthly: (a: Attribution): DataSource => ({
    title: "Fechamento mês a mês",
    fields: [D.amount, D.isWon, D.isClosed, D.closedate, D.pipeline, SALES_PIPELINES],
    rule: `Por mês do “Close Date”: ganhos (“Is Closed Won” = true), valor (soma de “Amount” dos ganhos), perdidos (“Is Deal Closed?” = true e não ganho) e conversão = ganhos ÷ (ganhos + perdidos). ${SALES}`,
    note: `${attrText(a)} ${SP}`,
  }),

  sellerMeetings: (): DataSource => ({
    title: "Reuniões conduzidas",
    fields: [M.owner, M.start, GOALS],
    rule: "Reuniões atribuídas ao vendedor (“Activity assigned to”) cujo “Meeting start time” já passou, dentro do período.",
  }),
  sellerScheduled: (): DataSource => ({
    title: "Agendou (como SDR)",
    fields: [M.creator, M.created, M.allOwners, OWNERS_API, GOALS],
    rule: "Reuniões que o vendedor criou (“Created by user ID”, ligado a ele pelo userId da API de proprietários) com “Create date” no período. “Para outros” = criadas para outra pessoa conduzir.",
  }),
  sellerAgenda: (): DataSource => ({
    title: "Agenda do vendedor",
    fields: [M.owner, M.start, M.outcome],
    rule: `Reuniões atribuídas ao vendedor (“Activity assigned to”) com “Meeting start time” no período, separadas pelo “Meeting outcome”. ${UNRECORDED}`,
  }),
  sellerStages: (a: Attribution): DataSource => ({
    title: "Negócios em aberto por etapa",
    fields: [attrField(a), D.pipeline, D.stage, D.amount, D.probability, D.isClosed, PIPELINES_API],
    rule: "Negócios em aberto do vendedor agrupados por pipeline e “Deal Stage”, com “Amount” e “Amount” × “Deal probability”.",
  }),

  goalsTable: (): DataSource => ({
    title: "Cadastro de metas",
    fields: [GOALS, OWNERS_API],
    rule: "Metas digitadas aqui, por vendedor e mês. A lista de vendedores vem dos proprietários da HubSpot. Receita e ganhos são comparados com negócios ganhos; reuniões conduzidas com “Activity assigned to”; agendamentos com “Created by user ID”.",
  }),
  pipelineSettings: (): DataSource => ({
    title: "Pipelines que contam como venda",
    fields: [SALES_PIPELINES, D.pipeline, PIPELINES_API],
    rule: "Configuração do FAROL. Desmarcar um pipeline tira os negócios dele (pelo campo “Pipeline”) de todos os números de receita, ganhos, previsão e metas.",
  }),
};
