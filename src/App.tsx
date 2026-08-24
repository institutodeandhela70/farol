import { Navigate, Route, BrowserRouter, Routes } from "react-router-dom";
import { ThemeProvider } from "@/hooks/useTheme";
import { AppLayout } from "@/components/layout/AppLayout";
import { PlaceholderPage } from "@/components/layout/PlaceholderPage";
import { navGroups, topLevelLinks } from "@/components/layout/navConfig";

const allRoutes = [
  ...topLevelLinks,
  ...navGroups.flatMap((group) => group.children),
];

function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
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
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
