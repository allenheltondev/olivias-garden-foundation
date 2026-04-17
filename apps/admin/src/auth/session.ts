import { fetchAuthSession, getCurrentUser } from 'aws-amplify/auth';
import { readRoleFromClaims } from '@olivias/auth';

export interface AdminSession {
  accessToken: string;
  email: string | null;
  isAdmin: boolean;
}

export async function loadAdminSession(): Promise<AdminSession | null> {
  try {
    await getCurrentUser();
    const session = await fetchAuthSession();
    const accessToken = session.tokens?.accessToken?.toString();
    const payload = (session.tokens?.accessToken?.payload ?? {}) as Record<string, unknown>;

    if (!accessToken) {
      return null;
    }

    const groups = Array.isArray(payload['cognito:groups']) ? payload['cognito:groups'] : [];
    const email =
      typeof payload.email === 'string'
        ? payload.email
        : typeof payload.username === 'string'
          ? payload.username
          : null;

    return {
      accessToken,
      email,
      isAdmin:
        readRoleFromClaims({ 'cognito:groups': groups }) === 'admin' ||
        groups.some((group) => String(group).toLowerCase() === 'admin'),
    };
  } catch {
    return null;
  }
}
