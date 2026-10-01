// Cliente mínimo do MCP da IULI (ERP financeiro). O servidor é stateless —
// não devolve Mcp-Session-Id e aceita tools/call direto, sem initialize
// antes — então cada chamada é um POST JSON-RPC isolado. A resposta pode vir
// como JSON puro ou SSE (text/event-stream), dependendo do servidor.
export const IULI_MCP_URL = "https://api.iuli.com.br/mcp";

export class IuliError extends Error {
  constructor(message: string, public status: number | null = null) {
    super(message);
  }
}

export interface IuliTool {
  name: string;
  description?: string;
  inputSchema?: { required?: string[]; properties?: Record<string, unknown> };
}

let nextId = 1;

export async function iuliRpc(token: string, method: string, params: Record<string, unknown> = {}) {
  const res = await fetch(IULI_MCP_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "User-Agent": "farol-id/1.0",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
  });

  let raw = await res.text();
  if (!res.ok) throw new IuliError(raw.slice(0, 300) || `HTTP ${res.status}`, res.status);

  if ((res.headers.get("Content-Type") ?? "").includes("text/event-stream")) {
    const dataLines = raw.split("\n").filter((l) => l.startsWith("data:"));
    raw = dataLines.at(-1)?.slice(5).trim() ?? "";
  }

  const message = JSON.parse(raw);
  if (message.error) throw new IuliError(message.error.message ?? JSON.stringify(message.error), res.status);
  return message.result;
}

export async function iuliListTools(token: string): Promise<IuliTool[]> {
  const result = await iuliRpc(token, "tools/list");
  return result?.tools ?? [];
}

