import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AuthProvider } from './hooks/useAuth';
import { ToastProvider } from './hooks/useToast';
import { CatalogFormPage } from './pages/CatalogFormPage';
import { CatalogListPage } from './pages/CatalogListPage';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { SecurityPage } from './pages/SecurityPage';

export function App() {
  // Builds are served under /admin, so routes and links must carry that prefix.
  const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';

  return (
    <BrowserRouter basename={basename}>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<ProtectedRoute />}>
              <Route element={<Layout />}>
                <Route index element={<DashboardPage />} />
                <Route path="products" element={<CatalogListPage kind="products" />} />
                <Route path="products/new" element={<CatalogFormPage kind="products" />} />
                <Route
                  path="products/:id/edit"
                  element={<CatalogFormPage kind="products" />}
                />
                <Route path="services" element={<CatalogListPage kind="services" />} />
                <Route path="services/new" element={<CatalogFormPage kind="services" />} />
                <Route
                  path="services/:id/edit"
                  element={<CatalogFormPage kind="services" />}
                />
                <Route path="security" element={<SecurityPage />} />
              </Route>
            </Route>
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
