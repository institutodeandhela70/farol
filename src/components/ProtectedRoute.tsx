import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { supabase } from "@/lib/supabase";

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

  const [profileLoading, setProfileLoading] = useState(true);
  const [mustChangePassword, setMustChangePassword] = useState(false);

  useEffect(() => {
    let active = true;
    const loadProfile = async () => {
      if (!user) {
        setProfileLoading(false);
        return;
      }
      const { data } = await supabase.from("profiles").select("must_change_password").eq("id", user.id).maybeSingle();
      if (!active) return;
      setMustChangePassword(data?.must_change_password ?? false);
      setProfileLoading(false);
    };
    loadProfile();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  if (authLoading) return <FullScreenLoading />;
  if (!user) return <Navigate to="/auth" replace />;
  if (profileLoading) return <FullScreenLoading />;
  if (mustChangePassword) return <Navigate to="/set-password" replace />;
  if (workspaceLoading) return <FullScreenLoading />;
  if (memberships.length === 0) return <Navigate to="/onboarding" replace />;
  if (!workspace) return <FullScreenLoading />;

  return <Outlet />;
}
