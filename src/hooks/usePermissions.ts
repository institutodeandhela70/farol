import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/WorkspaceProvider";

// Deriva a permission_key de um id de rota do navConfig (ex.: "dashboards/hubla"
// -> "menu.dashboards.hubla"), mesma convenção usada nas migrations de permissão.
export function menuPermissionKey(routeId: string): string {
  return `menu.${routeId.replaceAll("/", ".")}`;
}

export function usePermissions() {
  const { user, loading: authLoading } = useAuth();
  const { workspace, role, loading: workspaceLoading } = useWorkspace();
  const [keys, setKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading || workspaceLoading) return;

    let active = true;
    const load = async () => {
      if (!user || !workspace) {
        setKeys(new Set());
        setLoading(false);
        return;
      }
      setLoading(true);
      const { data, error } = await supabase.rpc("get_my_permissions", { p_workspace_id: workspace.id });
      if (!active) return;
      setKeys(!error && data ? new Set(data as string[]) : new Set());
      setLoading(false);
    };
    load();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading, workspace?.id, workspaceLoading]);

  const isOwnerOrAdmin = role === "owner" || role === "admin";

  return {
    has: (key: string) => isOwnerOrAdmin || keys.has(key),
    isOwnerOrAdmin,
    loading: authLoading || workspaceLoading || loading,
  };
}
