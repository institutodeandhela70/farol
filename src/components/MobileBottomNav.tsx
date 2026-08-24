import { Link, useLocation } from "react-router-dom";
import { LayoutDashboard, Plug, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { to: "dashboard", label: "Visão geral", icon: LayoutDashboard },
  { to: "dashboards/asaas", label: "Dashboards", icon: TrendingUp },
  { to: "settings/integracoes", label: "Integrações", icon: Plug },
];

export function MobileBottomNav() {
  const location = useLocation();
  const currentPath = location.pathname.replace(/^\//, "");

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 flex h-16 items-center justify-around border-t border-border bg-background md:hidden">
      {items.map((item) => {
        const active = currentPath === item.to || currentPath.startsWith(`${item.to}/`);
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
