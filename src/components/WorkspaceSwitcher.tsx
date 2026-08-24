import { Building2, ChevronsUpDown } from "lucide-react";
import { motion } from "framer-motion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Placeholder estático — troca de workspace real entra na Fase 3 (auth + multi-tenant).
export function WorkspaceSwitcher({ collapsed }: { collapsed: boolean }) {
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
              Instituto Deandhela
            </span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-sidebar-foreground/50" />
          </motion.div>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Workspace</DropdownMenuLabel>
        <DropdownMenuItem disabled>Instituto Deandhela</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
