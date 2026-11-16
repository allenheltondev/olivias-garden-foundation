// Pure rules for where /login may send someone after they sign in.
//
// A cross-origin redirect carries the user's tokens in the URL fragment, so
// the target must be the exact origin of one of our apps that consumes that
// fragment (planner, admin, store). Anything else, including other
// subdomains of our own domain, a javascript: URL, or a protocol-relative
// //host path, falls back to home.
// Kept as plain .mjs so `node --test` can exercise it without a TS build.

const AUTH_MODES = new Set(['login', 'signup']);

function originOf(value) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * @param {unknown} redirectTo raw `redirect` value from the query string or OAuth state
 * @param {{ currentOrigin: string, trustedOrigins?: string[] }} options
 * @returns {{ url: string, crossOrigin: boolean } | null}
 */
export function resolveAuthRedirect(redirectTo, { currentOrigin, trustedOrigins = [] }) {
  if (typeof redirectTo !== 'string' || redirectTo.trim() === '') return null;

  let current;
  let target;
  try {
    current = new URL(currentOrigin);
    target = new URL(redirectTo.trim(), current.origin);
  } catch {
    return null;
  }

  if (target.protocol !== 'https:' && target.protocol !== 'http:') return null;
  if (target.username || target.password) return null;

  if (target.origin === current.origin) {
    return { url: target.href, crossOrigin: false };
  }

  const trusted = new Set(trustedOrigins.map(originOf).filter(Boolean));
  if (trusted.has(target.origin)) {
    return { url: target.href, crossOrigin: true };
  }

  return null;
}

/** `?mode=signup` opens the Sign up tab; anything else is ignored. */
export function readAuthMode(search) {
  const mode = new URLSearchParams(search).get('mode');
  return mode && AUTH_MODES.has(mode) ? mode : null;
}

/** Builds `/login?mode=…&redirect=…` for CTAs that send people through auth. */
export function buildLoginPath({ mode, redirect } = {}) {
  const params = new URLSearchParams();
  if (mode && AUTH_MODES.has(mode)) params.set('mode', mode);
  if (redirect) params.set('redirect', redirect);
  const query = params.toString();
  return query ? `/login?${query}` : '/login';
}
