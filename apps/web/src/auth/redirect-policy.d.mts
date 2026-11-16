// Types for redirect-policy.mjs. Keep in sync with that file.

export type AuthMode = 'login' | 'signup';

export function resolveAuthRedirect(
  redirectTo: unknown,
  options: { currentOrigin: string; trustedOrigins?: string[] },
): { url: string; crossOrigin: boolean } | null;

export function readAuthMode(search: string): AuthMode | null;

export function buildLoginPath(options?: { mode?: AuthMode; redirect?: string }): string;
