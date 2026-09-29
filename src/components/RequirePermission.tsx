import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { usePermissions } from "@/hooks/usePermissions";

export function RequirePermission({ permission, children }: { permission: string; children: ReactNode }) {
  const { has, loading } = usePermissions();

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center p-6 text-sm text-muted-foreground">
        Carregando...
      </div>
    );
  }

  if (!has(permission)) {
    // Evita loop de redirecionamento caso até "menu.dashboard" tenha sido
    // negado pra esse perfil — nesse caso só avisa, não redireciona.
    if (permission === "menu.dashboard") {
      return (
        <div className="flex h-full w-full items-center justify-center p-6 text-sm text-muted-foreground">
          Você não tem acesso a nenhuma área liberada. Fale com um administrador.
        </div>
      );
    }
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
