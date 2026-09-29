import type { ComponentType } from "react";
import { Navigate, Route, BrowserRouter, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/hooks/useTheme";
import { AuthProvider } from "@/hooks/useAuth";
import { WorkspaceProvider } from "@/hooks/WorkspaceProvider";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { PlatformRoute } from "@/components/PlatformRoute";
import { RequirePermission } from "@/components/RequirePermission";
import { AppLayout } from "@/components/layout/AppLayout";
import { PlaceholderPage } from "@/components/layout/PlaceholderPage";
import { navGroups, topLevelLinks } from "@/components/layout/navConfig";
import { menuPermissionKey } from "@/hooks/usePermissions";
import { PlatformLayout } from "@/pages/platform/PlatformLayout";
import AuthPage from "@/pages/Auth";
import Onboarding from "@/pages/Onboarding";
import SetPassword from "@/pages/SetPassword";
import InviteAccept from "@/pages/InviteAccept";
import EventoInscricao from "@/pages/EventoInscricao";
import EventoFicha from "@/pages/EventoFicha";
import PlatformWorkspaces from "@/pages/platform/PlatformWorkspaces";
import PlatformUsers from "@/pages/platform/PlatformUsers";
import PlatformEmails from "@/pages/platform/PlatformEmails";
import VisaoGeral from "@/pages/VisaoGeral";
import Integracoes from "@/pages/Integracoes";
import Equipe from "@/pages/Equipe";
import AsaasDashboard from "@/pages/AsaasDashboard";
import HublaDashboard from "@/pages/HublaDashboard";
import TmbDashboard from "@/pages/TmbDashboard";
import ReceitasUpload from "@/pages/ReceitasUpload";
import ReceitasEnriquecimento from "@/pages/ReceitasEnriquecimento";
import ReceitasDashboard from "@/pages/ReceitasDashboard";
import Eventos from "@/pages/Eventos";
import EventoDetalhe from "@/pages/EventoDetalhe";
import HubspotContacts from "@/pages/HubspotContacts";
import HubspotDeals from "@/pages/HubspotDeals";
import HubspotMeetings from "@/pages/HubspotMeetings";
import IntegrationLogs from "@/pages/IntegrationLogs";
import ComercialVisaoGeral from "@/pages/comercial/ComercialVisaoGeral";
import ComercialAgenda from "@/pages/comercial/ComercialAgenda";
import ComercialPipeline from "@/pages/comercial/ComercialPipeline";
import ComercialFechamento from "@/pages/comercial/ComercialFechamento";
import ComercialVendedor from "@/pages/comercial/ComercialVendedor";
import ComercialMetas from "@/pages/comercial/ComercialMetas";
import IuliVisaoGeral from "@/pages/financeiro-iuli/IuliVisaoGeral";
import IuliVendas from "@/pages/financeiro-iuli/IuliVendas";
import IuliReceber from "@/pages/financeiro-iuli/IuliReceber";
import IuliNotas from "@/pages/financeiro-iuli/IuliNotas";
import IuliAssinaturas from "@/pages/financeiro-iuli/IuliAssinaturas";
import IuliCadastros from "@/pages/financeiro-iuli/IuliCadastros";

const allRoutes = [...topLevelLinks, ...navGroups.flatMap((group) => group.children)];

const customPages: Record<string, ComponentType> = {
  dashboard: VisaoGeral,
  eventos: Eventos,
  "settings/integracoes": Integracoes,
  "settings/integracoes-logs": IntegrationLogs,
  "settings/equipe": Equipe,
  "dashboards/asaas": AsaasDashboard,
  "dashboards/hubla": HublaDashboard,
  "dashboards/tmb": TmbDashboard,
  "financeiro/receitas": ReceitasUpload,
  "financeiro/dashboard": ReceitasDashboard,
  "dashboards/hubspot-contatos": HubspotContacts,
  "dashboards/hubspot-negocios": HubspotDeals,
  "dashboards/hubspot-agendas": HubspotMeetings,
  "comercial/visao-geral": ComercialVisaoGeral,
  "comercial/agenda": ComercialAgenda,
  "comercial/pipeline": ComercialPipeline,
  "comercial/fechamento": ComercialFechamento,
  "comercial/vendedor": ComercialVendedor,
  "comercial/metas": ComercialMetas,
  "iuli/visao-geral": IuliVisaoGeral,
  "iuli/vendas": IuliVendas,
  "iuli/receber": IuliReceber,
  "iuli/notas": IuliNotas,
  "iuli/assinaturas": IuliAssinaturas,
  "iuli/cadastros": IuliCadastros,
};

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
                <Route path="/set-password" element={<SetPassword />} />
                <Route path="/inscricao/:slug" element={<EventoInscricao />} />
                <Route path="/inscricao/:slug/ficha" element={<EventoFicha />} />

                <Route element={<ProtectedRoute />}>
                  <Route element={<AppLayout />}>
                    <Route index element={<Navigate to="/dashboard" replace />} />
                    <Route path="financeiro/receitas/:importId" element={<ReceitasEnriquecimento />} />
                    <Route path="eventos/:eventId" element={<EventoDetalhe />} />
                    <Route path="comercial" element={<Navigate to="/comercial/visao-geral" replace />} />
                    <Route path="iuli" element={<Navigate to="/iuli/visao-geral" replace />} />
                    {allRoutes.map((route) => {
                      const CustomPage = customPages[route.id];
                      return (
                        <Route
                          key={route.id}
                          path={route.id}
                          element={
                            <RequirePermission permission={menuPermissionKey(route.id)}>
                              {CustomPage ? <CustomPage /> : <PlaceholderPage title={route.label} />}
                            </RequirePermission>
                          }
                        />
                      );
                    })}
                  </Route>
                </Route>

                <Route element={<PlatformRoute />}>
                  <Route path="/platform" element={<PlatformLayout />}>
                    <Route index element={<Navigate to="/platform/workspaces" replace />} />
                    <Route path="workspaces" element={<PlatformWorkspaces />} />
                    <Route path="usuarios" element={<PlatformUsers />} />
                    <Route path="emails" element={<PlatformEmails />} />
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