// As tools da IULI devolvem o payload como JSON dentro de content[0].text.
export async function iuliCallTool(token: string, name: string, args: Record<string, unknown> = {}) {
  const result = await iuliRpc(token, "tools/call", { name, arguments: args });
  const text = (result?.content ?? []).map((c: { text?: string }) => c.text ?? "").join("");
  if (result?.isError) throw new IuliError(text.slice(0, 300) || "tool retornou erro");
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ---------------------------------------------------------------------------
// Limites da IULI — 429 em três casos:
//  - consulta paralela da mesma empresa ("Há consultas demais em andamento")
//  - volume curto ("Limite de requisições excedido. Tente novamente em N segundos")
//  - cota longa ("... Tente novamente em N minutos") — veio depois de ~550
//    chamadas em ~45 min na carga inicial (29/09/2026); não é documentada.
// Espera curta (até 60s): espera e tenta de novo; se não couber no prazo da
// execução, OutOfBudget (não é erro, a próxima rodada continua). Espera longa:
// IuliRateLimited — quem chamou trava a integração até o horário pedido.
// ---------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
export type IuliCaller = (tool: string, args: Record<string, unknown>) => Promise<any>;

export class OutOfBudget extends Error {}

export class IuliRateLimited extends Error {
  constructor(public waitMs: number) {
    super(`IULI pediu pausa de ${Math.round(waitMs / 60_000)} min (limite de requisições)`);
  }
}

const LONG_WAIT_MS = 60_000;

function retryAfterMs(err: unknown): number | null {
  if (!(err instanceof IuliError) || err.status !== 429) return null;
  const m = err.message.match(/em (\d+) (segundo|minuto|hora)/);
  if (!m) return 3000;
  const unit = m[2] === "hora" ? 3_600_000 : m[2] === "minuto" ? 60_000 : 1000;
  return Number(m[1]) * unit + 1000;
}

/**
 * Chamador com retry e teto: `maxCalls` limita quantas chamadas esta execução
 * pode fazer (ritmo abaixo da cota da IULI); passado o teto, OutOfBudget.
 */
export function retryingCaller(token: string, deadline: number, maxCalls = Infinity): IuliCaller & { calls: () => number } {
  let calls = 0;
  const caller = async (tool: string, args: Record<string, unknown>) => {
    for (let attempt = 0; ; attempt++) {
      if (Date.now() > deadline || calls >= maxCalls) throw new OutOfBudget();
      calls++;
      try {
        return await iuliCallTool(token, tool, args);
      } catch (err) {
        const wait = retryAfterMs(err);
        if (wait === null) throw err;
        if (wait > LONG_WAIT_MS) throw new IuliRateLimited(wait);
        if (attempt >= 2) throw err;
        if (Date.now() + wait > deadline) throw new OutOfBudget();
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  };
  return Object.assign(caller, { calls: () => calls });
}

// ---------------------------------------------------------------------------
// Trava por integração — sync-iuli e sync-iuli-records não podem rodar juntas
// (a IULI recusaria as consultas paralelas). Usa a linha task='__lock' de
// iuli_sync_state: next_run_at = "travado até". O UPDATE condicional é atômico.
// ---------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
type Admin = any;

export async function acquireIuliLock(admin: Admin, integrationId: string, workspaceId: string, ms: number): Promise<boolean> {
  await admin
    .from("iuli_sync_state")
    .upsert(
      { integration_id: integrationId, task: "__lock", workspace_id: workspaceId, next_run_at: new Date(0).toISOString() },
      { onConflict: "integration_id,task", ignoreDuplicates: true },
    );
  const { data } = await admin
    .from("iuli_sync_state")
    .update({ next_run_at: new Date(Date.now() + ms).toISOString(), updated_at: new Date().toISOString() })
    .eq("integration_id", integrationId)
    .eq("task", "__lock")
    .lt("next_run_at", new Date().toISOString())
    .select("task");
  return (data?.length ?? 0) > 0;
}

/** Libera a trava — ou, com `pauseUntil`, mantém tudo parado até esse horário (cota da IULI). */
export async function releaseIuliLock(admin: Admin, integrationId: string, pauseUntil?: Date) {
  await admin
    .from("iuli_sync_state")
    .update({
      next_run_at: (pauseUntil ?? new Date(0)).toISOString(),
      last_error: pauseUntil ? `IULI pediu pausa até ${pauseUntil.toISOString()}` : null,
      updated_at: new Date().toISOString(),
    })
    .eq("integration_id", integrationId)
    .eq("task", "__lock");
}

/** Até quando a integração está travada/pausada (null = livre). */
export async function iuliLockedUntil(admin: Admin, integrationId: string): Promise<string | null> {
  const { data } = await admin
    .from("iuli_sync_state")
    .select("next_run_at")
    .eq("integration_id", integrationId)
    .eq("task", "__lock")
    .maybeSingle();
  return data && new Date(data.next_run_at).getTime() > Date.now() ? data.next_run_at : null;
}

// ---------------------------------------------------------------------------
// Funções liberadas no token — cada empresa tem um token com um conjunto
// diferente (ex: um libera notas, outro não). As sincronizações pulam o que o
// token não libera. A lista fica em integrations.config.tools e é renovada a
// cada 6h (ou quando o diagnóstico roda).
// ---------------------------------------------------------------------------

const TOOLS_TTL_MS = 6 * 3_600_000;

export async function releasedTools(
  admin: Admin,
  integrationId: string,
  token: string,
  config: { tools?: string[]; tools_checked_at?: string } | null,
): Promise<Set<string> | null> {
  const fresh = config?.tools_checked_at && Date.now() - new Date(config.tools_checked_at).getTime() < TOOLS_TTL_MS;
  if (fresh && Array.isArray(config?.tools)) return new Set(config!.tools);
  try {
    const names = (await iuliListTools(token)).map((t) => t.name);
    const { data } = await admin.from("integrations").select("config").eq("id", integrationId).single();
    await admin
      .from("integrations")
      .update({ config: { ...(data?.config ?? {}), tools: names, tools_checked_at: new Date().toISOString() } })
      .eq("id", integrationId);
    return new Set(names);
  } catch {
    // Não deu pra consultar agora: usa a última lista conhecida (ou tenta tudo).
    return Array.isArray(config?.tools) ? new Set(config!.tools) : null;
  }
}
