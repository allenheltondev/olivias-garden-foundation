import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Button, Card } from '@olivias/ui';
import { loadAdminSession, type AdminSession } from './auth/session';
import { AppShell } from './shell/AppShell';
import { DashboardPage } from './pages/DashboardPage';
import { FinancePage } from './pages/FinancePage';
import { SeedRequestsPage } from './pages/SeedRequestsPage';
import { OkraQueuePage } from './pages/OkraQueuePage';
import { StorePage } from './pages/StorePage';
import { StoreOrdersPage } from './pages/StoreOrdersPage';
import { WorkshopsPage } from './pages/WorkshopsPage';

const foundationHomeUrl = import.meta.env.VITE_FOUNDATION_URL
  ? import.meta.env.VITE_FOUNDATION_URL.replace(/\/+$/, '')
  : 'https://oliviasgarden.org';
const foundationLoginUrl = `${foundationHomeUrl}/login`;

function redirectToLogin() {
  const returnUrl = window.location.href;
  window.location.assign(`${foundationLoginUrl}?redirect=${encodeURIComponent(returnUrl)}`);
}

function FullPageMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="admin-fullpage">
      <p>{children}</p>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [isLoadingSession, setIsLoadingSession] = useState(true);

  useEffect(() => {
    let mounted = true;
    void loadAdminSession().then((nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      setIsLoadingSession(false);
    });
    return () => {
      mounted = false;
    };
  }, []);

  if (isLoadingSession) {
    return <FullPageMessage>Loading admin session…</FullPageMessage>;
  }

  if (!session) {
    redirectToLogin();
    return <FullPageMessage>Redirecting to login…</FullPageMessage>;
  }

  if (!session.isAdmin) {
    return (
      <div className="admin-fullpage">
        <Card className="admin-restricted">
          <p className="og-section-label">Restricted</p>
          <h1>Administrator access is required.</h1>
          <p>Only signed-in administrators can reach the admin console.</p>
          <div className="admin-restricted__actions">
            <Button onClick={() => window.location.assign(foundationHomeUrl)}>
              Back to Olivia&apos;s Garden
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <AppShell session={session}>
      <Routes>
        <Route path="/" element={<DashboardPage session={session} />} />
        <Route path="/finance" element={<FinancePage session={session} />} />
        <Route path="/seed-requests" element={<SeedRequestsPage session={session} />} />
        <Route path="/okra-queue" element={<OkraQueuePage session={session} />} />
        <Route path="/store" element={<StorePage session={session} />} />
        <Route path="/store/orders" element={<StoreOrdersPage session={session} />} />
        <Route path="/workshops" element={<WorkshopsPage session={session} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
