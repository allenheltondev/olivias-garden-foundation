import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { PlantLoader } from './components/branding/PlantLoader';

// Lazy-load the entire authenticated shell + every route + the onboarding
// guard so the main bundle stays under the perf:budget cap. Eagerly importing
// AppShell pulls useUser → services/api.ts (~26 KB) into main; deferring it
// keeps that out of the initial download until the user is past auth.
const AppShell = lazy(() =>
  import('./shell/AppShell').then((m) => ({ default: m.AppShell }))
);
const OnboardingGuard = lazy(() =>
  import('./components/Onboarding/OnboardingGuard').then((m) => ({ default: m.OnboardingGuard }))
);
const DashboardPage = lazy(() =>
  import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage }))
);
const CropsPage = lazy(() =>
  import('./pages/CropsPage').then((m) => ({ default: m.CropsPage }))
);
const ListingsPage = lazy(() =>
  import('./pages/ListingsPage').then((m) => ({ default: m.ListingsPage }))
);
const RequestsPage = lazy(() =>
  import('./pages/RequestsPage').then((m) => ({ default: m.RequestsPage }))
);
const RemindersPage = lazy(() =>
  import('./pages/RemindersPage').then((m) => ({ default: m.RemindersPage }))
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
