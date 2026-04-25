interface TransferredSession {
  accessToken: string;
  idToken: string;
  refreshToken: string | null;
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

export function consumeSessionFragment(clientId: string): boolean {
  if (typeof window === 'undefined') return false;

  const hash = window.location.hash;
  if (!hash.startsWith('#session=')) return false;

  window.history.replaceState(null, '', window.location.pathname + window.location.search);

  try {
    const session: TransferredSession = JSON.parse(atob(hash.slice('#session='.length)));
    const claims = decodeJwtPayload(session.idToken);
    const sub = typeof claims?.sub === 'string' ? claims.sub : '';
    if (!sub) return false;

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
