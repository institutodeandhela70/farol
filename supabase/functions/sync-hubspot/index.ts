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

const OBJECT_TYPES = ["contacts", "companies", "deals", "meetings"] as const;
type ObjectType = (typeof OBJECT_TYPES)[number];

const TABLE_BY_TYPE: Record<ObjectType, string> = {
  contacts: "hubspot_contacts",
  companies: "hubspot_companies",
  deals: "hubspot_deals",
  meetings: "hubspot_meetings",
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
  if (type === "meetings") {
    return {
      title: props.hs_meeting_title ?? null,
      start_time: props.hs_meeting_start_time || null,
      end_time: props.hs_meeting_end_time || null,
      outcome: props.hs_meeting_outcome ?? null,
      activity_type: props.hs_activity_type ?? null,
      owner_id: props.hubspot_owner_id ?? null,
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

interface PropertyGroup {
  name: string;
  label: string;
  displayOrder: number;
}

interface PropertyDef {
  name: string;
  label: string;
  groupName?: string;
  displayOrder: number;
  options?: { label: string; value: string }[];
}

async function fetchPropertyDefs(
  type: ObjectType,
  workspaceId: string,
  headers: Record<string, string>,
  admin: ReturnType<typeof createClient>,
): Promise<string[]> {
  const [propsRes, groupsRes] = await Promise.all([
    fetch(`https://api.hubapi.com/crm/v3/properties/${type}`, { headers }),
    fetch(`https://api.hubapi.com/crm/v3/properties/${type}/groups`, { headers }),
  ]);
  if (!propsRes.ok) throw new Error(`failed to list properties for ${type}: HTTP ${propsRes.status}`);
  const propsBody = await propsRes.json();
  const properties: PropertyDef[] = propsBody.results ?? [];

  const groupsByName: Record<string, PropertyGroup> = {};
  if (groupsRes.ok) {
    const groupsBody = await groupsRes.json();
    for (const g of (groupsBody.results ?? []) as PropertyGroup[]) groupsByName[g.name] = g;
  }

  const rows = properties.map((p) => {
    const group = p.groupName ? groupsByName[p.groupName] : undefined;
    return {
      workspace_id: workspaceId,
      object_type: type,
      name: p.name,
      label: p.label,
      group_name: p.groupName ?? null,
      group_label: group?.label ?? p.groupName ?? null,
      group_display_order: group?.displayOrder ?? 0,
      display_order: p.displayOrder ?? 0,
      options: p.options ?? [],
      updated_at: new Date().toISOString(),
    };
  });

  if (rows.length > 0) {
    await admin.from("hubspot_property_defs").upsert(rows, { onConflict: "workspace_id,object_type,name" });
  }

  return properties.map((p) => p.name);
}

async function syncPipelines(workspaceId: string, headers: Record<string, string>, admin: ReturnType<typeof createClient>) {
  const res = await fetch("https://api.hubapi.com/crm/v3/pipelines/deals", { headers });
  if (!res.ok) return;
  const body = await res.json();
  const pipelines: { id: string; label: string; displayOrder: number; stages: { id: string; label: string; displayOrder: number }[] }[] =
    body.results ?? [];

  const pipelineRows = pipelines.map((p) => ({
    workspace_id: workspaceId,
    pipeline_id: p.id,
    label: p.label,
    display_order: p.displayOrder ?? 0,
    updated_at: new Date().toISOString(),
  }));
  const stageRows = pipelines.flatMap((p) =>
    (p.stages ?? []).map((s) => ({
      workspace_id: workspaceId,
      pipeline_id: p.id,
      stage_id: s.id,
      label: s.label,
      display_order: s.displayOrder ?? 0,
      updated_at: new Date().toISOString(),
    })),
  );

  if (pipelineRows.length > 0) {
    await admin.from("hubspot_pipelines").upsert(pipelineRows, { onConflict: "workspace_id,pipeline_id" });
  }
  if (stageRows.length > 0) {
    await admin.from("hubspot_pipeline_stages").upsert(stageRows, { onConflict: "workspace_id,pipeline_id,stage_id" });
  }
}

async function syncOwnersPage(
  workspaceId: string,
  headers: Record<string, string>,
  admin: ReturnType<typeof createClient>,
  archived: boolean,
) {
  let after: string | null = null;
  let firstPage = true;

  while (firstPage || after) {
    firstPage = false;
    const params = new URLSearchParams({ limit: "100" });
    if (archived) params.set("archived", "true");
    if (after) params.set("after", after);

    const res = await fetch(`https://api.hubapi.com/crm/v3/owners?${params.toString()}`, { headers });
    if (!res.ok) return;
    const body = await res.json();
    const owners: { id: string; email?: string; firstName?: string; lastName?: string }[] = body.results ?? [];

    const rows = owners.map((o) => ({
      workspace_id: workspaceId,
      owner_id: o.id,
      email: o.email ?? null,
      first_name: o.firstName ?? null,
      last_name: o.lastName ?? null,
      updated_at: new Date().toISOString(),
    }));
    if (rows.length > 0) {
      await admin.from("hubspot_owners").upsert(rows, { onConflict: "workspace_id,owner_id" });
    }

    after = body.paging?.next?.after ?? null;
  }
}

async function syncOwners(workspaceId: string, headers: Record<string, string>, admin: ReturnType<typeof createClient>) {
  // Traz ativos e desativados/removidos — reuniões antigas continuam associadas
  // a um dono mesmo depois que a pessoa saiu da conta da HubSpot.
  await syncOwnersPage(workspaceId, headers, admin, false);
  await syncOwnersPage(workspaceId, headers, admin, true);
}

interface HubspotItem {
  id: string;
  properties: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

// Vínculo reunião↔contato é uma associação, não uma propriedade — a HubSpot
// não devolve isso no batch/read normal, precisa de uma chamada à parte.
async function fetchMeetingContactAssociations(
  ids: string[],
  headers: Record<string, string>,
): Promise<Record<string, string[]>> {
  const map: Record<string, string[]> = {};
  if (ids.length === 0) return map;

  const res = await fetch("https://api.hubapi.com/crm/v4/associations/meetings/contacts/batch/read", {
    method: "POST",
    headers,
    body: JSON.stringify({ inputs: ids.map((id) => ({ id })) }),
  });
  if (!res.ok) return map;

  const body = await res.json();
  const results: { from: { id: string }; to: { toObjectId: number }[] }[] = body.results ?? [];
  for (const r of results) {
    map[r.from.id] = (r.to ?? []).map((t) => String(t.toObjectId));
  }
  return map;
}

function toRows(
  type: ObjectType,
  workspaceId: string,
  items: HubspotItem[],
  contactIdsByMeeting: Record<string, string[]> = {},
) {
  return items.map((item) => ({
    workspace_id: workspaceId,
    hubspot_id: item.id,
    ...promotedColumns(type, item.properties ?? {}),
    ...(type === "meetings" ? { contact_ids: contactIdsByMeeting[item.id] ?? [] } : {}),
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

    // Metadados (pipelines/etapas, donos) — pequenos, sincroniza sempre por
    // completo antes do loop principal, pra alimentar os nomes legíveis no frontend.
    try {
      await syncPipelines(integration.workspace_id, headers, admin);
      await syncOwners(integration.workspace_id, headers, admin);
    } catch (err) {
      lastError = `Falha ao sincronizar metadados: ${String(err)}`;
    }

    for (const type of OBJECT_TYPES) {
      if (Date.now() - start > TIME_BUDGET_MS) break;

      const state: TypeSyncState = syncState[type] ?? { cursor: null, backfilled: false, since: null };
      let properties: string[];
      try {
        properties = await fetchPropertyDefs(type, integration.workspace_id, headers, admin);
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

            const contactIdsByMeeting =
              type === "meetings" ? await fetchMeetingContactAssociations(ids, headers) : {};

            const { error: upsertError } = await admin
              .from(TABLE_BY_TYPE[type])
              .upsert(toRows(type, integration.workspace_id, results, contactIdsByMeeting), {
                onConflict: "workspace_id,hubspot_id",
              });
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
            const contactIdsByMeeting =
              type === "meetings"
                ? await fetchMeetingContactAssociations(
                    results.map((r) => r.id),
                    headers,
                  )
                : {};

            const { error: upsertError } = await admin
              .from(TABLE_BY_TYPE[type])
              .upsert(toRows(type, integration.workspace_id, results, contactIdsByMeeting), {
                onConflict: "workspace_id,hubspot_id",
              });
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
