import { createClient } from "npm:@supabase/supabase-js@2";
import { logIntegrationCall } from "../_shared/integrationLog.ts";
import {
  acquireIuliLock,
  IuliError,
  type IuliCaller,
  IuliRateLimited,
  iuliLockedUntil,
  OutOfBudget,
  releasedTools,
  releaseIuliLock,
  retryingCaller,
} from "../_shared/iuliMcp.ts";

// Baixa da IULI cada venda, título a receber, nota fiscal e assinatura para as
// tabelas iuli_* — é o que permite filtrar o Dashboard Financeiro por qualquer
// período, cliente, status e produto.
//
// A IULI não tem filtro de "alterado desde", é lenta (~5s por página de
// vendas) e tem cota de uso. Então o trabalho é dividido em "passos" de uma
// página, com o progresso em iuli_sync_state, e a atualização é feita em
// camadas pelo que muda de verdade:
//
//   a cada hora  *:recent            janela de 90 dias (venda nova, status recente, baixa recente)
//                transactions:recent categoria (list_transactions) dos lançamentos pagos/vencendo em volta de hoje
//                categories:full     plano de contas (list_categories), 1x por dia
//   1x por dia   transactions:open / :classify  em aberto fora da janela; "a classificar" (podem ser recategorizados)
//   1x por mês   transactions:backfill  histórico da categoria, do mês atual para trás até TX_FLOOR
//   a cada 6h    invoices:undated   as 100 negadas mais recentes (a IULI não grava data nelas)
//                subscriptions:full  todas as assinaturas (são poucas)
//                conciliation:recent log de conciliação da IULI → títulos que receberam baixa
//   1x por dia   receivables:pending todos os títulos sem baixa, de qualquer data
//                sales:12m           vendas dos últimos 12 meses (reembolso, chargeback)
//                invoices:6m         notas dos últimos 6 meses (cancelamentos)
//   a cada 2h    conferência         base local × totais oficiais da IULI (iuli_consistency)
//   1x por mês   *:full              releitura completa (rede de segurança)
//   sob demanda  repair:*            releitura de uma data/mês: título que saiu da lista
//                                    "sem baixa", mês que não bateu na conferência, etc.
//
// Registro que some da IULI não é apagado: ganha removed_at (e volta se reaparecer).
// As camadas diárias e a conferência só começam depois da carga inicial completa.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

const BUDGET_MS = 100_000;
// Teto de chamadas por execução. A IULI tem uma cota não documentada (bloqueou
// por 25 min depois de ~550 chamadas em ~45 min). Com o cron a cada 10 min,
// 30 chamadas/execução = ~180/h, bem abaixo disso.
const MAX_CALLS = 30;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const PAGE = 100;
const INVOICES_START = "2020-01-01";
const FULL_TASKS = ["sales:full", "receivables:full", "invoices:full"];
// A cada 2h: é só SQL (não chama a IULI) e evita aviso de divergência velho na tela depois que os reparos já corrigiram.
const CONSISTENCY_EVERY = 2 * HOUR;
const MAX_NEW_REPAIRS = 8;

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
type Cursor = Record<string, unknown>;
// deno-lint-ignore no-explicit-any
type Admin = any;
type Table = "iuli_sales" | "iuli_receivables" | "iuli_invoices" | "iuli_subscriptions" | "iuli_categories";

interface Ctx {
  call: IuliCaller;
  admin: Admin;
  integrationId: string;
  workspaceId: string;
  today: string;
  // chave do HMAC do documento (IULI_DOC_HASH_KEY); sem ela o doc_hash não é preenchido
  docKey: CryptoKey | null;
}

interface StepResult {
  rows: Row[];
  // lançamentos (list_transactions): só preenchem a categoria em títulos que já existem
  txRows?: Row[];
  table?: Table;
  next: Cursor | null;
  total?: number | null;
  warning?: string;
}

