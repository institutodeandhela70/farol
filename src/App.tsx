import { Navigate, Route, BrowserRouter, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/hooks/useTheme";
import { AuthProvider } from "@/hooks/useAuth";
import { WorkspaceProvider } from "@/hooks/WorkspaceProvider";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { PlatformRoute } from "@/components/PlatformRoute";
import { AppLayout } from "@/components/layout/AppLayout";
import { PlaceholderPage } from "@/components/layout/PlaceholderPage";
import { navGroups, topLevelLinks } from "@/components/layout/navConfig";
import { PlatformLayout } from "@/pages/platform/PlatformLayout";
import AuthPage from "@/pages/Auth";
import Onboarding from "@/pages/Onboarding";
import InviteAccept from "@/pages/InviteAccept";
import PlatformWorkspaces from "@/pages/platform/PlatformWorkspaces";
import PlatformUsers from "@/pages/platform/PlatformUsers";

const allRoutes = [...topLevelLinks, ...navGroups.flatMap((group) => group.children)];

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BrowserRouter>
          <AuthProvider>
            <WorkspaceProvider>
              <Routes>
                <Route path="/auth" element={<AuthPage />} />
                <Route path="/invite/:token" element={<InviteAccept />} />
                <Route path="/onboarding" element={<Onboarding />} />

                <Route element={<ProtectedRoute />}>
                  <Route element={<AppLayout />}>
                    <Route index element={<Navigate to="/dashboard" replace />} />
                    {allRoutes.map((route) => (
                      <Route
                        key={route.id}
                        path={route.id}
                        element={<PlaceholderPage title={route.label} />}
                      />
                    ))}
                  </Route>
                </Route>

                <Route element={<PlatformRoute />}>
                  <Route path="/platform" element={<PlatformLayout />}>
                    <Route index element={<Navigate to="/platform/workspaces" replace />} />
                    <Route path="workspaces" element={<PlatformWorkspaces />} />
                    <Route path="usuarios" element={<PlatformUsers />} />
                  </Route>
                </Route>
              </Routes>
            </WorkspaceProvider>
          </AuthProvider>
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
