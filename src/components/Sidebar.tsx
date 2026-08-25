import { useMemo, useState, type ComponentType } from "react";
import { Link, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, ChevronLeft, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { navGroups, topLevelLinks, type NavGroup, type NavLink } from "@/components/layout/navConfig";
import { WorkspaceSwitcher } from "@/components/WorkspaceSwitcher";
import { UserMenu } from "@/components/UserMenu";
import { usePlatformAdmin } from "@/hooks/usePlatformAdmin";

function Logo({ collapsed }: { collapsed: boolean }) {
  return (
    <div className="flex items-center gap-2 overflow-hidden px-1">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-medium text-primary-foreground">
        F
      </div>
      <motion.div
        animate={{ opacity: collapsed ? 0 : 1, width: collapsed ? 0 : "auto" }}
        transition={{ duration: 0.15 }}
        className="overflow-hidden whitespace-nowrap"
      >
        <p className="text-sm font-medium leading-tight">Farol ID</p>
        <p className="text-xs leading-tight text-sidebar-foreground/50">Instituto Deandhela</p>
      </motion.div>
    </div>
  );
}

type LucideIconLike = ComponentType<{ className?: string }>;

function isActiveChild(currentPath: string, children: NavLink[]): string | null {
  const matches = children.filter(
    (c) => currentPath === c.id || currentPath.startsWith(`${c.id}/`),
  );
  if (matches.length === 0) return null;
  return matches.sort((a, b) => b.id.length - a.id.length)[0].id;
}

function SidebarLink({
  to,
  label,
  icon: Icon,
  active,
  collapsed,
  nested,
}: {
  to: string;
  label: string;
  icon: LucideIconLike;
  active: boolean;
  collapsed: boolean;
  nested?: boolean;
}) {
  return (
    <Link
      to={`/${to}`}
      className={cn(
        "flex items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors",
        nested && "ml-3",
        active
          ? "bg-primary/15 text-primary"
          : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" />
      <motion.span
        animate={{ opacity: collapsed ? 0 : 1, width: collapsed ? 0 : "auto" }}
        transition={{ duration: 0.15 }}
        className="overflow-hidden whitespace-nowrap"
      >
        {label}
      </motion.span>
    </Link>
  );
}

function SidebarGroup({
  group,
  currentPath,
  collapsed,
  expanded,
  onToggle,
}: {
  group: NavGroup;
  currentPath: string;
  collapsed: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const activeChildId = isActiveChild(currentPath, group.children);
  const Icon = group.icon;

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors",
          activeChildId
            ? "text-sidebar-foreground"
            : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground",
        )}
      >
        <Icon className="size-4 shrink-0" />
        <motion.span
          animate={{ opacity: collapsed ? 0 : 1, width: collapsed ? 0 : "auto" }}
          transition={{ duration: 0.15 }}
          className="flex-1 overflow-hidden whitespace-nowrap text-left"
        >
          {group.label}
        </motion.span>
        {!collapsed && (
          <ChevronDown
            className={cn("size-3.5 shrink-0 transition-transform", expanded && "rotate-180")}
          />
        )}
      </button>
      <AnimatePresence initial={false}>
        {expanded && !collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-0.5 py-1">
              {group.children.map((child) => (
                <SidebarLink
                  key={child.id}
                  to={child.id}
                  label={child.label}
                  icon={child.icon}
                  active={activeChildId === child.id}
                  collapsed={collapsed}
                  nested
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function Sidebar() {
  const { isAdmin: isPlatformAdmin } = usePlatformAdmin();
  const location = useLocation();
  const currentPath = location.pathname.replace(/^\//, "");
  const [collapsed, setCollapsed] = useState(false);

  const initialExpanded = useMemo(() => {
    const set = new Set<string>();
    for (const group of navGroups) {
      if (isActiveChild(currentPath, group.children)) set.add(group.id);
    }
    return set;
  }, [currentPath]);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(initialExpanded);

  const toggleGroup = (id: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <motion.aside
      animate={{ width: collapsed ? 76 : 260 }}
      transition={{ duration: 0.2 }}
      className="relative flex h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar-background"
    >
      <div className="flex h-14 items-center px-3">
        <Logo collapsed={collapsed} />
      </div>

      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
        className="absolute -right-3 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full border border-sidebar-border bg-sidebar-background text-sidebar-foreground/60 shadow-sm hover:text-sidebar-foreground"
      >
        <ChevronLeft className={cn("size-3.5 transition-transform", collapsed && "rotate-180")} />
      </button>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 py-2">
        {topLevelLinks.map((link) => (
          <SidebarLink
            key={link.id}
            to={link.id}
            label={link.label}
            icon={link.icon}
            active={currentPath === link.id}
            collapsed={collapsed}
          />
        ))}

        <div className="my-2 h-px bg-sidebar-border" />

        {navGroups.map((group) => (
          <SidebarGroup
            key={group.id}
            group={group}
            currentPath={currentPath}
            collapsed={collapsed}
            expanded={expandedGroups.has(group.id)}
            onToggle={() => toggleGroup(group.id)}
          />
        ))}
      </nav>

      <div className="flex flex-col gap-2 border-t border-sidebar-border p-2">
        {isPlatformAdmin && (
          <Link
            to="/platform"
            className="flex items-center gap-3 rounded-md bg-platform/10 px-2.5 py-2 text-sm text-platform ring-1 ring-platform/30 hover:bg-platform/15"
          >
            <ShieldCheck className="size-4 shrink-0" />
            <motion.span
              animate={{ opacity: collapsed ? 0 : 1, width: collapsed ? 0 : "auto" }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden whitespace-nowrap"
            >
              Plataforma
            </motion.span>
          </Link>
        )}
        <WorkspaceSwitcher collapsed={collapsed} />
        <UserMenu collapsed={collapsed} />
      </div>
    </motion.aside>
  );
}
