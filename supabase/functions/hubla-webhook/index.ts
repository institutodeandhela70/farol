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

function fullName(user: Record<string, unknown> | undefined | null): string | null {
  if (!user) return null;
  return [user.firstName, user.lastName].filter(Boolean).join(" ") || null;
}

type Admin = ReturnType<typeof createClient>;

async function handleInvoice(admin: Admin, workspaceId: string, body: any) {
  const invoice = body?.event?.invoice;
  if (!invoice?.id) return { skipped: true };

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
    customer_name: fullName(payer),
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
  return await admin.from("hubla_sales").upsert(row, { onConflict: "workspace_id,invoice_id" });
}

async function handleSubscription(admin: Admin, workspaceId: string, type: string, body: any) {
  const sub = body?.event?.subscription;
  if (!sub?.id) return { skipped: true };

  const user = body?.event?.user ?? {};
  const product = body?.event?.product ?? {};
  const utm = sub.firstPaymentSession?.utm ?? {};

  const row: Record<string, unknown> = {
    workspace_id: workspaceId,
    subscription_id: sub.id,
    status: sub.status ?? null,
    subscription_type: sub.type ?? null,
    billing_cycle_months: sub.billingCycleMonths ?? null,
    credits: sub.credits ?? null,
    payment_method: sub.paymentMethod ?? null,
    auto_renew: sub.autoRenew ?? null,
    free_trial: sub.freeTrial ?? null,
    product_id: product.id ?? null,
    product_name: product.name ?? null,
    seller_id: sub.sellerId ?? null,
    payer_id: sub.payerId ?? null,
    customer_name: fullName(user),
    customer_document: user.document ?? null,
    customer_email: user.email ?? null,
    customer_phone: user.phone ?? null,
    utm_source: utm.source ?? null,
    utm_medium: utm.medium ?? null,
    utm_campaign: utm.campaign ?? null,
    utm_content: utm.content ?? null,
    utm_term: utm.term ?? null,
    created_at_hubla: sub.createdAt ?? null,
    modified_at_hubla: sub.modifiedAt ?? null,
    last_event_type: type,
    raw_payload: body,
    updated_at: new Date().toISOString(),
  };

  // activated_at/deactivated_at só entram no objeto quando fazem sentido pro
  // evento atual — chave ausente = upsert não mexe no valor já gravado.
  if (sub.activatedAt) row.activated_at = sub.activatedAt;
  if (type === "subscription.deactivated") row.deactivated_at = sub.modifiedAt ?? new Date().toISOString();

  return await admin.from("hubla_subscriptions").upsert(row, { onConflict: "workspace_id,subscription_id" });
}

async function handleMembership(admin: Admin, workspaceId: string, type: string, body: any) {
  const sub = body?.event?.subscription;
  if (!sub?.id) return { skipped: true };

  const user = body?.event?.user ?? {};
  const product = body?.event?.product ?? {};

  const row: Record<string, unknown> = {
    workspace_id: workspaceId,
    subscription_id: sub.id,
    product_id: product.id ?? null,
    product_name: product.name ?? null,
    status: sub.status ?? null,
    payment_method: sub.paymentMethod ?? null,
    auto_renew: sub.autoRenew ?? null,
    credits: sub.credits ?? null,
    customer_name: fullName(user),
    customer_document: user.document ?? null,
    customer_email: user.email ?? null,
    customer_phone: user.phone ?? null,
    raw_payload: body,
    updated_at: new Date().toISOString(),
  };

  if (type === "customer.member_added") row.granted_at = sub.activatedAt ?? sub.modifiedAt ?? new Date().toISOString();
  if (type === "customer.member_removed") row.removed_at = sub.modifiedAt ?? new Date().toISOString();

  return await admin.from("hubla_memberships").upsert(row, { onConflict: "workspace_id,subscription_id" });
}

async function handleAbandonedCheckout(admin: Admin, workspaceId: string, body: any) {
  const lead = body?.event?.lead;
  if (!lead?.id) return { skipped: true };

  const products = body?.event?.products ?? [];
  const firstProduct = products[0] ?? {};
  const utm = lead.session?.utm ?? {};
  const cookies = lead.session?.cookies ?? {};

  const row = {
    workspace_id: workspaceId,
    lead_id: lead.id,
    full_name: lead.fullName ?? null,
    email: lead.email ?? null,
    phone: lead.phone ?? null,
    product_id: firstProduct.id ?? null,
    product_name: firstProduct.name ?? null,
    products,
    checkout_url: lead.session?.url ?? null,
    utm_source: utm.source ?? null,
    utm_medium: utm.medium ?? null,
    utm_campaign: utm.campaign ?? null,
    utm_content: utm.content ?? null,
    utm_term: utm.term ?? null,
    cookie_fbp: cookies.fbp ?? null,
    cookie_fbc: cookies.fbc ?? null,
    cookie_gclid: cookies.gclid ?? null,
    created_at_hubla: lead.createdAt ?? null,
    raw_payload: body,
    updated_at: new Date().toISOString(),
  };

  return await admin.from("hubla_abandoned_checkouts").upsert(row, { onConflict: "workspace_id,lead_id" });
}

