import type { AuthSession } from './session';

export interface AuthControlsProps {
  enabled: boolean;
  session: AuthSession | null;
  busy?: boolean;
  error?: string | null;
  onLogin: () => void;
  onSignup: () => void;
  onLogout: () => void;
}

export function AuthControls({
  enabled,
  session,
  busy = false,
  error = null,
  onLogin,
  onSignup,
  onLogout,
}: AuthControlsProps) {
  const displayName = session?.user.name ?? session?.user.email ?? 'Good Roots Network member';

  return (
    <div className="auth-controls" aria-live="polite">
      {enabled ? (
        session ? (
          <>
            <div className="auth-controls__summary">
              <span className="auth-controls__eyebrow">Signed in</span>
              <span className="auth-controls__name">{displayName}</span>
            </div>
            <button type="button" className="auth-controls__action auth-controls__action--secondary" onClick={onLogout}>
              Log out
            </button>
          </>
        ) : (
          <>
            <div className="auth-controls__summary">
              <span className="auth-controls__eyebrow">Optional login</span>
              <span className="auth-controls__name">Use one Good Roots Network account across experiences.</span>
            </div>
            <button type="button" className="auth-controls__action auth-controls__action--secondary" onClick={onLogin} disabled={busy}>
              Log in
            </button>
            <button type="button" className="auth-controls__action auth-controls__action--primary" onClick={onSignup} disabled={busy}>
              Sign up
            </button>
          </>
        )
      ) : (
        <div className="auth-controls__summary">
          <span className="auth-controls__eyebrow">Anonymous mode</span>
          <span className="auth-controls__name">Login will appear here once shared auth is configured.</span>
        </div>
      )}

      {error ? <p className="auth-controls__error" role="alert">{error}</p> : null}
    </div>
  );
}
