import { Building2, Check, ChevronsUpDown } from "lucide-react";
import { motion } from "framer-motion";
import { useWorkspace } from "@/hooks/WorkspaceProvider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function WorkspaceSwitcher({ collapsed }: { collapsed: boolean }) {
  const { workspace, memberships, switchWorkspace } = useWorkspace();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm hover:bg-sidebar-accent"
        >
          <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-sidebar-accent text-sidebar-accent-foreground">
            <Building2 className="size-4" />
          </div>
          <motion.div
            animate={{ opacity: collapsed ? 0 : 1, width: collapsed ? 0 : "auto" }}
            transition={{ duration: 0.15 }}
            className="flex flex-1 items-center justify-between gap-1 overflow-hidden whitespace-nowrap"
          >
            <span className="truncate font-medium text-sidebar-foreground">
              {workspace?.name ?? "Selecionar workspace"}
            </span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-sidebar-foreground/50" />
          </motion.div>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {memberships.map((m) => (
          <DropdownMenuItem key={m.workspace.id} onSelect={() => switchWorkspace(m.workspace.id)}>
            <span className="flex-1 truncate">{m.workspace.name}</span>
            {m.workspace.id === workspace?.id && <Check className="ml-2 size-4 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
