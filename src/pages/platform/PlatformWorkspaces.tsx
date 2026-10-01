import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Badge } from "@/components/ui/badge";

interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  created_at: string;
}

export default function PlatformWorkspaces() {
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("workspaces")
      .select("id, name, slug, is_active, created_at")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setWorkspaces(data ?? []);
        setLoading(false);
      });
  }, []);

  return (
    <div className="p-6">
      <h1 className="text-xl font-medium">Workspaces</h1>
      <p className="mt-1 text-sm text-muted-foreground">Todos os workspaces do Farol ID.</p>

      <div className="mt-6 overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Nome</th>
              <th className="px-4 py-2 font-medium">Slug</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Criado em</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                  Carregando...
                </td>
              </tr>
            )}
            {!loading && workspaces.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                  Nenhum workspace ainda.
                </td>
              </tr>
            )}
            {workspaces.map((ws) => (
              <tr key={ws.id} className="border-t border-border">
                <td className="px-4 py-2">{ws.name}</td>
                <td className="px-4 py-2 text-muted-foreground">{ws.slug}</td>
                <td className="px-4 py-2">
                  <Badge variant={ws.is_active ? "default" : "secondary"}>
                    {ws.is_active ? "Ativo" : "Inativo"}
                  </Badge>
                </td>
                <td className="px-4 py-2 text-muted-foreground">
                  {new Date(ws.created_at).toLocaleDateString("pt-BR")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
