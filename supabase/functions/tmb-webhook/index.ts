import { createClient } from "npm:@supabase/supabase-js@2";
import { logIntegrationCall } from "../_shared/integrationLog.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Admin = ReturnType<typeof createClient>;

// Vendas: dispara em Efetivado/Cancelado do pedido. Payload é um objeto único
// (sem "type" — diferencia dos outros 2 formatos por não ser array e não ter
// "fase_checkout").
async function handleVendas(admin: Admin, workspaceId: string, body: any) {
  if (body?.pedido == null) return { skipped: true };

  const row = {
    workspace_id: workspaceId,
    pedido_id: body.pedido,
    status: body.status_pedido ?? null,
    status_financeiro: body.status_financeiro ?? null,
    producer_id: body.produtor_id ?? null,
    producer_name: body.produtor ?? null,
    product_id: body.lancamento_id ?? null,
    product_name: body.lancamento ?? null,
    customer_name: body.cliente ?? null,
    customer_document: body.documento ?? null,
    customer_email: body.email ?? null,
    customer_phone: body.telefone_ativo ?? body.telefones ?? null,
    valor_principal: body.valor_principal ?? null,
    valor_entrada: body.valor_entrada ?? null,
    valor_parcela: body.valor_parcela ?? null,
    valor_total: body.valor_total ?? null,
    taxa_administracao: body.taxa_administracao ?? null,
    parcelas: body.parcelas ?? null,
    melhor_dia_pagamento: body.melhor_dia_pagamento ?? null,
    criado_em: body.criado_em ?? null,
    data_efetivado: body.data_efetivado ?? null,
    utm_source: body.utm_source ?? null,
    utm_medium: body.utm_medium ?? null,
    utm_campaign: body.utm_campaign ?? null,
    utm_content: body.utm_content ?? null,
    utm_last_source: body.utm_last_source ?? null,
    utm_last_medium: body.utm_last_medium ?? null,
    utm_last_campaign: body.utm_last_campaign ?? null,
    utm_last_content: body.utm_last_content ?? null,
    endereco_pais: body.endereco_pais ?? null,
    endereco_cep: body.endereco_cep ?? null,
    endereco_estado: body.endereco_estado ?? null,
    endereco_cidade: body.endereco_cidade ?? null,
    endereco_bairro: body.endereco_bairro ?? null,
    endereco_logradouro: body.endereco_logradouro ?? null,
    endereco_numero: body.endereco_numero ?? null,
    endereco_complemento: body.endereco_complemento ?? null,
    source: "webhook",
    raw_payload: body,
    updated_at: new Date().toISOString(),
  };

  return await admin.from("tmb_sales").upsert(row, { onConflict: "workspace_id,pedido_id" });
}

// Etapas do Checkout: funil pré-venda. Só guarda a etapa atual por pedido —
// cada evento novo substitui o anterior (decisão do Raffa: sem histórico do funil).
async function handleEtapasCheckout(admin: Admin, workspaceId: string, body: any) {
  if (body?.pedido == null) return { skipped: true };

  const row = {
    workspace_id: workspaceId,
    pedido_id: body.pedido,
    fase_checkout: body.fase_checkout ?? null,
    status_pedido: body.status_pedido ?? null,
    customer_name: body.cliente ?? null,
    customer_document: body.documento ?? null,
    customer_email: body.email ?? null,
    product_id: body.lancamento_id ?? null,
    product_name: body.lancamento ?? null,
    valor_total: body.valor_total ?? null,
    utm_source: body.utm_source ?? null,
    utm_medium: body.utm_medium ?? null,
    utm_campaign: body.utm_campaign ?? null,
    utm_content: body.utm_content ?? null,
    url_boleto_entrada: body.url_boleto_entrada ?? null,
    criado_em: body.criado_em ?? null,
    raw_payload: body,
    updated_at: new Date().toISOString(),
  };

  return await admin.from("tmb_checkout_steps").upsert(row, { onConflict: "workspace_id,pedido_id" });
}

