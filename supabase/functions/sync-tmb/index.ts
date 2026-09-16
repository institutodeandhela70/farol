import { createClient } from "npm:@supabase/supabase-js@2";
import { logIntegrationCall } from "../_shared/integrationLog.ts";

const TMB_BASE_URL = "https://api.tmbeducacao.com.br";

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

// Mesma constante do padrão sync-hubspot: orçamento de tempo por chamada da
// função — continua de onde parou na próxima chamada (estado salvo em
// integrations.config.tmb_sync) em vez de estourar o limite de execução.
const TIME_BUDGET_MS = 45_000;
const PAGE_SIZE = 100;
const RECONCILE_WINDOW_DAYS = 45;

interface TmbSyncState {
  backfilled: boolean;
  nextPage: number;
}

interface TmbPedido {
  pedido_id?: number;
  produtor?: string;
  produtor_id?: number;
  lancamento?: string;
  lancamento_id?: number;
  produto_id?: number;
  status_pedido?: string;
  status_financeiro?: string;
  cliente?: string;
  documento?: string;
  email?: string;
  telefone?: string;
  valor_principal?: number;
  valor_entrada?: number;
  valor_parcela?: number;
  valor_total?: number;
  taxa_administracao?: number;
  parcelas?: number;
  melhor_dia_pagamento?: number;
  criado_em?: string;
  data_efetivado?: string;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  pais?: string;
  cep?: string;
  endereco_estado?: string;
  endereco_cidade?: string;
  endereco_bairro?: string;
  endereco_logradouro?: string;
  endereco_numero?: string;
  endereco_complemento?: string | null;
}

