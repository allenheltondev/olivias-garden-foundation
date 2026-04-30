import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { PlantLoader } from './components/branding/PlantLoader';
import { AppShell } from './shell/AppShell';
import { DashboardPage } from './pages/DashboardPage';
import { CropsPage } from './pages/CropsPage';
import { ListingsPage } from './pages/ListingsPage';
import { RequestsPage } from './pages/RequestsPage';
import { RemindersPage } from './pages/RemindersPage';

const OnboardingGuard = lazy(() =>
  import('./components/Onboarding/OnboardingGuard').then((m) => ({ default: m.OnboardingGuard }))
);

const foundationLoginUrl = import.meta.env.VITE_FOUNDATION_URL
  ? `${import.meta.env.VITE_FOUNDATION_URL.replace(/\/+$/, '')}/login`
  : 'https://oliviasgarden.org/login';

function redirectToLogin() {
  const returnUrl = window.location.href;
  const loginUrl = `${foundationLoginUrl}?redirect=${encodeURIComponent(returnUrl)}`;
  window.location.assign(loginUrl);
}

function FullPageLoader() {
  return (
    <div className="grn-fullpage">
      <div className="grn-page-status">
        <PlantLoader size="md" />
        <p>Loading…</p>
      </div>
    </div>
  );
}

function App() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <FullPageLoader />;
  }

  if (!isAuthenticated) {
    redirectToLogin();
    return <FullPageLoader />;
  }

  return (
    <Suspense fallback={<FullPageLoader />}>
      <OnboardingGuard>
        <AppShell>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/crops" element={<CropsPage />} />
            <Route path="/listings" element={<ListingsPage />} />
            <Route path="/requests" element={<RequestsPage />} />
            <Route path="/reminders" element={<RemindersPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AppShell>
      </OnboardingGuard>
    </Suspense>
  );
}

export default App;
