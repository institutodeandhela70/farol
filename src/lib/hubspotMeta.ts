import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

export interface HubspotStage {
  id: string;
  label: string;
  display_order: number;
}

export interface HubspotPipeline {
  id: string;
  label: string;
  display_order: number;
  stages: HubspotStage[];
}

export function useHubspotPipelines(workspaceId: string | undefined) {
  const [pipelines, setPipelines] = useState<HubspotPipeline[]>([]);

  useEffect(() => {
    if (!workspaceId) return;

    Promise.all([
      supabase
        .from("hubspot_pipelines")
        .select("pipeline_id, label, display_order")
        .eq("workspace_id", workspaceId)
        .order("display_order"),
      supabase
        .from("hubspot_pipeline_stages")
        .select("pipeline_id, stage_id, label, display_order")
        .eq("workspace_id", workspaceId)
        .order("display_order"),
    ]).then(([pipelinesRes, stagesRes]) => {
      const stagesByPipeline: Record<string, HubspotStage[]> = {};
      for (const s of stagesRes.data ?? []) {
        (stagesByPipeline[s.pipeline_id] ??= []).push({ id: s.stage_id, label: s.label, display_order: s.display_order });
      }
      setPipelines(
        (pipelinesRes.data ?? []).map((p) => ({
          id: p.pipeline_id,
          label: p.label,
          display_order: p.display_order,
          stages: stagesByPipeline[p.pipeline_id] ?? [],
        })),
      );
    });
  }, [workspaceId]);

  const stageLabel = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of pipelines) for (const s of p.stages) map[s.id] = s.label;
    return (stageId: string | null) => (stageId ? map[stageId] ?? stageId : null);
  }, [pipelines]);

  const pipelineLabel = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of pipelines) map[p.id] = p.label;
    return (pipelineId: string | null) => (pipelineId ? map[pipelineId] ?? pipelineId : null);
  }, [pipelines]);

  return { pipelines, stageLabel, pipelineLabel };
}

export function useHubspotOwners(workspaceId: string | undefined) {
  const [owners, setOwners] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!workspaceId) return;
    supabase
      .from("hubspot_owners")
      .select("owner_id, email, first_name, last_name")
      .eq("workspace_id", workspaceId)
      .then(({ data }) => {
        const map: Record<string, string> = {};
        for (const o of data ?? []) {
          map[o.owner_id] = [o.first_name, o.last_name].filter(Boolean).join(" ") || o.email || o.owner_id;
        }
        setOwners(map);
      });
  }, [workspaceId]);

  return owners;
}

export function useHubspotContactNames(workspaceId: string | undefined, hubspotIds: string[]) {
  const [names, setNames] = useState<Record<string, string>>({});
  const idsKey = hubspotIds.slice().sort().join(",");

  useEffect(() => {
    if (!workspaceId || hubspotIds.length === 0) return;
    supabase
      .from("hubspot_contacts")
      .select("hubspot_id, firstname, lastname, email")
      .eq("workspace_id", workspaceId)
      .in("hubspot_id", hubspotIds)
      .then(({ data }) => {
        const map: Record<string, string> = {};
        for (const c of data ?? []) {
          map[c.hubspot_id] = [c.firstname, c.lastname].filter(Boolean).join(" ") || c.email || c.hubspot_id;
        }
        setNames(map);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, idsKey]);

  return names;
}

export interface HubspotPropertyDef {
  name: string;
  label: string;
  group_name: string | null;
  group_label: string | null;
  group_display_order: number;
  display_order: number;
  options: { label: string; value: string }[];
}

export function useHubspotPropertyDefs(workspaceId: string | undefined, objectType: "deals" | "contacts") {
  const [defs, setDefs] = useState<HubspotPropertyDef[]>([]);

  useEffect(() => {
    if (!workspaceId) return;
    supabase
      .from("hubspot_property_defs")
      .select("name, label, group_name, group_label, group_display_order, display_order, options")
      .eq("workspace_id", workspaceId)
      .eq("object_type", objectType)
      .then(({ data }) => setDefs((data as HubspotPropertyDef[]) ?? []));
  }, [workspaceId, objectType]);

  const defsByName = useMemo(() => {
    const map: Record<string, HubspotPropertyDef> = {};
    for (const d of defs) map[d.name] = d;
    return map;
  }, [defs]);

  const groupedEntries = useMemo(() => {
    return (raw: Record<string, unknown>) => {
      const groups: Record<string, { label: string; order: number; fields: { label: string; order: number; value: string }[] }> = {};
      const others: { label: string; order: number; value: string }[] = [];

      for (const [name, rawValue] of Object.entries(raw)) {
        const def = defsByName[name];
        const value = formatHubspotValue(def, rawValue);

        if (!def || !def.group_label) {
          others.push({ label: def?.label ?? name, order: 0, value });
          continue;
        }

        const groupKey = def.group_name ?? def.group_label;
        (groups[groupKey] ??= { label: def.group_label, order: def.group_display_order, fields: [] }).fields.push({
          label: def.label,
          order: def.display_order,
          value,
        });
      }

      others.sort((a, b) => a.label.localeCompare(b.label));

      const orderedGroups = Object.values(groups)
        .map((g) => ({ ...g, fields: g.fields.sort((a, b) => a.order - b.order) }))
        .sort((a, b) => a.order - b.order);

      if (others.length > 0) orderedGroups.push({ label: "Outras propriedades", order: Infinity, fields: others });

      return orderedGroups;
    };
  }, [defsByName]);

  return { defsByName, groupedEntries };
}

export function formatHubspotValue(def: HubspotPropertyDef | undefined, rawValue: unknown): string {
  if (rawValue === null || rawValue === undefined || rawValue === "") return "—";

  if (def?.options?.length) {
    const values = String(rawValue).split(";");
    const labels = values.map((v) => def.options.find((o) => o.value === v)?.label ?? v);
    return labels.join(", ");
  }

  if (typeof rawValue === "object") return JSON.stringify(rawValue);
  return String(rawValue);
}
