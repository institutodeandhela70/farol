// deno-lint-ignore no-explicit-any
type Admin = any;

const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";

interface SendViaBrevoParams {
  admin: Admin;
  workspaceId: string;
  toEmail: string;
  toName?: string;
  templateKey: string;
  variables: Record<string, string>;
}

interface SendViaBrevoResult {
  ok: boolean;
  error?: string;
}

function renderTemplate(text: string, variables: Record<string, string>): string {
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key) => variables[key] ?? "");
}

// Busca a integração Brevo do workspace (config + api_key), renderiza o
// template salvo em email_templates e dispara via API do Brevo. Loga em
// email_send_log antes/depois — nunca lança se o log falhar.
export async function sendViaBrevo({
  admin,
  workspaceId,
  toEmail,
  toName,
  templateKey,
  variables,
}: SendViaBrevoParams): Promise<SendViaBrevoResult> {
  const { data: integration } = await admin
    .from("integrations")
    .select("id, config")
    .eq("workspace_id", workspaceId)
    .eq("provider", "brevo")
    .maybeSingle();

  if (!integration) {
    return { ok: false, error: "Integração com o Brevo não configurada para este workspace." };
  }

  const { data: secret } = await admin
    .from("integration_secrets")
    .select("api_key")
    .eq("integration_id", integration.id)
    .maybeSingle();

  if (!secret?.api_key) {
    return { ok: false, error: "Chave da API do Brevo não encontrada." };
  }

  const { data: template } = await admin
    .from("email_templates")
    .select("subject, html_content, is_active")
    .eq("key", templateKey)
    .maybeSingle();

  if (!template || !template.is_active) {
    return { ok: false, error: `Template de e-mail "${templateKey}" não encontrado ou inativo.` };
  }

  const senderName = integration.config?.sender_name || "Farol ID";
  const senderEmail = integration.config?.sender_email;
  const replyTo = integration.config?.reply_to;

  if (!senderEmail) {
    return { ok: false, error: "E-mail do remetente não configurado na integração do Brevo." };
  }

  const subject = renderTemplate(template.subject, variables);
  const htmlContent = renderTemplate(template.html_content, variables);

  const { data: logRow } = await admin
    .from("email_send_log")
    .insert({
      template_key: templateKey,
      workspace_id: workspaceId,
      to_email: toEmail,
      subject,
      status: "pending",
    })
    .select("id")
    .maybeSingle();

  try {
    const res = await fetch(BREVO_API_URL, {
      method: "POST",
      headers: {
        accept: "application/json",
        "api-key": secret.api_key,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sender: { name: senderName, email: senderEmail },
        ...(replyTo ? { replyTo: { email: replyTo } } : {}),
        to: [{ email: toEmail, ...(toName ? { name: toName } : {}) }],
        subject,
        htmlContent,
      }),
    });

    const body = await res.json().catch(() => ({}));

    if (logRow?.id) {
      await admin
        .from("email_send_log")
        .update(
          res.ok
            ? { status: "sent", brevo_message_id: body?.messageId ?? null }
            : { status: "failed", error_message: body?.message ?? `Brevo respondeu ${res.status}` },
        )
        .eq("id", logRow.id);
    }

    if (!res.ok) {
      return { ok: false, error: body?.message ?? `Brevo respondeu ${res.status}` };
    }

    return { ok: true };
  } catch (err) {
    const message = String(err instanceof Error ? err.message : err);
    if (logRow?.id) {
      await admin.from("email_send_log").update({ status: "failed", error_message: message }).eq("id", logRow.id);
    }
    return { ok: false, error: message };
  }
}