interface TaskDef {
  task: string;
  tool: string; // função da IULI que a tarefa usa — tarefa é pulada se o token não liberar
  every: number;
  // 0 = curta (roda antes de tudo), 1 = diária/reparo, 2 = releitura mensal
  tier: 0 | 1 | 2;
  // só depois da carga inicial completa
  afterInitialLoad?: boolean;
  init: (ctx: Ctx) => Cursor;
  step: (ctx: Ctx, cursor: Cursor) => Promise<StepResult>;
  // ao terminar uma varredura: marcar removidos, agendar reparos…
  onComplete?: (ctx: Ctx, sweepStartedAt: string, cursor: Cursor) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Datas (fuso de São Paulo pra "hoje"; a IULI fecha mês de venda em UTC)
// ---------------------------------------------------------------------------

function todaySP(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function monthBounds(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}` };
}

const dateOnly = (v: unknown) => (typeof v === "string" && v ? v.slice(0, 10) : null);
const ts = (v: unknown) => (typeof v === "string" && v ? v : null);
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

// ---------------------------------------------------------------------------
// Mapeamento IULI → tabela (sem CPF/CNPJ). removed_at: null = "visto agora".
// ---------------------------------------------------------------------------

const saleRow = (i: Row) => ({
  iuli_id: i.id,
  status: i.status ?? null,
  valor_total: num(i.valor_total),
  valor_liquido: num(i.valor_liquido),
  competencia: ts(i.competencia),
  pagamento: ts(i.pagamento),
  external_id: i.external_id ? String(i.external_id) : null,
  venda_mae_id: num(i.venda_mae_id),
  nfe_status: num(i.nfe_status),
  cliente: i.cliente ?? null,
  descricao: i.descricao ?? null,
  removed_at: null,
});

const receivableRow = (i: Row) => ({
  iuli_id: i.id,
  description: i.description ?? null,
  status: i.status ?? null,
  due_date: dateOnly(i.due_date),
  competencia: dateOnly(i.competencia),
  pagamento: dateOnly(i.pagamento),
  valor: num(i.valor),
  valor_pago: num(i.valor_pago),
  juros: num(i.juros),
  empresa: i.empresa ?? null,
  nf_numero: i.nf_numero ?? null,
  qtd_anexos: num(i.qtd_anexos),
  tipos_anexo: Array.isArray(i.tipos_anexo) ? i.tipos_anexo.map(String) : [],
  tem_anexo: !!i.tem_anexo,
  tem_boleto: !!i.tem_boleto,
  tem_comprovante: !!i.tem_comprovante,
  tem_nf: !!i.tem_nf,
  // só em trânsito: vira doc_hash antes de gravar (o documento em claro não é guardado)
  _documento: i.documento ?? null,
  removed_at: null,
});

const categoryRow = (i: Row) => ({
  iuli_id: i.id,
  nome: i.nome ?? "",
  nivel: num(i.nivel),
  pai_id: num(i.categoria_pai_id),
  tipo: num(i.type),
  dre_category_id: num(i.dre_category_id),
  categoria_dre: i.categoria_dre ?? null,
  codigo_contabil: i.codigo_contabil ?? null,
  removed_at: null,
});

const txRow = (i: Row) => ({
  iuli_id: i.id,
  categoria_id: num(i.categoria_id),
  categoria: i.categoria ?? null,
  venda_id: num(i.venda_id),
  contraparte: i.contraparte ?? null,
  conta_id: num(i.conta_id),
  conciliado: i.conciliado == null ? null : !!i.conciliado,
});

/** HMAC-SHA256 (hex) só dos dígitos do CPF/CNPJ; null se não houver documento ou chave. */
async function docHash(key: CryptoKey | null, documento: unknown): Promise<string | null> {
  const digits = String(documento ?? "").replace(/\D/g, "");
  if (!key || !digits) return null;
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(digits));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function importDocKey(): Promise<CryptoKey | null> {
  const secret = Deno.env.get("IULI_DOC_HASH_KEY");
  if (!secret) return null;
  return await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

const invoiceRow = (i: Row) => ({
  iuli_id: i.id,
  numero: i.numero ?? null,
  serie: i.serie ?? null,
  valor: num(i.valor),
  status: i.status ?? null,
  detalhe_status: i.detalhe_status?.trim() || null,
  venda_id: num(i.venda_id),
  lancamento_id: num(i.lancamento_id),
  invoice_type: num(i.invoice_type),
  criada_em: ts(i.criada_em),
  atualizada_em: ts(i.atualizada_em),
  removed_at: null,
});

const subscriptionRow = (i: Row) => ({
  iuli_id: i.id,
  status: i.status != null ? String(i.status) : null,
  ciclo: i.ciclo ?? null,
  valor: num(i.valor),
  valor_mensalizado: num(i.valor_mensalizado),
  forma_pagamento: i.forma_pagamento != null ? String(i.forma_pagamento) : null,
  origem: i.origem != null ? String(i.origem) : null,
  criada_em: ts(i.criada_em),
  proximo_vencimento: ts(i.proximo_vencimento),
  fim: ts(i.fim),
  external_id: i.external_id ? String(i.external_id) : null,
  cliente: i.cliente ?? null,
  produto: i.produto ?? null,
  removed_at: null,
});

// ---------------------------------------------------------------------------
// Passos
// ---------------------------------------------------------------------------

/** Paginação por offset (vendas, títulos, assinaturas). */
function offsetStep(tool: string, table: Table, map: (i: Row) => Row, extraArgs: (cursor: Cursor) => Record<string, unknown> = () => ({})) {
  return async (ctx: Ctx, cursor: Cursor): Promise<StepResult> => {
    const offset = Number(cursor.offset ?? 0);
    const page = await ctx.call(tool, { ...extraArgs(cursor), limit: PAGE, offset });
    const items: Row[] = page?.itens ?? [];
    const next = page?.ha_mais && items.length ? { ...cursor, offset: offset + items.length } : null;
    return { rows: items.map(map), table, next, total: page?.total_encontrado ?? null };
  };
}

/**
 * Lançamentos de receita (list_transactions) — categoria de cada título.
 *
 * O cursor carrega uma lista de "passadas" (campo de data + intervalo + filtros)
 * e anda página a página por elas. A carga histórica vai do mês atual para trás
 * (o mês corrente fica pronto primeiro) e, por mês, lê o que foi PAGO nele e o
 * que VENCE nele — assim Receita (data de pagamento) e Caixa (vencimento)
 * ficam completos, mesmo antes do histórico inteiro chegar.
 */
interface TxPass {
  date_field?: "due_date" | "payment_date";
  payed?: boolean;
  start?: string;
  end?: string;
  classify?: boolean; // só "sem categoria" / "a classificar"
}

const TX_FLOOR = "2025-01"; // histórico mais antigo da carga inicial; o resto é sob demanda

function txBackfillPasses(today: string, floor = TX_FLOOR): TxPass[] {
  const passes: TxPass[] = [];
  let ym = today.slice(0, 7);
  for (let guard = 0; guard < 120; guard++) {
    const { from, to } = monthBounds(ym);
    passes.push({ date_field: "payment_date", payed: true, start: from, end: to });
    passes.push({ date_field: "due_date", start: from, end: to });
    if (ym <= floor) break;
    const [y, m] = ym.split("-").map(Number);
    ym = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  }
  return passes;
}

async function txStep(ctx: Ctx, cursor: Cursor): Promise<StepResult> {
  const passes = (cursor.passes ?? []) as TxPass[];
  const i = Number(cursor.i ?? 0);
  const offset = Number(cursor.offset ?? 0);
  const pass = passes[i];
  if (!pass) return { rows: [], next: null };

  const args: Record<string, unknown> = { type: "receita", limit: PAGE, offset };
  if (pass.date_field) args.date_field = pass.date_field;
  if (pass.start) args.start_date = pass.start;
  if (pass.end) args.end_date = pass.end;
  if (pass.payed !== undefined) args.payed = pass.payed;
  if (pass.classify) args.categoria_a_classificar = true;

  const page = await ctx.call("list_transactions", args);
  const items: Row[] = page?.itens ?? [];
  let next: Cursor | null = null;
  if (page?.ha_mais && items.length) next = { ...cursor, i, offset: offset + items.length };
  else if (i + 1 < passes.length) next = { ...cursor, i: i + 1, offset: 0 };
  return { rows: [], txRows: items.map(txRow), next, total: page?.total_encontrado ?? null };
}

/**
 * Notas: list_invoices não pagina (devolve no máximo 100 por consulta) e o
 * filtro de data só aceita o dia inteiro. O Farol anda por janelas de datas
 * pela criação da nota, com tamanho ajustado ao volume (mira ~70 por consulta).
 *
 * Corte detectado pelo por_status (contagem exata da janela) > itens recebidos:
 * janela de vários dias é refeita menor; um dia só que ainda passa de 100 é dia
 * de emissão em lote (ex: 255 notas em 18s) — aí o Farol guarda a contagem
 * exata do dia em iuli_invoice_day_counts e busca à parte, por status, as
 * notas não autorizadas (negadas, canceladas…), que são as que importam item a
 * item. Das autorizadas desses dias ficam só as 100 que a IULI devolve.
 */
const INVOICES_TARGET = 70;
const INVOICES_MAX_SPAN = 60;

// Status do por_status → valor aceito no filtro status de list_invoices.
const INVOICE_STATUS_FILTER: Record<string, string> = {
  negada: "negada",
  cancelamento_negado: "negada",
  cancelada: "cancelada",
  solicitando_cancelamento: "cancelada",
  processando: "processando",
  externa: "externa",
};

async function invoicesWindowStep(ctx: Ctx, cursor: Cursor): Promise<StepResult> {
  const from = String(cursor.from);
  const until = String(cursor.until);
  let span = Math.max(1, Number(cursor.span ?? 7));
  let warning: string | undefined;

  for (;;) {
    const to = addDays(from, span - 1) < until ? addDays(from, span - 1) : until;
    const page = await ctx.call("list_invoices", { start_date: from, end_date: to, limit: PAGE });
    let items: Row[] = page?.itens ?? [];
    const porStatus: { status: string; qtd: number }[] = page?.por_status ?? [];
    const exact = porStatus.reduce((a, r) => a + Number(r.qtd ?? 0), 0);
    const truncated = exact > items.length || (!porStatus.length && items.length >= PAGE);

    if (truncated && span > 1) {
      span = Math.max(1, Math.floor(span / 2)); // estourou: refaz a mesma janela menor
      continue;
    }

    if (truncated) {
      // Dia de emissão em lote: contagem exata + não autorizadas item a item.
      await ctx.admin.from("iuli_invoice_day_counts").delete().eq("integration_id", ctx.integrationId).eq("dia", from);
      if (porStatus.length) {
        await ctx.admin.from("iuli_invoice_day_counts").insert(
          porStatus.map((r) => ({
            integration_id: ctx.integrationId,
            workspace_id: ctx.workspaceId,
            dia: from,
            status: r.status,
            qtd: Number(r.qtd ?? 0),
          })),
        );
      }
      const filters = new Set(porStatus.filter((r) => r.status !== "autorizada" && Number(r.qtd) > 0).map((r) => INVOICE_STATUS_FILTER[r.status]).filter(Boolean));
      for (const status of filters) {
        const extra: Row[] = (await ctx.call("list_invoices", { start_date: from, end_date: from, status, limit: PAGE }))?.itens ?? [];
        if (extra.length >= PAGE) warning = `notas ${status} de ${from} passaram de ${PAGE} — só as ${PAGE} primeiras foram trazidas`;
        items = items.concat(extra);
      }
    }

    const nextFrom = addDays(to, 1);
    const nextSpan = Math.min(INVOICES_MAX_SPAN, Math.max(1, Math.floor((span * INVOICES_TARGET) / Math.max(exact || items.length, 1))));
    return {
      rows: items.map(invoiceRow),
      table: "iuli_invoices",
      next: nextFrom <= until ? { ...cursor, from: nextFrom, span: nextSpan } : null,
      warning,
    };
  }
}

// ---------------------------------------------------------------------------
// Reparos: releitura de um intervalo de datas, marcando como removido o que
// não aparecer mais. task = "repair:<tabela>:<de>:<até>"
// ---------------------------------------------------------------------------

type RepairTable = "iuli_sales" | "iuli_receivables" | "iuli_invoices";

const REPAIR_TOOL: Record<"iuli_sales" | "iuli_receivables", { tool: string; map: (i: Row) => Row; args: Record<string, unknown> }> = {
  iuli_sales: { tool: "list_sales", map: saleRow, args: {} },
  iuli_receivables: { tool: "get_accounts_receivable", map: receivableRow, args: { status: "all" } },
};

async function enqueueRepair(ctx: Ctx, table: RepairTable, from: string, to: string, markRemovedBefore: string | null) {
  const task = `repair:${table}:${from}:${to}`;
  // ignoreDuplicates: se já tem o mesmo reparo na fila, mantém o que está lá.
  await ctx.admin.from("iuli_sync_state").upsert(
    {
      integration_id: ctx.integrationId,
      task,
      workspace_id: ctx.workspaceId,
      cursor: { offset: 0, from, to, markRemovedBefore },
      next_run_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "integration_id,task", ignoreDuplicates: true },
  );
}

function repairTaskDef(task: string): TaskDef | null {
  const [, table, from, to] = task.split(":");
  if (table === "iuli_invoices" && from && to) {
    // Notas: relê as janelas do intervalo (inclui o tratamento de dia em lote).
    return {
      task,
      tool: "list_invoices",
      every: 0,
      tier: 1,
      init: () => ({ from, until: to, span: 1 }),
      step: (ctx, c) => invoicesWindowStep(ctx, { ...c, from: c.from ?? from, until: c.until ?? to, span: c.span ?? 1 }),
      onComplete: async (ctx) => {
        await ctx.admin.from("iuli_sync_state").delete().eq("integration_id", ctx.integrationId).eq("task", task);
      },
    };
  }
  const def = REPAIR_TOOL[table as keyof typeof REPAIR_TOOL];
  if (!def || !from || !to) return null;
  return {
    task,
    tool: def.tool,
    every: 0,
    tier: 1,
    init: () => ({ offset: 0, from, to }),
    step: offsetStep(def.tool, table as Table, def.map, () => ({ ...def.args, start_date: from, end_date: to })),
    onComplete: async (ctx, _startedAt, cursor) => {
      const before = cursor.markRemovedBefore as string | null;
      if (before) {
        let q = ctx.admin.from(table).update({ removed_at: new Date().toISOString() })
          .eq("integration_id", ctx.integrationId)
          .is("removed_at", null)
          .lt("synced_at", before);
        q = table === "iuli_sales"
          ? q.gte("competencia", `${from}T00:00:00Z`).lt("competencia", `${addDays(to, 1)}T00:00:00Z`)
          : q.gte("due_date", from).lte("due_date", to);
        await q;
      }
      // reparo é de uma vez só
      await ctx.admin.from("iuli_sync_state").delete().eq("integration_id", ctx.integrationId).eq("task", task);
    },
  };
}

/** Linhas não vistas desde o início da varredura → reparo por mês (antes de marcar removido). */
async function repairUnseen(ctx: Ctx, table: "iuli_sales" | "iuli_receivables", sweepStartedAt: string, onlyPending = false) {
  const dateCol = table === "iuli_sales" ? "competencia" : "due_date";
  let q = ctx.admin.from(table).select(dateCol).eq("integration_id", ctx.integrationId).is("removed_at", null).lt("synced_at", sweepStartedAt).limit(5000);
  if (onlyPending) q = q.neq("status", "recebida");
  const { data } = await q;
  const groups = new Set<string>();
  for (const r of data ?? []) {
    const d = String(r[dateCol] ?? "").slice(0, onlyPending ? 10 : 7);
    if (d) groups.add(d);
  }
  for (const g of groups) {
    if (onlyPending) await enqueueRepair(ctx, table, g, g, sweepStartedAt); // título: pelo dia de vencimento
    else {
      const { from, to } = monthBounds(g);
      await enqueueRepair(ctx, table, from, to, sweepStartedAt);
    }
  }
}

/** Marca como removido o que não apareceu numa varredura de janela fixa (notas, assinaturas). */
async function markUnseenRemoved(ctx: Ctx, table: Table, sweepStartedAt: string) {
  await ctx.admin.from(table).update({ removed_at: new Date().toISOString() })
    .eq("integration_id", ctx.integrationId)
    .is("removed_at", null)
    .lt("synced_at", sweepStartedAt);
}

// ---------------------------------------------------------------------------
// Tarefas
// ---------------------------------------------------------------------------

const TASKS: TaskDef[] = [
  // --- a cada hora ---
  {
    task: "subscriptions:full",
    tool: "list_subscriptions",
    every: 6 * HOUR,
    tier: 0,
    init: () => ({ offset: 0 }),
    step: offsetStep("list_subscriptions", "iuli_subscriptions", subscriptionRow),
    onComplete: (ctx, startedAt) => markUnseenRemoved(ctx, "iuli_subscriptions", startedAt),
  },
  {
    task: "sales:recent",
    tool: "list_sales",
    every: HOUR,
    tier: 0,
    init: ({ today }) => ({ offset: 0, start_date: addDays(today, -90), end_date: addDays(today, 365) }),
    step: offsetStep("list_sales", "iuli_sales", saleRow, (c) => ({ start_date: c.start_date, end_date: c.end_date })),
  },
  {
    task: "receivables:recent",
    tool: "get_accounts_receivable",
    every: HOUR,
    tier: 0,
    init: ({ today }) => ({ offset: 0, start_date: addDays(today, -90), end_date: addDays(today, 90) }),
    step: offsetStep("get_accounts_receivable", "iuli_receivables", receivableRow, (c) => ({ status: "all", start_date: c.start_date, end_date: c.end_date })),
  },
  {
    task: "invoices:recent",
    tool: "list_invoices",
    every: HOUR,
    tier: 0,
    init: ({ today }) => ({ from: addDays(today, -34), until: today }),
    step: invoicesWindowStep,
  },
  {
    // Atalho: título que recebeu baixa via conciliação bancária aparece no log
    // com o mesmo id (lancamento_id) — relê o dia de vencimento dele.
    task: "conciliation:recent",
    tool: "list_logs",
    every: HOUR,
    tier: 0,
    afterInitialLoad: true,
    init: () => ({}),
    step: async (ctx) => {
      const log = await ctx.call("list_logs", { type: "conciliacao", start_date: addDays(ctx.today, -2), end_date: ctx.today, limit: PAGE });
      const ids = [...new Set((log?.eventos ?? []).map((e: Row) => e.lancamento_id).filter(Boolean))];
      if (ids.length) {
        const { data } = await ctx.admin
          .from("iuli_receivables")
          .select("due_date")
          .eq("integration_id", ctx.integrationId)
          .in("iuli_id", ids)
          .neq("status", "recebida");
        for (const d of new Set((data ?? []).map((r: Row) => r.due_date).filter(Boolean))) {
          await enqueueRepair(ctx, "iuli_receivables", String(d), String(d), null);
        }
      }
      return { rows: [], next: null };
    },
  },
  {
    // Negadas sem data: a IULI não grava criada_em nelas, então a busca por
    // janela de data nunca as encontra. Sem data, a IULI devolve as 100 mais
    // recentes (não pagina) — guardamos essas; a contagem exata vem do
    // snapshot invoices:all (sync-iuli).
    task: "invoices:undated",
    tool: "list_invoices",
    every: 6 * HOUR,
    tier: 0,
    init: () => ({}),
    step: async (ctx) => {
      const page = await ctx.call("list_invoices", { status: "negada", limit: PAGE });
      return { rows: (page?.itens ?? []).map(invoiceRow), table: "iuli_invoices", next: null };
    },
  },
  {
    // Plano de contas (categorias e grupo DRE) — poucas centenas, uma página.
    task: "categories:full",
    tool: "list_categories",
    every: DAY,
    tier: 0,
    init: () => ({}),
    step: async (ctx) => {
      const page = await ctx.call("list_categories", { limit: 500 });
      return { rows: (page?.itens ?? []).map(categoryRow), table: "iuli_categories", next: null };
    },
  },
  {
    // Categoria dos lançamentos recentes: pagos nos últimos 35 dias e com vencimento de -30 a +60.
    task: "transactions:recent",
    tool: "list_transactions",
    every: HOUR,
    tier: 0,
    init: ({ today }) => ({
      i: 0,
      offset: 0,
      passes: [
        { date_field: "payment_date", payed: true, start: addDays(today, -35), end: today },
        { date_field: "due_date", start: addDays(today, -30), end: addDays(today, 60) },
      ] satisfies TxPass[],
    }),
    step: txStep,
  },
  // --- 1x por dia ---
  {
    // Em aberto fora da janela recente (vencidos antigos e a vencer longe) — o Caixa precisa deles.
    task: "transactions:open",
    tool: "list_transactions",
    every: DAY,
    tier: 1,
    init: ({ today }) => ({
      i: 0,
      offset: 0,
      passes: [
        { date_field: "due_date", payed: false, start: "2020-01-01", end: addDays(today, -31) },
        { date_field: "due_date", start: addDays(today, 61), end: "2099-12-31" },
      ] satisfies TxPass[],
    }),
    step: txStep,
  },
  {
    // "RECEITA A CLASSIFICAR"/sem categoria: o financeiro corrige depois, então relê todo dia.
    task: "transactions:classify",
    tool: "list_transactions",
    every: DAY,
    tier: 1,
    init: () => ({ i: 0, offset: 0, passes: [{ classify: true }] satisfies TxPass[] }),
    step: txStep,
  },
  {
    task: "receivables:pending",
    tool: "get_accounts_receivable",
    every: DAY,
    tier: 1,
    afterInitialLoad: true,
    init: () => ({ offset: 0 }),
    step: offsetStep("get_accounts_receivable", "iuli_receivables", receivableRow, () => ({ status: "pending" })),
    // Quem era "sem baixa" e não veio agora recebeu baixa (ou foi apagado): relê pelo dia de vencimento.
    onComplete: (ctx, startedAt) => repairUnseen(ctx, "iuli_receivables", startedAt, true),
  },
  {
    task: "sales:12m",
    tool: "list_sales",
    every: DAY,
    tier: 1,
    afterInitialLoad: true,
    init: ({ today }) => ({ offset: 0, start_date: addDays(today, -365), end_date: addDays(today, 365) }),
    step: offsetStep("list_sales", "iuli_sales", saleRow, (c) => ({ start_date: c.start_date, end_date: c.end_date })),
  },
  {
    task: "invoices:6m",
    tool: "list_invoices",
    every: DAY,
    tier: 1,
    afterInitialLoad: true,
    init: ({ today }) => ({ from: addDays(today, -183), until: today }),
    step: invoicesWindowStep,
  },
  // --- 1x por mês (a primeira passada é a carga inicial) ---
  {
    // Carga histórica da categoria: do mês atual para trás, até TX_FLOOR.
    task: "transactions:backfill",
    tool: "list_transactions",
    every: 30 * DAY,
    tier: 1,
    init: ({ today }) => ({ i: 0, offset: 0, passes: txBackfillPasses(today) }),
    step: txStep,
  },
  {
    task: "sales:full",
    tool: "list_sales",
    every: 30 * DAY,
    tier: 2,
    init: () => ({ offset: 0 }),
    step: offsetStep("list_sales", "iuli_sales", saleRow),
    onComplete: (ctx, startedAt) => repairUnseen(ctx, "iuli_sales", startedAt),
  },
  {
    task: "receivables:full",
    tool: "get_accounts_receivable",
    every: 30 * DAY,
    tier: 2,
    init: () => ({ offset: 0 }),
    step: offsetStep("get_accounts_receivable", "iuli_receivables", receivableRow, () => ({ status: "all" })),
    onComplete: (ctx, startedAt) => repairUnseen(ctx, "iuli_receivables", startedAt),
  },
  {
    task: "invoices:full",
    tool: "list_invoices",
    every: 30 * DAY,
    tier: 2,
    init: ({ today }) => ({ from: INVOICES_START, until: today }),
    step: invoicesWindowStep,
    onComplete: (ctx, startedAt) => markUnseenRemoved(ctx, "iuli_invoices", startedAt),
  },
];

// ---------------------------------------------------------------------------
// Conferência contra os totais oficiais da IULI (1x por dia)
// ---------------------------------------------------------------------------

async function runConsistency(ctx: Ctx, state: Map<string, Row>) {
  const prev = state.get("__consistency");
  const checkedAt = prev?.cursor?.checked_at as string | undefined;
  if (checkedAt && Date.now() - new Date(checkedAt).getTime() < CONSISTENCY_EVERY) return null;

  const { data: mismatches, error } = await ctx.admin.rpc("iuli_consistency", { p_integration_id: ctx.integrationId });
  if (error) return { error: error.message };

  // Não repete reparo do mesmo período em menos de 7 dias — se continuar
  // divergindo depois disso, é diferença de regra, não de dado: fica só o aviso.
  const repaired: Record<string, string> = { ...(prev?.cursor?.repaired ?? {}) };
  const recent = (k: string) => repaired[k] && Date.now() - new Date(repaired[k]).getTime() < 7 * DAY;
  let created = 0;
  for (const m of (mismatches ?? []) as Row[]) {
    if (created >= MAX_NEW_REPAIRS) break;
    if (m.scope === "receivables_open_total") {
      // total sem baixa não bate: antecipa a varredura dos sem baixa
      if (!recent("receivables_open_total")) {
        await ctx.admin.from("iuli_sync_state").update({ next_run_at: new Date().toISOString() })
          .eq("integration_id", ctx.integrationId).eq("task", "receivables:pending").not("completed_at", "is", null);
        repaired.receivables_open_total = new Date().toISOString();
        created++;
      }
      continue;
    }
    const table: RepairTable = m.scope === "sales" ? "iuli_sales" : m.scope === "invoices" ? "iuli_invoices" : "iuli_receivables";
    const key = `${table}:${m.period}`;
    if (recent(key)) continue;
    const { from, to } = monthBounds(String(m.period));
    // Notas não marcam removido (a releitura pode vir cortada pela própria IULI).
    await enqueueRepair(ctx, table, from, to, table === "iuli_invoices" ? null : new Date().toISOString());
    repaired[key] = new Date().toISOString();
    created++;
  }

  const cursor = { checked_at: new Date().toISOString(), mismatches: mismatches ?? [], repaired };
  await ctx.admin.from("iuli_sync_state").upsert(
    { integration_id: ctx.integrationId, task: "__consistency", workspace_id: ctx.workspaceId, cursor, completed_at: cursor.checked_at, updated_at: cursor.checked_at },
    { onConflict: "integration_id,task" },
  );
  return { mismatches: (mismatches ?? []).length, repairs_created: created };
}

// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  const startedAt = Date.now();
  let workspaceId: string | null = null;
  let integrationId: string | null = null;
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const log = (params: { status: "success" | "error"; statusCode: number; response?: unknown; errorMessage?: string }) =>
    logIntegrationCall(admin, {
      workspaceId,
      integrationId,
      provider: "iuli",
      direction: "outbound",
      eventType: "sync_records",
      request: { integration_id: integrationId },
      durationMs: Date.now() - startedAt,
      ...params,
    });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      await log({ status: "error", statusCode: 401, errorMessage: "missing authorization" });
      return json({ error: "missing authorization" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    // force_recent: botão "Atualizar agora" — relê as janelas recentes mesmo sem estarem vencidas.
    const { integration_id, force_recent } = body as { integration_id?: string; force_recent?: boolean };
    if (!integration_id) {
      await log({ status: "error", statusCode: 400, errorMessage: "integration_id required" });
      return json({ error: "integration_id required" }, 400);
    }
    integrationId = integration_id;

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const internalToken = Deno.env.get("FAROL_INTERNAL_TOKEN");
    const bearer = authHeader.replace(/^Bearer\s+/i, "");
    const isTrustedInternalCall = !!internalToken && bearer === internalToken;

    const { data: integration, error: integrationError } = await admin
      .from("integrations")
      .select("id, workspace_id, config")
      .eq("id", integration_id)
      .eq("provider", "iuli")
      .single();
    if (integrationError || !integration) {
      await log({ status: "error", statusCode: 404, errorMessage: "integration not found" });
      return json({ error: "integration not found" }, 404);
    }
    workspaceId = integration.workspace_id;

    if (!isTrustedInternalCall) {
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData, error: userError } = await userClient.auth.getUser();
      if (userError || !userData.user) {
        await log({ status: "error", statusCode: 401, errorMessage: `invalid session: ${userError?.message ?? "sem usuário"}` });
        return json({ error: "invalid session" }, 401);
      }
      const { data: membership } = await admin
        .from("workspace_members")
        .select("id")
        .eq("workspace_id", integration.workspace_id)
        .eq("user_id", userData.user.id)
        .eq("is_active", true)
        .maybeSingle();
      if (!membership) {
        await log({ status: "error", statusCode: 403, errorMessage: "forbidden: usuário não é membro ativo do workspace" });
        return json({ error: "forbidden" }, 403);
      }
    }

    if (!(await acquireIuliLock(admin, integration_id, integration.workspace_id, BUDGET_MS + 60_000))) {
      return json({ busy: true, locked_until: await iuliLockedUntil(admin, integration_id) });
    }

    let pauseUntil: Date | undefined;
    try {
      const { data: secret } = await admin
        .from("integration_secrets")
        .select("api_key")
        .eq("integration_id", integration_id)
        .maybeSingle();
      if (!secret) {
        await log({ status: "error", statusCode: 400, errorMessage: "no api key saved" });
        return json({ error: "no api key saved" }, 400);
      }

      const ctx: Ctx = {
        call: retryingCaller(secret.api_key, startedAt + BUDGET_MS, MAX_CALLS),
        admin,
        integrationId: integration_id,
        workspaceId: integration.workspace_id,
        today: todaySP(),
        docKey: await importDocKey(),
      };

      const loadState = async () => {
        const { data } = await admin
          .from("iuli_sync_state")
          .select("task, cursor, started_at, completed_at, next_run_at, rows_synced")
          .eq("integration_id", integration_id);
        return new Map<string, Row>((data ?? []).map((r: Row) => [r.task, r]));
      };
      let state = await loadState();

      // Cada empresa tem um token com funções diferentes: tarefa cuja função não
      // está liberada é pulada (e o estado antigo dela, com erro, é descartado).
      const tools = await releasedTools(admin, integration_id, secret.api_key, integration.config);
      const allowed = (t: { task: string; tool: string }) => !tools || tools.has(t.tool);
      const skipped = TASKS.filter((t) => !allowed(t)).map((t) => t.task);
      if (skipped.length) await admin.from("iuli_sync_state").delete().eq("integration_id", integration_id).in("task", skipped);
      const fullTasks = FULL_TASKS.filter((name) => allowed(TASKS.find((t) => t.task === name)!));

      // Carga inicial completa = as releituras completas liberadas terminaram ao menos uma vez.
      const initialLoadDone = state.get("__initial_load")?.completed_at != null;

      let consistency: unknown = null;
      if (initialLoadDone) {
        consistency = await runConsistency(ctx, state);
        state = await loadState(); // a conferência pode ter enfileirado reparos
      }

      const repairDefs = [...state.keys()].filter((t) => t.startsWith("repair:")).map(repairTaskDef).filter((d): d is TaskDef => !!d);
      const defs = [...TASKS, ...repairDefs].filter((t) => allowed(t) && (!t.afterInitialLoad || initialLoadDone));

      // Tarefa ativa = no meio de uma varredura, ou vencida (começa uma nova).
      const now = Date.now();
      const active = defs.filter((t) => {
        const s = state.get(t.task);
        if (!s) return true;
        if (s.started_at && !s.completed_at) return true;
        if (force_recent && t.tier === 0) return true;
        return new Date(s.next_run_at).getTime() <= now;
      });
      for (const t of active) {
        const s = state.get(t.task);
        if (!s || !s.started_at || s.completed_at) {
          // reparo já vem com cursor (markRemovedBefore etc.) — só marca o início
          const cursor = t.task.startsWith("repair:") && s?.cursor ? s.cursor : t.init(ctx);
          state.set(t.task, { task: t.task, cursor, started_at: new Date().toISOString(), completed_at: null, rows_synced: 0 });
        }
      }

      const saveState = (task: string, patch: Row) =>
        admin.from("iuli_sync_state").upsert(
          { integration_id, task, workspace_id: integration.workspace_id, updated_at: new Date().toISOString(), ...patch },
          { onConflict: "integration_id,task" },
        );

      const blocked = new Set<string>();
      const summary: Record<string, { pages: number; rows: number; done: boolean; error?: string }> = {};
      const turns = [0, 0, 0];
      let aborted = false;

      while (Date.now() - startedAt < BUDGET_MS && !aborted) {
        // Camada mais baixa com trabalho pendente; dentro dela, revezando página a página.
        let task: TaskDef | undefined;
        for (const tier of [0, 1, 2] as const) {
          const open = active.filter((t) => t.tier === tier && !blocked.has(t.task) && !summary[t.task]?.done);
          if (open.length) {
            task = open[turns[tier]++ % open.length];
            break;
          }
        }
        if (!task) break;

        const s = state.get(task.task)!;
        const sum = (summary[task.task] ??= { pages: 0, rows: 0, done: false });
        try {
          const result = await task.step(ctx, s.cursor);
          const byId = new Map(result.rows.map((r) => [r.iuli_id, r]));
          const rows = [];
          for (const r of byId.values()) {
            const { _documento, ...rest } = r;
            // doc_hash só quando o título trouxe documento (não apaga o que já existe)
            const hash = result.table === "iuli_receivables" ? await docHash(ctx.docKey, _documento) : null;
            rows.push({
              ...rest,
              ...(hash ? { doc_hash: hash } : {}),
              integration_id,
              workspace_id: integration.workspace_id,
              synced_at: new Date().toISOString(),
            });
          }
          if (result.txRows?.length) {
            const { data: matched, error } = await admin.rpc("iuli_apply_transactions", { p_integration_id: integration_id, p_rows: result.txRows });
            if (error) throw new Error(`aplicar lançamentos: ${error.message}`);
            // os que não casaram ainda não estão em iuli_receivables — a releitura de títulos os traz
            const missing = result.txRows.length - Number(matched ?? 0);
            if (missing > 0) result.warning = `${missing} lançamento(s) sem título correspondente ainda`;
            sum.rows += Number(matched ?? 0);
          }
          if (rows.length && result.table) {
            const { error } = await admin.from(result.table).upsert(rows, { onConflict: "integration_id,iuli_id" });
            if (error) throw new Error(`gravar ${result.table}: ${error.message}`);
          }

          sum.pages++;
          sum.rows += rows.length;
          const patch: Row = {
            cursor: result.next ?? s.cursor,
            started_at: s.started_at,
            rows_synced: Number(s.rows_synced ?? 0) + rows.length,
            last_error: result.warning ?? null,
            ...(result.total != null ? { total_expected: result.total } : {}),
          };
          if (result.next) {
            patch.completed_at = null;
            patch.cursor = result.next;
          } else {
            patch.completed_at = new Date().toISOString();
            patch.next_run_at = new Date(Date.now() + task.every).toISOString();
            sum.done = true;
          }
          await saveState(task.task, patch);
          state.set(task.task, { ...s, ...patch });
          if (!result.next && task.onComplete) await task.onComplete(ctx, s.started_at, s.cursor);
        } catch (err) {
          if (err instanceof OutOfBudget) break;
          if (err instanceof IuliRateLimited) {
            pauseUntil = new Date(Date.now() + err.waitMs);
            sum.error = err.message;
            break;
          }
          const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
          sum.error = message;
          blocked.add(task.task);
          await saveState(task.task, { cursor: s.cursor, started_at: s.started_at, completed_at: null, rows_synced: s.rows_synced ?? 0, last_error: message });
          if (err instanceof IuliError && (err.status === 401 || err.status === 403)) aborted = true;
        }
      }

      // Marca a carga inicial quando as três releituras completas tiverem terminado.
      if (!initialLoadDone && fullTasks.every((t) => state.get(t)?.completed_at)) {
        await saveState("__initial_load", { completed_at: new Date().toISOString() });
      }

      const errors = Object.entries(summary).filter(([, v]) => v.error);
      const result = { summary, consistency, elapsed_ms: Date.now() - startedAt, paused_until: pauseUntil?.toISOString() ?? null };
      await log({
        status: errors.length && errors.length === Object.keys(summary).length ? "error" : "success",
        statusCode: 200,
        response: result,
        errorMessage: errors.length ? errors.map(([k, v]) => `${k}: ${v.error}`).join(" | ").slice(0, 500) : undefined,
      });
      return json(result);
    } finally {
      await releaseIuliLock(admin, integration_id, pauseUntil);
    }
  } catch (err) {
    await log({ status: "error", statusCode: 500, errorMessage: String(err) });
    return json({ error: String(err) }, 500);
  }
});
