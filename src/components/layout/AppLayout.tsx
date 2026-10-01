import { Outlet } from "react-router-dom";
import { Sidebar } from "@/components/Sidebar";
import { MobileBottomNav } from "@/components/MobileBottomNav";

export function AppLayout() {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      <div className="hidden md:block">
        <Sidebar />
      </div>
      <main className="relative flex h-full flex-1 flex-col overflow-hidden">
        <div className="h-full w-full overflow-auto pb-16 md:pb-0">
          <Outlet />
        </div>
      </main>
      <MobileBottomNav />
    </div>
  );
}
