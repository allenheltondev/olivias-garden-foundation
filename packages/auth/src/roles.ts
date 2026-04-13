export type AppRole = 'admin' | 'contributor' | 'user';

export interface ClaimsLike {
  role?: unknown;
  roles?: unknown;
  'custom:role'?: unknown;
  'cognito:groups'?: unknown;
}

const VALID_ROLES: AppRole[] = ['admin', 'contributor', 'user'];

export function normalizeRole(value: unknown): AppRole {
  if (typeof value !== 'string') {
    return 'user';
  }

  const normalized = value.trim().toLowerCase();
  return VALID_ROLES.includes(normalized as AppRole) ? (normalized as AppRole) : 'user';
}

export function readRoleFromClaims(claims: ClaimsLike): AppRole {
  if (Array.isArray(claims.roles) && claims.roles.length > 0) {
    return normalizeRole(claims.roles[0]);
  }

  if (Array.isArray(claims['cognito:groups']) && claims['cognito:groups'].length > 0) {
    return normalizeRole(claims['cognito:groups'][0]);
  }

  if (typeof claims.role === 'string') {
    return normalizeRole(claims.role);
  }

  if (typeof claims['custom:role'] === 'string') {
    return normalizeRole(claims['custom:role']);
  }

  return 'user';
}

export function hasRole(claims: ClaimsLike, expectedRole: AppRole): boolean {
  return readRoleFromClaims(claims) === expectedRole;
}

export function isAdmin(claims: ClaimsLike): boolean {
  return hasRole(claims, 'admin');
}
