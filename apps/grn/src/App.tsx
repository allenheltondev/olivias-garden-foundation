import { lazy, Suspense } from 'react'
import { useAuth } from './hooks/useAuth'
import { PlantLoader } from './components/branding/PlantLoader'
import './App.css'

const ProfileView = lazy(() => import('./components/Profile/ProfileView').then((m) => ({ default: m.ProfileView })));
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
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <PlantLoader size="md" />
        <p className="text-gray-600 mt-4">Loading...</p>
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
        <ProfileView />
      </OnboardingGuard>
    </Suspense>
  );
}

export default App
