import { trackEvent } from '../observability/analytics';
import { adminUrl, goodRootsNetworkUrl } from '../site/routes';
import { buildLoginPath, readAuthMode, resolveAuthRedirect, type AuthMode } from './redirect-policy.mjs';
import type { AuthSession } from './session';

export function readRedirectTargetFromSearch(search = window.location.search): string | null {
  return new URLSearchParams(search).get('redirect');
}

export function readAuthModeFromSearch(search = window.location.search): AuthMode | null {
  return readAuthMode(search);
}

function trustedAppOrigins() {
  return [goodRootsNetworkUrl, adminUrl];
}

function resolveRedirect(redirectTo: string | null) {
  return resolveAuthRedirect(redirectTo, {
    currentOrigin: window.location.origin,
    trustedOrigins: trustedAppOrigins(),
  });
}

function isPlannerUrl(url: string) {
  try {
    return new URL(url).origin === new URL(goodRootsNetworkUrl).origin;
  } catch {
    return false;
  }
}

/**
 * Where a visitor will land after auth, for analytics only. Never includes
 * the URL itself.
 */
export function authDestination(redirectTo = readRedirectTargetFromSearch()): 'planner' | 'site' | 'other_app' {
  const resolved = resolveRedirect(redirectTo);
  if (!resolved) return 'site';
  if (isPlannerUrl(resolved.url)) return 'planner';
  return resolved.crossOrigin ? 'other_app' : 'site';
}

/** Login path that opens Sign up and drops the new account into the planner. */
export function plannerSignupPath() {
  return buildLoginPath({ mode: 'signup', redirect: goodRootsNetworkUrl });
}

export function redirectAfterAuth(
  session: AuthSession,
  onNavigate: (path: string) => void,
  redirectTo = readRedirectTargetFromSearch(),
) {
  const resolved = resolveRedirect(redirectTo);
  if (!resolved) {
    onNavigate('/');
    return;
  }

  if (isPlannerUrl(resolved.url)) {
    trackEvent('planner_opened', { via: 'auth' });
  }

  if (!resolved.crossOrigin) {
    window.location.assign(resolved.url);
    return;
  }

  const payload = btoa(JSON.stringify({
    accessToken: session.accessToken,
    idToken: session.idToken,
    refreshToken: session.refreshToken,
    expiresAt: session.expiresAt,
  }));
  const target = new URL(resolved.url);
  target.hash = `session=${payload}`;
  window.location.assign(target.href);
}