// Financeiro: dispara por parcela. Vem como array de { "dados": {...} } — pode
// trazer mais de uma parcela por chamada.
async function handleFinanceiro(admin: Admin, workspaceId: string, items: any[]) {
  const rows = items
    .map((item) => item?.dados)
    .filter((d) => d?.parcela_id != null)
    .map((d) => ({
      workspace_id: workspaceId,
      parcela_id: d.parcela_id,
      pedido_id: d.pedido_id ?? null,
      parcela: d.parcela ?? null,
      status_pagamento: d.status_pagamento ?? null,
      vencimento_parcela: d.vencimento_parcela ?? null,
      data_pagamento: d.data_pagamento ?? null,
      valor_parcela_sem_juros: d.valor_parcela_sem_juros ?? null,
      repasse: d.repasse ?? null,
      produto: d.produto ?? null,
      modalidade_contrato: d.modalidade_contrato ?? null,
      customer_name: d.cliente ?? null,
      customer_document: d.cliente_documento ?? null,
      customer_email: d.cliente_email ?? null,
      product_id: d.lancamento_id ?? null,
      raw_payload: d,
      updated_at: new Date().toISOString(),
    }));

  if (rows.length === 0) return { skipped: true };

  return await admin.from("tmb_installments").upsert(rows, { onConflict: "workspace_id,parcela_id" });
}

Deno.serve(async (req) => {
  try {
    const token = req.headers.get("x-tmb-token");
    if (!token) return json({ error: "missing x-tmb-token" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: secretRow, error: secretError } = await admin
      .from("integration_secrets")
      .select("integration_id, integrations!inner(workspace_id, provider)")
      .eq("webhook_secret", token)
      .eq("integrations.provider", "tmb")
      .maybeSingle();

    if (secretError || !secretRow) return json({ error: "invalid token" }, 401);

    const workspaceId = (secretRow.integrations as unknown as { workspace_id: string }).workspace_id;
    const startedAt = Date.now();

    const body = await req.json();

    let eventType: string;
    let result: { error?: { message: string } | null; skipped?: boolean } | null = null;

    if (Array.isArray(body)) {
      eventType = "financeiro";
      result = await handleFinanceiro(admin, workspaceId, body);
    } else if (body?.fase_checkout !== undefined) {
      eventType = "etapas_checkout";
      result = await handleEtapasCheckout(admin, workspaceId, body);
    } else if (body?.pedido !== undefined || body?.status_pedido !== undefined) {
      eventType = "vendas";
      result = await handleVendas(admin, workspaceId, body);
    } else {
      // Formato não reconhecido — responde 200 sem gravar nada pra TMB não
      // ficar reenviando, mesmo comportamento do hubla-webhook pra tipo
      // desconhecido.
      await logIntegrationCall(admin, {
        workspaceId,
        integrationId: secretRow.integration_id as string,
        provider: "tmb",
        direction: "inbound",
        eventType: "unknown",
        status: "success",
        statusCode: 200,
        request: body,
        durationMs: Date.now() - startedAt,
      });
      return json({ ok: true, ignored: true });
    }

    if (result?.error) {
      await admin
        .from("integrations")
        .update({ status: "error", last_error: result.error.message.slice(0, 500) })
        .eq("id", secretRow.integration_id);
      await logIntegrationCall(admin, {
        workspaceId,
        integrationId: secretRow.integration_id as string,
        provider: "tmb",
        direction: "inbound",
        eventType,
        status: "error",
        statusCode: 500,
        request: body,
        errorMessage: result.error.message,
        durationMs: Date.now() - startedAt,
      });
      return json({ error: "failed to store event", detail: result.error.message }, 500);
    }

    if (!result?.skipped) {
      await admin
        .from("integrations")
        .update({ status: "connected", last_synced_at: new Date().toISOString(), last_error: null })
        .eq("id", secretRow.integration_id);
    }

    await logIntegrationCall(admin, {
      workspaceId,
      integrationId: secretRow.integration_id as string,
      provider: "tmb",
      direction: "inbound",
      eventType,
      status: "success",
      statusCode: 200,
      request: body,
      durationMs: Date.now() - startedAt,
    });

    return json({ ok: true });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
