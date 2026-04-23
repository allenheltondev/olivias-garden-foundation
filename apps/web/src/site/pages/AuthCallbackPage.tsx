import { useEffect, useRef, useState } from 'react';
import { type CognitoConfig, decodeHostedUiState, exchangeCodeForTokens } from '../../auth/cognito';
import { redirectAfterAuth } from '../../auth/redirect';
import type { AuthSession } from '../../auth/session';
import { CtaButton, PageHero } from '../chrome';

function formatHostedUiError(error: string | null, description: string | null) {
  if (description) {
    return description.replace(/\+/g, ' ');
  }

  if (error === 'access_denied') {
    return 'Sign-in was canceled before it finished.';
  }

  return 'We could not complete sign-in. Please try again.';
}

export function AuthCallbackPage({
  authConfig,
  authEnabled,
  onAuthSuccess,
  onNavigate,
}: {
  authConfig: CognitoConfig;
  authEnabled: boolean;
  onAuthSuccess: (session: AuthSession) => void;
  onNavigate: (path: string) => void;
}) {
  const [message, setMessage] = useState('Finishing sign-in...');
  const [error, setError] = useState<string | null>(null);
  const hasStartedRef = useRef(false);

  useEffect(() => {
    if (hasStartedRef.current) {
      return;
    }

    hasStartedRef.current = true;

    if (!authEnabled) {
      setError('Login is not configured for this environment yet.');
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const returnedError = params.get('error');
    const returnedDescription = params.get('error_description');
    const code = params.get('code');
    const state = decodeHostedUiState(params.get('state'));

    if (returnedError || returnedDescription) {
      setError(formatHostedUiError(returnedError, returnedDescription));
      return;
    }

    if (!code) {
      setError('We could not complete sign-in because the authorization code was missing.');
      return;
    }

    exchangeCodeForTokens(authConfig, code)
      .then((session) => {
        onAuthSuccess(session);
        redirectAfterAuth(session, onNavigate, state?.redirectTo ?? null);
      })
      .catch((exchangeError) => {
        setMessage('Sign-in did not finish.');
        setError(exchangeError instanceof Error ? exchangeError.message : 'Unable to complete sign-in.');
      });
  }, [authConfig, authEnabled, onAuthSuccess, onNavigate]);

  if (!error) {
    return (
      <section className="page-section" aria-live="polite">
        <p className="page-text">{message}</p>
      </section>
    );
  }

  return (
    <PageHero
      eyebrow="Sign in"
      title="Sign-in needs attention"
      body={error}
      actions={(
        <CtaButton
          href="/login"
          onClick={(event) => {
            event.preventDefault();
            onNavigate('/login');
          }}
          variant="secondary"
        >
          Back to login
        </CtaButton>
      )}
    />
  );
}
