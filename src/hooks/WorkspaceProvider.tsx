import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { getActiveWorkspaceId, setActiveWorkspaceId } from "@/lib/workspaceContext";

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
}

export interface Membership {
  id: string;
  role: "owner" | "admin" | "member";
  workspace: WorkspaceSummary;
}

interface WorkspaceContextValue {
  workspace: WorkspaceSummary | null;
  role: Membership["role"] | null;
  memberships: Membership[];
  loading: boolean;
  switchWorkspace: (workspaceId: string) => void;
  refresh: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(undefined);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadMemberships = useCallback(async () => {
    if (!user) {
      setMemberships([]);
      setWorkspaceId(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    const { data, error } = await supabase
      .from("workspace_members")
      .select("id, role, workspace:workspaces(id, name, slug, logo_url)")
      .eq("user_id", user.id)
      .eq("is_active", true);

    if (error) {
      console.error("Falha ao carregar workspaces", error);
      setMemberships([]);
      setWorkspaceId(null);
      setLoading(false);
      return;
    }

    const list = (data ?? []) as unknown as Membership[];
    setMemberships(list);

    const stored = getActiveWorkspaceId();
    const validStored = list.find((m) => m.workspace.id === stored);
    const resolved = validStored?.workspace.id ?? list[0]?.workspace.id ?? null;
    setActiveWorkspaceId(resolved);
    setWorkspaceId(resolved);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    loadMemberships();
  }, [authLoading, loadMemberships]);

  const switchWorkspace = (id: string) => {
    setActiveWorkspaceId(id);
    setWorkspaceId(id);
  };

  const active = memberships.find((m) => m.workspace.id === workspaceId) ?? null;

  return (
    <WorkspaceContext.Provider
      value={{
        workspace: active?.workspace ?? null,
        role: active?.role ?? null,
        memberships,
        loading: authLoading || loading,
        switchWorkspace,
        refresh: loadMemberships,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace deve ser usado dentro de um WorkspaceProvider");
  return ctx;
}
