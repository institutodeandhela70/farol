import { createClient } from "npm:@supabase/supabase-js@2";
import { sendEventWhatsapp, type TriggerType } from "../_shared/vsixMessage.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
}

const VALID_TRIGGERS: TriggerType[] = ["participante_aprovado", "ficha_preenchida", "venda_finalizada"];

// Janela de tolerância pro caso anônimo (ficha_preenchida disparado pela
// própria página pública, sem sessão): só aceita notificar uma aplicação
// criada há pouco, pra não virar um jeito de mandar mensagem arbitrária pra
// qualquer application_id antigo.
const ANON_FICHA_WINDOW_MS = 10 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  try {
    const body = await req.json();
    const { event_id, trigger_type, participant_id, application_id } = body ?? {};

    if (!event_id || !VALID_TRIGGERS.includes(trigger_type)) {
      return json({ error: "event_id e trigger_type válido são obrigatórios" }, 400);
    }

    const authHeader = req.headers.get("Authorization");
    let authorized = false;

    if (authHeader) {
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
      const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
      const { data: userData } = await userClient.auth.getUser();
      if (userData?.user) {
        const { data: event } = await admin.from("events").select("workspace_id").eq("id", event_id).maybeSingle();
        if (event) {
          const { data: membership } = await admin
            .from("workspace_members")
            .select("id")
            .eq("workspace_id", event.workspace_id)
            .eq("user_id", userData.user.id)
            .eq("is_active", true)
            .maybeSingle();
          authorized = !!membership;
        }
      }
    }

    // Sem sessão: só libera o caso ficha_preenchida, e só pra uma aplicação
    // recém-criada desse mesmo evento (a página pública chama isso logo após
    // o próprio insert que ela acabou de fazer).
    if (!authorized && trigger_type === "ficha_preenchida" && application_id) {
      const { data: application } = await admin
        .from("event_applications")
        .select("id, event_id, created_at")
        .eq("id", application_id)
        .maybeSingle();
      if (application && application.event_id === event_id) {
        const ageMs = Date.now() - new Date(application.created_at).getTime();
        authorized = ageMs >= 0 && ageMs <= ANON_FICHA_WINDOW_MS;
      }
    }

    if (!authorized) {
      return json({ error: "forbidden" }, 403);
    }

    const result = await sendEventWhatsapp(admin, {
      eventId: event_id,
      triggerType: trigger_type,
      participantId: participant_id,
      applicationId: application_id,
    });

    return json(result);
  } catch (err) {
    return json({ error: String(err instanceof Error ? err.message : err) }, 500);
  }
});
