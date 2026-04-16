/**
 * Cross-origin session transfer for dev/staging environments.
 *
 * When the GRN app and the foundation web app run on different origins
 * (e.g. localhost:5173 vs localhost:5174), localStorage is not shared.
 * The web app login page encodes tokens into a URL fragment after login,
 * and this module reads them and writes them into Amplify's localStorage
 * format so that `getCurrentUser()` / `fetchAuthSession()` find a valid
 * session on the next check.
 *
 * In production both apps share a domain, so localStorage is shared and
 * this code is never triggered — the fragment is only appended for
 * cross-origin redirects.
 */

interface TransferredSession {
  accessToken: string;
  idToken: string;
  refreshToken: string | null;
  expiresAt: number;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Check for a `#session=<base64>` fragment, decode it, write the tokens
 * into Amplify's CognitoIdentityServiceProvider localStorage keys, and
 * strip the fragment from the URL.
 *
 * Returns `true` if tokens were written (caller should proceed with
 * Amplify auth check), `false` if no fragment was present.
 */
export function consumeSessionFragment(clientId: string): boolean {
  if (typeof window === 'undefined') return false;

  const hash = window.location.hash;
  if (!hash.startsWith('#session=')) return false;

  // Strip the fragment immediately so tokens don't linger in the URL.
  window.history.replaceState(null, '', window.location.pathname + window.location.search);

  try {
    const encoded = hash.slice('#session='.length);
    const session: TransferredSession = JSON.parse(atob(encoded));

    if (!session.accessToken || !session.idToken) return false;

    const claims = decodeJwtPayload(session.idToken);
    const sub = (claims?.sub as string) ?? '';
    if (!sub) return false;

    // Amplify v6 reads tokens from localStorage using this key pattern:
    //   CognitoIdentityServiceProvider.<clientId>.LastAuthUser
    //   CognitoIdentityServiceProvider.<clientId>.<username>.idToken
    //   CognitoIdentityServiceProvider.<clientId>.<username>.accessToken
    //   CognitoIdentityServiceProvider.<clientId>.<username>.refreshToken
    //   CognitoIdentityServiceProvider.<clientId>.<username>.clockDrift
    const prefix = `CognitoIdentityServiceProvider.${clientId}`;

    localStorage.setItem(`${prefix}.LastAuthUser`, sub);
    localStorage.setItem(`${prefix}.${sub}.idToken`, session.idToken);
    localStorage.setItem(`${prefix}.${sub}.accessToken`, session.accessToken);
    if (session.refreshToken) {
      localStorage.setItem(`${prefix}.${sub}.refreshToken`, session.refreshToken);
    }
    localStorage.setItem(`${prefix}.${sub}.clockDrift`, '0');

    return true;
  } catch {
    return false;
  }
}
