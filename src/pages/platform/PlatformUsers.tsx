import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface UserRow {
  id: string;
  email: string;
  full_name: string | null;
  created_at: string;
}

export default function PlatformUsers() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.rpc("platform_list_users").then(({ data }) => {
      setUsers((data as UserRow[]) ?? []);
      setLoading(false);
    });
  }, []);

  return (
    <div className="p-6">
      <h1 className="text-xl font-medium">Usuários</h1>
      <p className="mt-1 text-sm text-muted-foreground">Todos os usuários cadastrados no Farol ID.</p>

      <div className="mt-6 overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Nome</th>
              <th className="px-4 py-2 font-medium">E-mail</th>
              <th className="px-4 py-2 font-medium">Cadastrado em</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-muted-foreground">
                  Carregando...
                </td>
              </tr>
            )}
            {!loading && users.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-muted-foreground">
                  Nenhum usuário ainda.
                </td>
              </tr>
            )}
            {users.map((u) => (
              <tr key={u.id} className="border-t border-border">
                <td className="px-4 py-2">{u.full_name ?? "—"}</td>
                <td className="px-4 py-2 text-muted-foreground">{u.email}</td>
                <td className="px-4 py-2 text-muted-foreground">
                  {new Date(u.created_at).toLocaleDateString("pt-BR")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
