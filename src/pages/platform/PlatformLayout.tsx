import { useEffect } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { ArrowLeft, Building2, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const platformNav = [
  { to: "/platform/workspaces", label: "Workspaces", icon: Building2 },
  { to: "/platform/usuarios", label: "Usuários", icon: Users },
];

export function PlatformLayout() {
  useEffect(() => {
    document.documentElement.setAttribute("data-platform", "true");
    return () => document.documentElement.removeAttribute("data-platform");
  }, []);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      <aside className="flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar-background">
        <div className="flex h-14 items-center gap-2 px-4">
          <div className="flex size-7 items-center justify-center rounded-md bg-platform text-xs font-medium text-platform-foreground">
            P
          </div>
          <span className="text-sm font-medium text-sidebar-foreground">Plataforma</span>
        </div>

        <nav className="flex flex-1 flex-col gap-1 px-2">
          {platformNav.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-platform/15 text-platform"
                      : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                  )
                }
              >
                <Icon className="size-4 shrink-0" />
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        <div className="border-t border-sidebar-border p-2">
          <Link
            to="/dashboard"
            className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <ArrowLeft className="size-4 shrink-0" />
            Voltar ao workspace
          </Link>
        </div>
      </aside>

      <main className="flex h-full flex-1 flex-col overflow-hidden">
        <div className="border-b border-platform/30 bg-platform/10 px-6 py-2 text-center text-xs text-platform">
          Você está na área de Plataforma — mudanças aqui afetam todos os workspaces.
        </div>
        <div className="flex-1 overflow-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
