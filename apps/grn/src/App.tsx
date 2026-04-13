import { lazy, Suspense, useState } from 'react'
import { useAuth } from './hooks/useAuth'
import { PlantLoader } from './components/branding/PlantLoader'
import './App.css'

type AuthView = 'login' | 'signup' | 'forgot-password';

const LoginPage = lazy(() => import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const SignUpPage = lazy(() => import('./pages/SignUpPage').then((m) => ({ default: m.SignUpPage })));
const ForgotPasswordPage = lazy(() =>
  import('./pages/ForgotPasswordPage').then((m) => ({ default: m.ForgotPasswordPage }))
);
const ProfileView = lazy(() => import('./components/Profile/ProfileView').then((m) => ({ default: m.ProfileView })));
const OnboardingGuard = lazy(() =>
  import('./components/Onboarding/OnboardingGuard').then((m) => ({ default: m.OnboardingGuard }))
);

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
  const { isAuthenticated, isLoading, refreshAuth } = useAuth();
  const [authView, setAuthView] = useState<AuthView>('login');

  if (isLoading) {
    return <FullPageLoader />;
  }

  if (!isAuthenticated) {
    return (
      <Suspense fallback={<FullPageLoader />}>
        {authView === 'signup' ? (
          <SignUpPage
            onSuccess={() => setAuthView('login')}
            onNavigateToLogin={() => setAuthView('login')}
          />
        ) : authView === 'forgot-password' ? (
          <ForgotPasswordPage
            onSuccess={() => setAuthView('login')}
            onNavigateToLogin={() => setAuthView('login')}
          />
        ) : (
          <LoginPage
            onSuccess={() => {
              refreshAuth();
            }}
            onNavigateToSignUp={() => setAuthView('signup')}
            onNavigateToForgotPassword={() => setAuthView('forgot-password')}
          />
        )}
      </Suspense>
    );
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