function toRow(workspaceId: string, p: TmbPedido) {
  return {
    workspace_id: workspaceId,
    pedido_id: p.pedido_id,
    status: p.status_pedido ?? null,
    status_financeiro: p.status_financeiro ?? null,
    producer_id: p.produtor_id ?? null,
    producer_name: p.produtor ?? null,
    product_id: p.produto_id ?? null,
    product_name: p.lancamento ?? null,
    customer_name: p.cliente ?? null,
    customer_document: p.documento ?? null,
    customer_email: p.email ?? null,
    customer_phone: p.telefone ?? null,
    valor_principal: p.valor_principal ?? null,
    valor_entrada: p.valor_entrada ?? null,
    valor_parcela: p.valor_parcela ?? null,
    valor_total: p.valor_total ?? null,
    taxa_administracao: p.taxa_administracao ?? null,
    parcelas: p.parcelas ?? null,
    melhor_dia_pagamento: p.melhor_dia_pagamento ?? null,
    criado_em: p.criado_em ?? null,
    data_efetivado: p.data_efetivado ?? null,
    utm_source: p.utm_source ?? null,
    utm_medium: p.utm_medium ?? null,
    utm_campaign: p.utm_campaign ?? null,
    utm_content: p.utm_content ?? null,
    endereco_pais: p.pais ?? null,
    endereco_cep: p.cep ?? null,
    endereco_estado: p.endereco_estado ?? null,
    endereco_cidade: p.endereco_cidade ?? null,
    endereco_bairro: p.endereco_bairro ?? null,
    endereco_logradouro: p.endereco_logradouro ?? null,
    endereco_numero: p.endereco_numero ?? null,
    endereco_complemento: p.endereco_complemento ?? null,
    source: "import",
    raw_payload: p,
    updated_at: new Date().toISOString(),
  };
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

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
      provider: "tmb",
      direction: "outbound",
      eventType: "sync",
      request: { integration_id: integrationId },
      durationMs: Date.now() - startedAt,
      ...params,
    });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "missing authorization" }, 401);

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Mesmo padrão de sync-asaas/sync-hubspot: segredo interno próprio pra
    // chamada do cron, já que a service_role_key não é confiável pra essa
    // checagem (formato de JWT mudou no gateway).
    const internalToken = Deno.env.get("FAROL_INTERNAL_TOKEN");
    const bearer = authHeader.replace(/^Bearer\s+/i, "");
    const isTrustedInternalCall = !!internalToken && bearer === internalToken;

    const { integration_id } = await req.json();
    if (!integration_id) return json({ error: "integration_id required" }, 400);
    integrationId = integration_id;

    if (!isTrustedInternalCall) {
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData, error: userError } = await userClient.auth.getUser();
      if (userError || !userData.user) return json({ error: "invalid session" }, 401);

      const { data: integrationCheck } = await admin
        .from("integrations")
        .select("workspace_id")
        .eq("id", integration_id)
        .maybeSingle();
      if (!integrationCheck) return json({ error: "integration not found" }, 404);
      workspaceId = integrationCheck.workspace_id;

      const { data: membership } = await admin
        .from("workspace_members")
        .select("id")
        .eq("workspace_id", integrationCheck.workspace_id)
        .eq("user_id", userData.user.id)
        .eq("is_active", true)
        .maybeSingle();
      if (!membership) return json({ error: "forbidden" }, 403);
    }
    // Chamada interna (cron), já confiável — não precisa checar membership.

    const { data: integration, error: integrationError } = await admin
      .from("integrations")
      .select("id, workspace_id, config")
      .eq("id", integration_id)
      .single();
    if (integrationError || !integration) return json({ error: "integration not found" }, 404);
    workspaceId = integration.workspace_id;

    const { data: secret, error: secretError } = await admin
      .from("integration_secrets")
      .select("api_key")
      .eq("integration_id", integration_id)
      .maybeSingle();
    if (secretError || !secret) {
      await log({ status: "error", statusCode: 400, errorMessage: "no api key saved" });
      return json({ error: "no api key saved" }, 400);
    }

    const headers = {
      Authorization: `Bearer ${secret.api_key}`,
      "Content-Type": "application/json",
    };

    const start = Date.now();
    const state: TmbSyncState = integration.config?.tmb_sync ?? { backfilled: false, nextPage: 1 };

    let totalSynced = 0;
    let lastError: string | null = null;

    if (!state.backfilled) {
      // Carga inicial: pagina tudo, sem filtro de data, até a TMB devolver
      // uma página com menos itens que PAGE_SIZE (fim da lista).
      let page = state.nextPage;
      let reachedEnd = false;

      while (Date.now() - start < TIME_BUDGET_MS) {
        const params = new URLSearchParams({ pageNumber: String(page), pageSize: String(PAGE_SIZE) });
        const res = await fetch(`${TMB_BASE_URL}/api/pedidos?${params.toString()}`, { headers });
        if (!res.ok) {
          lastError = `HTTP ${res.status} (pedidos pageNumber=${page}): ${(await res.text()).slice(0, 300)}`;
          break;
        }

        const body = await res.json();
        const pedidos: TmbPedido[] = Array.isArray(body) ? body : (body?.data ?? body?.results ?? []);

        if (pedidos.length > 0) {
          const rows = pedidos.filter((p) => p.pedido_id != null).map((p) => toRow(integration.workspace_id, p));
          if (rows.length > 0) {
            const { error: upsertError } = await admin
              .from("tmb_sales")
              .upsert(rows, { onConflict: "workspace_id,pedido_id" });
            if (upsertError) {
              lastError = `Falha ao gravar pedidos: ${upsertError.message}`;
              break;
            }
            totalSynced += rows.length;
          }
        }

        if (pedidos.length < PAGE_SIZE) {
          reachedEnd = true;
          break;
        }
        page += 1;
      }

      state.nextPage = reachedEnd ? 1 : page;
      state.backfilled = reachedEnd && !lastError;
    } else {
      // Já fez a carga inicial: só refaz uma janela rolante recente, pra
      // pegar mudanças de status (Efetivado/Cancelado) que não chegaram via
      // webhook. A API não tem filtro por "modificado desde", só por data de
      // criação — por isso reprocessa a janela inteira a cada chamada.
      const today = new Date();
      const since = new Date(today.getTime() - RECONCILE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

      let page = 1;
      while (Date.now() - start < TIME_BUDGET_MS) {
        const params = new URLSearchParams({
          pageNumber: String(page),
          pageSize: String(PAGE_SIZE),
          data_inicio: isoDate(since),
          data_final: isoDate(today),
        });
        const res = await fetch(`${TMB_BASE_URL}/api/pedidos?${params.toString()}`, { headers });
        if (!res.ok) {
          lastError = `HTTP ${res.status} (reconciliação pageNumber=${page}): ${(await res.text()).slice(0, 300)}`;
          break;
        }

        const body = await res.json();
        const pedidos: TmbPedido[] = Array.isArray(body) ? body : (body?.data ?? body?.results ?? []);

        if (pedidos.length > 0) {
          const rows = pedidos.filter((p) => p.pedido_id != null).map((p) => toRow(integration.workspace_id, p));
          if (rows.length > 0) {
            const { error: upsertError } = await admin
              .from("tmb_sales")
              .upsert(rows, { onConflict: "workspace_id,pedido_id" });
            if (upsertError) {
              lastError = `Falha ao gravar pedidos: ${upsertError.message}`;
              break;
            }
            totalSynced += rows.length;
          }
        }

        if (pedidos.length < PAGE_SIZE) break;
        page += 1;
      }
    }

    await admin
      .from("integrations")
      .update({
        status: lastError ? "error" : "connected",
        last_error: lastError,
        last_synced_at: new Date().toISOString(),
        config: { ...integration.config, tmb_sync: state },
      })
      .eq("id", integration_id);

    await log({
      status: lastError ? "error" : "success",
      statusCode: 200,
      response: { synced: totalSynced, state },
      errorMessage: lastError ?? undefined,
    });
    return json({ synced: totalSynced, error: lastError, state });
  } catch (err) {
    await log({ status: "error", statusCode: 500, errorMessage: String(err) });
    return json({ error: String(err) }, 500);
  }
});
