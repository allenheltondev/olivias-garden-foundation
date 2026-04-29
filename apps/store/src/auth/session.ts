import { fetchAuthSession, getCurrentUser } from 'aws-amplify/auth';

export interface StoreSession {
  accessToken: string;
  email: string | null;
  displayName: string | null;
  isAdmin: boolean;
}

async function readSessionTokens() {
  const session = await fetchAuthSession();
  return {
    accessToken: session.tokens?.accessToken?.toString(),
    accessPayload: (session.tokens?.accessToken?.payload ?? {}) as Record<string, unknown>,
    idPayload: (session.tokens?.idToken?.payload ?? {}) as Record<string, unknown>,
  };
}

export async function loadStoreSession(): Promise<StoreSession | null> {
  try {
    await getCurrentUser();
    const tokens = await readSessionTokens();

    if (!tokens.accessToken) {
      return null;
    }

    const accessPayload = tokens.accessPayload;
    const email =
      typeof accessPayload.email === 'string'
        ? accessPayload.email
        : typeof tokens.idPayload.email === 'string'
          ? (tokens.idPayload.email as string)
          : typeof accessPayload.username === 'string'
            ? (accessPayload.username as string)
            : null;

    const displayName =
      typeof tokens.idPayload.name === 'string'
        ? (tokens.idPayload.name as string)
        : typeof accessPayload.name === 'string'
          ? (accessPayload.name as string)
          : null;

    const groups = accessPayload['cognito:groups'];
    const isAdmin = Array.isArray(groups) && groups.includes('Admin');

    return {
      accessToken: tokens.accessToken,
      email,
      displayName,
      isAdmin,
    };
  } catch {
    return null;
  }
}
