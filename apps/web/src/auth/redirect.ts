import type { AuthSession } from './session';

export function readRedirectTargetFromSearch(search = window.location.search): string | null {
  return new URLSearchParams(search).get('redirect');
}

export function redirectAfterAuth(
  session: AuthSession,
  onNavigate: (path: string) => void,
  redirectTo = readRedirectTargetFromSearch(),
) {
  if (!redirectTo) {
    onNavigate('/');
    return;
  }

  try {
    const redirectOrigin = new URL(redirectTo, window.location.origin).origin;
    const isCrossOrigin = redirectOrigin !== window.location.origin;
    if (isCrossOrigin) {
      const payload = btoa(JSON.stringify({
        accessToken: session.accessToken,
        idToken: session.idToken,
        refreshToken: session.refreshToken,
        expiresAt: session.expiresAt,
      }));
      window.location.assign(`${redirectTo}#session=${payload}`);
    } else {
      window.location.assign(redirectTo);
    }
  } catch {
    onNavigate('/');
  }
}
