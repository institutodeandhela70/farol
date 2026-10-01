import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { usePlatformAdmin } from "@/hooks/usePlatformAdmin";

function FullScreenLoading() {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-background text-sm text-muted-foreground">
      Carregando...
    </div>
  );
}

export function PlatformRoute() {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, loading: adminLoading } = usePlatformAdmin();

  if (authLoading) return <FullScreenLoading />;
  if (!user) return <Navigate to="/auth" replace />;
  if (adminLoading) return <FullScreenLoading />;
  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  return <Outlet />;
}
