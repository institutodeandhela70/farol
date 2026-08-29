import { createClient } from "npm:@supabase/supabase-js@2";

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

// Tempo máximo por chamada da função — segura o suficiente pra não estourar o
// limite de execução da Edge Function. Continua de onde parou na próxima chamada
// (cursor salvo em integrations.config.hubspot_sync).
const TIME_BUDGET_MS = 45_000;

const OBJECT_TYPES = ["contacts", "companies", "deals"] as const;
type ObjectType = (typeof OBJECT_TYPES)[number];

const TABLE_BY_TYPE: Record<ObjectType, string> = {
  contacts: "hubspot_contacts",
  companies: "hubspot_companies",
  deals: "hubspot_deals",
};

interface TypeSyncState {
  cursor: string | null;
  backfilled: boolean;
  since: string | null; // ISO — maior hs_lastmodifieddate já processado
}

function promotedColumns(type: ObjectType, props: Record<string, unknown>) {
  if (type === "contacts") {
    return {
      email: props.email ?? null,
      firstname: props.firstname ?? null,
      lastname: props.lastname ?? null,
      phone: props.phone ?? null,
      lifecyclestage: props.lifecyclestage ?? null,
    };
  }
  if (type === "companies") {
    return {
      name: props.name ?? null,
      domain: props.domain ?? null,
      industry: props.industry ?? null,
      city: props.city ?? null,
      state: props.state ?? null,
    };
  }
  return {
    dealname: props.dealname ?? null,
    amount: props.amount ? Number(props.amount) : null,
    dealstage: props.dealstage ?? null,
    pipeline: props.pipeline ?? null,
    // A HubSpot às vezes devolve "" (string vazia) em vez de null pra data
    // não preenchida — Postgres rejeita "" como timestamp, então normaliza aqui.
    closedate: props.closedate || null,
  };
}

async function fetchAllPropertyNames(type: ObjectType, headers: Record<string, string>): Promise<string[]> {
  const res = await fetch(`https://api.hubapi.com/crm/v3/properties/${type}`, { headers });
  if (!res.ok) throw new Error(`failed to list properties for ${type}: HTTP ${res.status}`);
  const body = await res.json();
  return (body.results ?? []).map((p: { name: string }) => p.name);
}

