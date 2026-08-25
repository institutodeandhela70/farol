import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";

interface InviteRow {
  id: string;
  workspace_id: string;
  role: "owner" | "admin" | "member";
  status: string;
  expires_at: string;
  workspace: { name: string } | null;
}

export default function InviteAccept() {
  const { token } = useParams<{ token: string }>();
  const { user, loading: authLoading } = useAuth();
  const { switchWorkspace, refresh } = useWorkspace();
  const navigate = useNavigate();

  const [invite, setInvite] = useState<InviteRow | null>(null);
  const [status, setStatus] = useState<"loading" | "invalid" | "ready" | "accepting">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    supabase
      .from("workspace_invites")
      .select("id, workspace_id, role, status, expires_at, workspace:workspaces(name)")
      .eq("token", token)
      .maybeSingle()
      .then(({ data, error: fetchError }) => {
        if (fetchError || !data || data.status !== "pending" || new Date(data.expires_at) < new Date()) {
          setStatus("invalid");
          return;
        }
        setInvite(data as unknown as InviteRow);
        setStatus("ready");
      });
  }, [token]);

  if (!authLoading && !user) {
    return <Navigate to="/auth" replace />;
  }

  const handleAccept = async () => {
    if (!invite || !user) return;
    setStatus("accepting");
    setError(null);

    const { error: memberError } = await supabase.from("workspace_members").insert({
      workspace_id: invite.workspace_id,
      user_id: user.id,
      role: invite.role,
      joined_at: new Date().toISOString(),
    });

    if (memberError) {
      setError(memberError.message);
      setStatus("ready");
      return;
    }

    await supabase.from("workspace_invites").update({ status: "accepted" }).eq("id", invite.id);

    await refresh();
    switchWorkspace(invite.workspace_id);
    navigate("/", { replace: true });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 text-center">
        {status === "loading" && <p className="text-sm text-muted-foreground">Carregando convite...</p>}

        {status === "invalid" && (
          <>
            <p className="text-sm text-destructive">Este convite não é válido ou já expirou.</p>
            <Link to="/" className="mt-4 inline-block text-sm text-primary hover:underline">
              Voltar
            </Link>
          </>
        )}

        {(status === "ready" || status === "accepting") && invite && (
          <>
            <h1 className="text-lg font-medium">Convite para {invite.workspace?.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Você foi convidado como <strong className="font-medium">{invite.role}</strong>.
            </p>
            {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
            <Button className="mt-4 w-full" onClick={handleAccept} disabled={status === "accepting"}>
              Aceitar convite
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
