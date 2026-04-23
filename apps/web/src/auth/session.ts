export interface AuthUser {
  sub: string;
  email: string | null;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  tier: string | null;
  isAdmin: boolean;
}

export interface AuthSession {
  accessToken: string;
  idToken: string;
  refreshToken: string | null;
  expiresAt: number;
  user: AuthUser;
}

const SESSION_STORAGE_KEY = 'ogf.auth.session';

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;

  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const json = atob(padded);
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function firstString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function deriveTier(claims: Record<string, unknown> | null): string | null {
  if (!claims) return null;

  const groups = claims['cognito:groups'];
  if (Array.isArray(groups)) {
    if (groups.includes('pro-tier')) return 'pro';
    if (groups.includes('supporter-tier')) return 'supporter';
    if (groups.includes('free-tier')) return 'free';
  }

  return firstString(claims.tier);
}

function deriveIsAdmin(claims: Record<string, unknown> | null): boolean {
  if (!claims) return false;
  const groups = claims['cognito:groups'];
  return Array.isArray(groups) && groups.some((group) => String(group).toLowerCase() === 'admin');
}

export function buildAuthSession(tokens: {
  access_token: string;
  id_token: string;
  refresh_token?: string;
  expires_in: number;
}): AuthSession {
  const claims = decodeJwtPayload(tokens.id_token);
  const expiresAt = Date.now() + Math.max(tokens.expires_in - 60, 1) * 1000;

  return {
    accessToken: tokens.access_token,
    idToken: tokens.id_token,
    refreshToken: firstString(tokens.refresh_token),
    expiresAt,
    user: {
      sub: firstString(claims?.sub) ?? 'unknown',
      email: firstString(claims?.email),
      name: firstString(claims?.name) ?? firstString(claims?.given_name),
      firstName: firstString(claims?.given_name),
      lastName: firstString(claims?.family_name),
      tier: deriveTier(claims),
      isAdmin: deriveIsAdmin(claims),
    },
  };
}

export function readStoredSession(): AuthSession | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthSession;
    const claims = decodeJwtPayload(parsed.idToken);
    return {
      ...parsed,
      user: {
        ...parsed.user,
        firstName: parsed.user?.firstName ?? null,
        lastName: parsed.user?.lastName ?? null,
        isAdmin: parsed.user?.isAdmin ?? deriveIsAdmin(claims),
      },
    };
  } catch {
    return null;
  }
}

export function writeStoredSession(session: AuthSession) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function clearStoredSession() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(SESSION_STORAGE_KEY);
}