interface HubspotItem {
  id: string;
  properties: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

function toRows(type: ObjectType, workspaceId: string, items: HubspotItem[]) {
  return items.map((item) => ({
    workspace_id: workspaceId,
    hubspot_id: item.id,
    ...promotedColumns(type, item.properties ?? {}),
    created_at_hubspot: item.createdAt || null,
    updated_at_hubspot: item.updatedAt || null,
    raw_properties: item.properties ?? {},
    updated_at: new Date().toISOString(),
  }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "missing authorization" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    // service_role_key não é confiável pra essa checagem (o gateway já não aceita
    // o formato novo, e o valor exposto em runtime pode divergir do JWT legado).
    // Segredo interno próprio, guardado como Edge Function Secret + no Vault.
    const internalToken = Deno.env.get("FAROL_INTERNAL_TOKEN");
    const bearer = authHeader.replace(/^Bearer\s+/i, "");
    const isTrustedInternalCall = !!internalToken && bearer === internalToken;

    const { integration_id } = await req.json();
    if (!integration_id) return json({ error: "integration_id required" }, 400);

    if (!isTrustedInternalCall) {
      // Chamada de usuário (clique manual) — confere sessão + participação no workspace.
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

    const { data: secret, error: secretError } = await admin
      .from("integration_secrets")
      .select("api_key")
      .eq("integration_id", integration_id)
      .maybeSingle();
    if (secretError || !secret) return json({ error: "no api key saved" }, 400);

    const headers = {
      Authorization: `Bearer ${secret.api_key}`,
      "Content-Type": "application/json",
    };

    const start = Date.now();
    const syncState: Record<string, TypeSyncState> = integration.config?.hubspot_sync ?? {};

    let totalSynced = 0;
    let lastError: string | null = null;

    for (const type of OBJECT_TYPES) {
      if (Date.now() - start > TIME_BUDGET_MS) break;

      const state: TypeSyncState = syncState[type] ?? { cursor: null, backfilled: false, since: null };
      let properties: string[];
      try {
        properties = await fetchAllPropertyNames(type, headers);
      } catch (err) {
        lastError = String(err);
        continue;
      }

      let maxSeenModified = state.since;

      if (!state.backfilled) {
        // Carga inicial, em duas etapas — evita os dois problemas que a listagem
        // simples deu: (a) busca só travaria em 10 mil resultados; (b) pedir TODAS
        // as propriedades na URL do GET de listagem estoura o limite de tamanho de
        // URL (negócios tem muita propriedade customizada). Solução: 1) lista só
        // os IDs (URL curta, sem properties); 2) busca os dados completos desses
        // IDs via POST em lote (sem limite de tamanho, já que vai no corpo).
        let after = state.cursor;
        let firstPage = true;

        while ((firstPage || after) && Date.now() - start < TIME_BUDGET_MS) {
          firstPage = false;
          const params = new URLSearchParams({ limit: "100" });
          if (after) params.set("after", after);

          const listRes = await fetch(`https://api.hubapi.com/crm/v3/objects/${type}?${params.toString()}`, {
            headers,
          });
          if (!listRes.ok) {
            lastError = `HTTP ${listRes.status} (${type} list): ${(await listRes.text()).slice(0, 300)}`;
            break;
          }

          const listPage = await listRes.json();
          const ids: string[] = (listPage.results ?? []).map((r: { id: string }) => r.id);

          if (ids.length > 0) {
            const batchRes = await fetch(`https://api.hubapi.com/crm/v3/objects/${type}/batch/read`, {
              method: "POST",
              headers,
              body: JSON.stringify({ properties, inputs: ids.map((id) => ({ id })) }),
            });
            if (!batchRes.ok) {
              lastError = `HTTP ${batchRes.status} (${type} batch/read): ${(await batchRes.text()).slice(0, 300)}`;
              break;
            }
            const batchBody = await batchRes.json();
            const results: HubspotItem[] = batchBody.results ?? [];

            const { error: upsertError } = await admin
              .from(TABLE_BY_TYPE[type])
              .upsert(toRows(type, integration.workspace_id, results), { onConflict: "workspace_id,hubspot_id" });
            if (upsertError) {
              lastError = `Falha ao gravar ${type}: ${upsertError.message}`;
              break;
            }
            totalSynced += results.length;
            for (const item of results) {
              const modified = item.updatedAt as string | undefined;
              if (modified && (!maxSeenModified || modified > maxSeenModified)) maxSeenModified = modified;
            }
          }

          after = listPage.paging?.next?.after ?? null;
        }

        syncState[type] = {
          cursor: after,
          backfilled: after === null && !lastError,
          since: maxSeenModified,
        };
      } else {
        // Já fez a carga inicial: só busca o que mudou desde a última passada,
        // via API de busca (aqui o volume é pequeno o suficiente pra nunca
        // chegar perto do teto de 10 mil).
        const sinceMillis = state.since ? new Date(state.since).getTime() : null;
        let after = state.cursor;
        let firstPage = true;
        let reachedEnd = false;

        while ((firstPage || after) && Date.now() - start < TIME_BUDGET_MS) {
          firstPage = false;
          const body: Record<string, unknown> = {
            limit: 100,
            properties,
            sorts: [{ propertyName: "hs_lastmodifieddate", direction: "ASCENDING" }],
          };
          if (after) body.after = after;
          if (sinceMillis) {
            body.filterGroups = [
              { filters: [{ propertyName: "hs_lastmodifieddate", operator: "GT", value: String(sinceMillis) }] },
            ];
          }

          const res = await fetch(`https://api.hubapi.com/crm/v3/objects/${type}/search`, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
          });
          if (!res.ok) {
            lastError = `HTTP ${res.status} (${type} search): ${(await res.text()).slice(0, 300)}`;
            break;
          }

          const page = await res.json();
          const results: HubspotItem[] = page.results ?? [];
          if (results.length > 0) {
            const { error: upsertError } = await admin
              .from(TABLE_BY_TYPE[type])
              .upsert(toRows(type, integration.workspace_id, results), { onConflict: "workspace_id,hubspot_id" });
            if (upsertError) {
              lastError = `Falha ao gravar ${type}: ${upsertError.message}`;
              break;
            }
            totalSynced += results.length;
            for (const item of results) {
              const modified = item.updatedAt as string | undefined;
              if (modified && (!maxSeenModified || modified > maxSeenModified)) maxSeenModified = modified;
            }
          }

          after = page.paging?.next?.after ?? null;
          if (!after) reachedEnd = true;
        }

        syncState[type] = {
          cursor: after,
          backfilled: true,
          since: reachedEnd ? maxSeenModified ?? state.since : state.since,
        };
      }
    }

    await admin
      .from("integrations")
      .update({
        status: lastError ? "error" : "connected",
        last_error: lastError,
        last_synced_at: new Date().toISOString(),
        config: { ...integration.config, hubspot_sync: syncState },
      })
      .eq("id", integration_id);

    return json({ synced: totalSynced, error: lastError, state: syncState });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
