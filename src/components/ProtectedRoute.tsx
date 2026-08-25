import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/WorkspaceProvider";

function FullScreenLoading() {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-background text-sm text-muted-foreground">
      Carregando...
    </div>
  );
}

export function ProtectedRoute() {
  const { user, loading: authLoading } = useAuth();
  const { workspace, memberships, loading: workspaceLoading } = useWorkspace();

  if (authLoading) return <FullScreenLoading />;
  if (!user) return <Navigate to="/auth" replace />;
  if (workspaceLoading) return <FullScreenLoading />;
  if (memberships.length === 0) return <Navigate to="/onboarding" replace />;
  if (!workspace) return <FullScreenLoading />;

  return <Outlet />;
}
