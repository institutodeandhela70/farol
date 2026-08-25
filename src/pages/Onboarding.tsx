import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export default function Onboarding() {
  const { user, loading: authLoading } = useAuth();
  const { memberships, loading: workspaceLoading, switchWorkspace, refresh } = useWorkspace();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!authLoading && !user) return <Navigate to="/auth" replace />;
  if (!workspaceLoading && memberships.length > 0) return <Navigate to="/" replace />;

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmed = name.trim();
    if (!trimmed) {
      setError("Informe um nome para o workspace.");
      return;
    }

    setSubmitting(true);
    const slug = `${slugify(trimmed)}-${Math.random().toString(36).slice(2, 6)}`;
    // Geramos o id no cliente: o INSERT ... RETURNING não enxerga, na mesma instrução,
    // a linha que o trigger cria em workspace_members (a política de SELECT depende dela).
    const id = crypto.randomUUID();

    const { error: insertError } = await supabase.from("workspaces").insert({ id, name: trimmed, slug });

    setSubmitting(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    await refresh();
    switchWorkspace(id);
    navigate("/", { replace: true });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-lg font-medium">Vamos criar seu workspace</h1>
          <p className="text-sm text-muted-foreground">
            É onde os dashboards e integrações do Instituto vão viver.
          </p>
        </div>

        <form onSubmit={handleCreate} className="flex flex-col gap-4 rounded-lg border border-border bg-card p-6">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="workspace-name">Nome do workspace</Label>
            <Input
              id="workspace-name"
              placeholder="Instituto Deandhela"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" disabled={submitting}>
            Criar workspace
          </Button>
        </form>
      </div>
    </div>
  );
}
