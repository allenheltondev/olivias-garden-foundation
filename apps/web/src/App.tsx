import { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import {
  confirmPasswordReset,
  confirmSignUp,
  getCognitoConfig,
  requestPasswordReset,
  resendSignUpCode,
  restoreAuthSession,
  signInWithPassword,
  signOut,
  signUpWithPassword,
} from './auth/cognito';
import type { AuthSession } from './auth/session';
import { SiteFooter, SiteHeader } from './site/chrome';
import { useRouteSeo } from './site/seo';
import { LoginPage } from './site/pages/LoginPage';
import {
  AboutPage,
  AuthCallbackPage,
  ContactPage,
  GetInvolvedPage,
  HomePage,
  ImpactPage,
  OkraPage,
} from './site/pages/content-pages';
import { getRouteByPath } from './site/routes';
import { usePathname } from './site/usePathname';

const DonatePage = lazy(async () => {
  const module = await import('./site/pages/DonatePage');
  return { default: module.DonatePage };
});

function App() {
  const { pathname, navigate } = usePathname();
  const authConfig = getCognitoConfig();
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [loginModePreference, setLoginModePreference] = useState<'login' | 'signup'>('login');
  const page = getRouteByPath(pathname);

  useRouteSeo(page, pathname);

  useEffect(() => {
    let active = true;

    restoreAuthSession(authConfig)
      .then((session) => {
        if (!active) {
          return;
        }
        setAuthSession(session);
        setAuthReady(true);
      })
      .catch(() => {
        if (!active) {
          return;
        }
        setAuthSession(null);
        setAuthReady(true);
      });

    return () => {
      active = false;
    };
  }, [authConfig.clientId, authConfig.domain, authConfig.enabled, authConfig.userPoolId]);

  const openLoginPage = () => {
    setAuthError(null);
    setLoginModePreference('login');
    navigate('/login');
  };

  const openSignupPage = () => {
    setAuthError(null);
    setLoginModePreference('signup');
    navigate('/login');
  };

  const submitLogin = async (email: string, password: string) => {
    if (!authConfig.enabled) {
      throw new Error('Login is not configured for this environment yet.');
    }

    setAuthError(null);
    setAuthBusy(true);
    try {
      const session = await signInWithPassword(authConfig, email, password);
      setAuthSession(session);
      return session;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to sign in.';
      setAuthError(message);
      throw new Error(message);
    } finally {
      setAuthBusy(false);
    }
  };

  const submitSignup = async (
    email: string,
    password: string,
    firstName: string,
    lastName: string,
    newsletterOptIn: boolean,
  ) => {
    if (!authConfig.enabled) {
      throw new Error('Login is not configured for this environment yet.');
    }

    setAuthError(null);
    setAuthBusy(true);
    try {
      return await signUpWithPassword(authConfig, email, password, firstName, lastName, newsletterOptIn);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to create your account.';
      setAuthError(message);
      throw new Error(message);
    } finally {
      setAuthBusy(false);
    }
  };

  const submitPasswordResetRequest = async (email: string) => {
    if (!authConfig.enabled) {
      throw new Error('Login is not configured for this environment yet.');
    }

    setAuthError(null);
    setAuthBusy(true);
    try {
      await requestPasswordReset(authConfig, email);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to send reset instructions.';
      setAuthError(message);
      throw new Error(message);
    } finally {
      setAuthBusy(false);
    }
  };

  const submitPasswordResetConfirm = async (email: string, code: string, password: string) => {
    if (!authConfig.enabled) {
      throw new Error('Login is not configured for this environment yet.');
    }

    setAuthError(null);
    setAuthBusy(true);
    try {
      await confirmPasswordReset(authConfig, email, code, password);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to reset your password.';
      setAuthError(message);
      throw new Error(message);
    } finally {
      setAuthBusy(false);
    }
  };

  const submitSignUpConfirmation = async (email: string, code: string) => {
    if (!authConfig.enabled) {
      throw new Error('Login is not configured for this environment yet.');
    }

    setAuthError(null);
    setAuthBusy(true);
    try {
      await confirmSignUp(authConfig, email, code);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to verify your email.';
      setAuthError(message);
      throw new Error(message);
    } finally {
      setAuthBusy(false);
    }
  };

  const resendSignupVerification = async (email: string) => {
    if (!authConfig.enabled) {
      throw new Error('Login is not configured for this environment yet.');
    }

    setAuthError(null);
    setAuthBusy(true);
    try {
      await resendSignUpCode(authConfig, email);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to resend the verification code.';
      setAuthError(message);
      throw new Error(message);
    } finally {
      setAuthBusy(false);
    }
  };

  const handleLogout = () => {
    setAuthSession(null);
    signOut(authConfig);
  };

  const routeFallback = <div className="page-section"><p className="page-text">Loading page...</p></div>;

  return (
    <div className="og-app-shell">
      <SiteHeader
        pathname={pathname}
        onNavigate={navigate}
        authEnabled={authConfig.enabled}
        authSession={authSession}
        authBusy={authBusy || !authReady}
        authError={authError}
      />
      <main className={`og-app-main ${pathname === '/login' ? 'og-app-main--flush' : ''}`.trim()}>
        <Routes>
          <Route path="/" element={<HomePage onNavigate={navigate} />} />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route
            path="/login"
            element={
              <LoginPage
                authEnabled={authConfig.enabled}
                authSession={authSession}
                authBusy={authBusy || !authReady}
                authError={authError}
                defaultMode={loginModePreference}
                onSubmitLogin={submitLogin}
                onSubmitSignup={submitSignup}
                onConfirmSignup={submitSignUpConfirmation}
                onResendSignupCode={resendSignupVerification}
                onRequestPasswordReset={submitPasswordResetRequest}
                onConfirmPasswordReset={submitPasswordResetConfirm}
                onLogout={handleLogout}
                onNavigate={navigate}
              />
            }
          />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/get-involved" element={<GetInvolvedPage onNavigate={navigate} />} />
          <Route
            path="/okra"
            element={
              <OkraPage
                onNavigate={navigate}
                authEnabled={authConfig.enabled}
                authSession={authSession}
                onLogin={openLoginPage}
                onSignup={openSignupPage}
              />
            }
          />
          <Route path="/impact" element={<ImpactPage onNavigate={navigate} />} />
          <Route
            path="/donate"
            element={
              <Suspense fallback={routeFallback}>
                <DonatePage onNavigate={navigate} authSession={authSession} />
              </Suspense>
            }
          />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/seeds" element={<Navigate to="/okra" replace />} />
          <Route path="*" element={<HomePage onNavigate={navigate} />} />
        </Routes>
      </main>
      <SiteFooter currentPage={page} onNavigate={navigate} />
    </div>
  );
}

export default App;
