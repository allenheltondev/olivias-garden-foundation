import { fetchAuthSession, getCurrentUser } from 'aws-amplify/auth';
import { readRoleFromClaims } from '@olivias/auth';

export interface AdminSession {
  accessToken: string;
  email: string | null;
  displayName: string | null;
  isAdmin: boolean;
}

function collectGroups(payload: Record<string, unknown>): unknown[] {
  const raw = payload['cognito:groups'];
  return Array.isArray(raw) ? raw : [];
}

function hasAdminGroup(groups: unknown[]): boolean {
  return groups.some((group) => String(group).toLowerCase() === 'admin');
}

async function readSessionTokens(forceRefresh: boolean) {
  const session = await fetchAuthSession(forceRefresh ? { forceRefresh: true } : undefined);
  return {
    accessToken: session.tokens?.accessToken?.toString(),
    accessPayload: (session.tokens?.accessToken?.payload ?? {}) as Record<string, unknown>,
    idPayload: (session.tokens?.idToken?.payload ?? {}) as Record<string, unknown>,
  };
}

export async function loadAdminSession(): Promise<AdminSession | null> {
  try {
    await getCurrentUser();
    let tokens = await readSessionTokens(false);

    if (!tokens.accessToken) {
      return null;
    }

    let groups = [...collectGroups(tokens.accessPayload), ...collectGroups(tokens.idPayload)];

    // If the token was minted before the user was added to the admin group,
    // retry once with a forced refresh so recent role changes take effect.
    if (!hasAdminGroup(groups)) {
      try {
        tokens = await readSessionTokens(true);
        if (tokens.accessToken) {
          groups = [...collectGroups(tokens.accessPayload), ...collectGroups(tokens.idPayload)];
        }
      } catch {
        // fall through with the original token state
      }
    }

    const payload = tokens.accessPayload;
    const email =
      typeof payload.email === 'string'
        ? payload.email
        : typeof payload.username === 'string'
          ? payload.username
          : typeof tokens.idPayload.email === 'string'
            ? (tokens.idPayload.email as string)
            : null;
    const displayName =
      typeof tokens.idPayload.name === 'string'
        ? (tokens.idPayload.name as string)
        : typeof payload.name === 'string'
          ? (payload.name as string)
          : typeof tokens.idPayload.given_name === 'string' || typeof tokens.idPayload.family_name === 'string'
            ? [tokens.idPayload.given_name, tokens.idPayload.family_name].filter((part): part is string => typeof part === 'string' && part.trim().length > 0).join(' ')
            : null;

    return {
      accessToken: tokens.accessToken!,
      email,
      displayName,
      isAdmin:
        readRoleFromClaims({ 'cognito:groups': groups }) === 'admin' || hasAdminGroup(groups),
    };
  } catch {
    return null;
  }
}