async function handleSmartInstallment(admin: Admin, workspaceId: string, body: any) {
  const si = body?.event?.smartInstallment;
  if (!si?.id) return { skipped: true };

  const user = body?.event?.user ?? {};
  const product = body?.event?.product ?? {};

  const row = {
    workspace_id: workspaceId,
    smart_installment_id: si.id,
    subscription_id: si.subscriptionId ?? null,
    source_invoice_id: si.sourceInvoiceId ?? null,
    seller_id: si.sellerId ?? null,
    payer_id: si.payerId ?? null,
    installment_number: si.installment ?? null,
    installments_total: si.installments ?? null,
    payment_method: si.paymentMethod ?? null,
    installment_type: si.type ?? null,
    status: si.status ?? null,
    total_value: centsToReais(si.amount?.totalCents),
    product_id: product.id ?? null,
    product_name: product.name ?? null,
    customer_name: fullName(user),
    customer_document: user.document ?? null,
    customer_email: user.email ?? null,
    customer_phone: user.phone ?? null,
    created_at_hubla: si.createdAt ?? null,
    modified_at_hubla: si.modifiedAt ?? null,
    raw_payload: body,
    updated_at: new Date().toISOString(),
  };

  return await admin.from("hubla_installments").upsert(row, { onConflict: "workspace_id,smart_installment_id" });
}

async function handleRefundRequest(admin: Admin, workspaceId: string, body: any) {
  const refund = body?.event?.refund;
  if (!refund?.id) return { skipped: true };

  const invoice = body?.event?.invoice ?? {};
  const user = body?.event?.user ?? {};
  const product = body?.event?.product ?? {};

  const row = {
    workspace_id: workspaceId,
    refund_id: refund.id,
    status: refund.status ?? null,
    description: refund.description ?? null,
    is_auto_accepted: refund.isAutoAccepted ?? null,
    invoice_id: invoice.id ?? null,
    subscription_id: invoice.subscriptionId ?? null,
    product_id: product.id ?? null,
    product_name: product.name ?? null,
    total_value: centsToReais(invoice.amount?.totalCents),
    customer_name: fullName(user),
    customer_document: user.document ?? null,
    customer_email: user.email ?? null,
    customer_phone: user.phone ?? null,
    created_at_hubla: refund.createdAt ?? null,
    updated_at_hubla: refund.updatedAt ?? null,
    raw_payload: body,
    updated_at: new Date().toISOString(),
  };

  return await admin.from("hubla_refund_requests").upsert(row, { onConflict: "workspace_id,refund_id" });
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

    let result: { error?: { message: string } | null; skipped?: boolean } | null = null;

    if (type?.startsWith("invoice.")) {
      result = await handleInvoice(admin, workspaceId, body);
    } else if (type?.startsWith("subscription.")) {
      result = await handleSubscription(admin, workspaceId, type, body);
    } else if (type === "customer.member_added" || type === "customer.member_removed") {
      result = await handleMembership(admin, workspaceId, type, body);
    } else if (type === "lead.abandoned_checkout") {
      result = await handleAbandonedCheckout(admin, workspaceId, body);
    } else if (type?.startsWith("smart_installment.")) {
      result = await handleSmartInstallment(admin, workspaceId, body);
    } else if (type?.startsWith("refund_request.")) {
      result = await handleRefundRequest(admin, workspaceId, body);
    } else {
      // Tipo desconhecido — responde 200 sem gravar nada pra Hubla não ficar reenviando.
      return json({ ok: true, ignored: true });
    }

    if (result?.error) {
      return json({ error: "failed to store event", detail: result.error.message }, 500);
    }

    if (!result?.skipped) {
      await admin
        .from("integrations")
        .update({ status: "connected", last_synced_at: new Date().toISOString(), last_error: null })
        .eq("id", secretRow.integration_id);
    }

    return json({ ok: true });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
