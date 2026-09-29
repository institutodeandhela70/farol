import { Link, useLocation } from "react-router-dom";
import { Handshake, LayoutDashboard, Plug, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePermissions, menuPermissionKey } from "@/hooks/usePermissions";

const items: { to: string; match?: string; label: string; icon: typeof LayoutDashboard }[] = [
  { to: "dashboard", label: "Visão geral", icon: LayoutDashboard },
  { to: "comercial/visao-geral", match: "comercial", label: "Comercial", icon: Handshake },
  { to: "dashboards/asaas", label: "Dashboards", icon: TrendingUp },
  { to: "settings/integracoes", label: "Integrações", icon: Plug },
];

export function MobileBottomNav() {
  const { has } = usePermissions();
  const location = useLocation();
  const currentPath = location.pathname.replace(/^\//, "");
  const visibleItems = items.filter((item) => has(menuPermissionKey(item.to)));

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 flex h-16 items-center justify-around border-t border-border bg-background md:hidden">
      {visibleItems.map((item) => {
        const prefix = item.match ?? item.to;
        const active = currentPath === prefix || currentPath.startsWith(`${prefix}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.to}
            to={`/${item.to}`}
            className={cn(
              "flex flex-col items-center gap-1 text-xs",
              active ? "text-primary" : "text-muted-foreground",
            )}
          >
            <Icon className="size-5" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
