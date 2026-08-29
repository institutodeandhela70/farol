import { createClient } from "npm:@supabase/supabase-js@2";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Normaliza o vocabulário do webhook (inglês) pro mesmo vocabulário usado na
// carga histórica via planilha (português), pra status/tipo/forma de pagamento
// não ficarem misturados em dois idiomas na mesma coluna.
const STATUS_MAP: Record<string, string> = {
  paid: "Paga",
  unpaid: "Pendente",
  overdue: "Atrasada",
  refunded: "Reembolsada",
  disputed: "Em disputa",
  chargeback: "Chargeback",
  canceled: "Cancelada",
};

const TYPE_MAP: Record<string, string> = {
  sell: "Compra",
  renewal: "Renovação",
  upgrade: "Upgrade",
};

const PAYMENT_METHOD_MAP: Record<string, string> = {
  pix: "PIX",
  bank_slip: "Boleto",
  credit_card: "Cartão de Crédito",
};

function centsToReais(cents: unknown): number | null {
  if (typeof cents !== "number") return null;
  return Math.round(cents) / 100;
}

Deno.serve(async (req) => {
  try {
    const token = req.headers.get("x-hubla-token");
    if (!token) return json({ error: "missing x-hubla-token" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: secretRow, error: secretError } = await admin
      .from("integration_secrets")
      .select("integration_id, integrations!inner(workspace_id, provider)")
      .eq("api_key", token)
      .eq("integrations.provider", "hubla")
      .maybeSingle();

    if (secretError || !secretRow) return json({ error: "invalid token" }, 401);

    const workspaceId = (secretRow.integrations as unknown as { workspace_id: string }).workspace_id;

    const body = await req.json();
    const type = body?.type as string | undefined;
    const invoice = body?.event?.invoice;

    // Só processamos eventos de fatura (vendas) por enquanto — outros tipos
    // (lead, membro, assinatura isolada, parcelamento, reembolso) respondem
    // 200 sem gravar nada, pra Hubla não ficar reenviando.
    if (!type?.startsWith("invoice.") || !invoice?.id) {
      return json({ ok: true, ignored: true });
    }

    const payer = body?.event?.user ?? invoice?.payer ?? {};
    const product = body?.event?.product ?? {};

    const row = {
      workspace_id: workspaceId,
      invoice_id: invoice.id,
      invoice_type: TYPE_MAP[invoice.type] ?? invoice.type ?? null,
      status: STATUS_MAP[invoice.status] ?? invoice.status ?? null,
      payment_method: PAYMENT_METHOD_MAP[invoice.paymentMethod] ?? invoice.paymentMethod ?? null,
      created_at_hubla: invoice.createdAt ?? null,
      paid_at: invoice.status === "paid" ? invoice.modifiedAt ?? invoice.createdAt ?? null : null,
      refunded_at: invoice.status === "refunded" ? invoice.modifiedAt ?? null : null,
      due_date: invoice.dueDate ?? null,
      product_id: product.id ?? null,
      product_name: product.name ?? null,
      producer_id: invoice.sellerId ?? null,
      customer_id: payer.id ?? null,
      customer_name: [payer.firstName, payer.lastName].filter(Boolean).join(" ") || null,
      customer_document: payer.document ?? null,
      customer_email: payer.email ?? null,
      customer_phone: payer.phone ?? null,
      subscription_id: invoice.subscriptionId ?? null,
      coupon_code: invoice.coupon?.code ?? null,
      installments: invoice.installments ?? null,
      total_value: centsToReais(invoice.amount?.totalCents),
      discount_value: centsToReais(invoice.amount?.discountCents),
      utm_source: invoice.paymentSession?.utm?.source ?? null,
      utm_medium: invoice.paymentSession?.utm?.medium ?? null,
      utm_campaign: invoice.paymentSession?.utm?.campaign ?? null,
      utm_content: invoice.paymentSession?.utm?.content ?? null,
      utm_term: invoice.paymentSession?.utm?.term ?? null,
      address_country: invoice.billingAddress?.countryCode ?? null,
      address_state: invoice.billingAddress?.state ?? null,
      address_city: invoice.billingAddress?.city ?? null,
      address_neighborhood: invoice.billingAddress?.neighborhood ?? null,
      address_street: invoice.billingAddress?.street ?? null,
      address_number: invoice.billingAddress?.number ?? null,
      address_complement: invoice.billingAddress?.complement ?? null,
      address_zip: invoice.billingAddress?.postalCode ?? null,
      original_invoice_id: invoice.parentInvoiceId ?? null,
      source: "webhook",
      raw_payload: body,
      updated_at: new Date().toISOString(),
    };

    // Upsert simples: id não faz parte do payload (default gen_random_uuid()),
    // então o conflito por (workspace_id, invoice_id) nunca tenta trocar a PK
    // de uma linha existente — e via service role, RLS nem entra em jogo.
    const { error: upsertError } = await admin
      .from("hubla_sales")
      .upsert(row, { onConflict: "workspace_id,invoice_id" });

    if (upsertError) {
      return json({ error: "failed to store sale", detail: upsertError.message }, 500);
    }

    await admin
      .from("integrations")
      .update({ status: "connected", last_synced_at: new Date().toISOString(), last_error: null })
      .eq("id", secretRow.integration_id);

    return json({ ok: true });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
