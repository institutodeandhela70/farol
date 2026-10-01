import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { Drill } from "@/lib/detailData";
import { DetailTable } from "@/components/result/DetailTable";

// Clique num número/gráfico → painel lateral com as linhas que o formam.

interface DrillApi {
  open: (drill: Drill) => void;
}

const Ctx = createContext<DrillApi>({ open: () => undefined });

export function useDrill(): DrillApi {
  return useContext(Ctx);
}

export function DrillProvider({ children }: { children: ReactNode }) {
  const [drill, setDrill] = useState<Drill | null>(null);
  const open = useCallback((d: Drill) => setDrill(d), []);
  const api = useMemo(() => ({ open }), [open]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <Sheet open={!!drill} onOpenChange={(o) => !o && setDrill(null)}>
        <SheetContent side="right" className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-[min(1200px,96vw)]">
          <SheetHeader className="text-left">
            <SheetTitle>{drill?.title ?? "Detalhamento"}</SheetTitle>
            <SheetDescription>{drill?.subtitle ?? "Todas as linhas que formam este número."}</SheetDescription>
          </SheetHeader>
          {drill && <DetailTable drill={drill} compact />}
        </SheetContent>
      </Sheet>
    </Ctx.Provider>
  );
}
