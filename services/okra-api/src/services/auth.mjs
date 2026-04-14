import { CognitoJwtVerifier } from 'aws-jwt-verify';

let verifier;

function getVerifier() {
  if (verifier) return verifier;

  const userPoolId = process.env.SHARED_USER_POOL_ID;
  const clientId = process.env.SHARED_USER_POOL_CLIENT_ID;

  if (!userPoolId || !clientId) {
    throw new Error('Cognito shared pool/client env vars are required');
  }

  verifier = CognitoJwtVerifier.create({
    userPoolId,
    tokenUse: 'access',
    clientId
  });

  return verifier;
}

function getBearerToken(headers = {}) {
  const auth = headers.authorization ?? headers.Authorization;
  if (!auth || typeof auth !== 'string') return null;
  if (!auth.toLowerCase().startsWith('bearer ')) return null;
  return auth.slice(7).trim();
}

export async function requireAdminAccess(event) {
  const token = getBearerToken(event?.headers);

  if (process.env.NODE_ENV === 'test' && event?.headers?.['x-test-admin'] === 'true') {
    return { ok: true, payload: { sub: 'test-admin', 'cognito:groups': ['admin'] } };
  }

  if (!token) {
    return { ok: false, statusCode: 401, body: { error: 'Unauthorized', message: 'Missing bearer token' } };
  }

  try {
    const payload = await getVerifier().verify(token);
    const requiredGroup = process.env.ADMIN_REQUIRED_GROUP ?? 'admin';
    const groups = payload['cognito:groups'] ?? [];
    const hasGroup = Array.isArray(groups) && groups.includes(requiredGroup);

    if (!hasGroup) {
      return {
        ok: false,
        statusCode: 403,
        body: { error: 'Forbidden', message: `Requires ${requiredGroup} group` }
      };
    }

    return { ok: true, payload };
  } catch {
    return { ok: false, statusCode: 401, body: { error: 'Unauthorized', message: 'Invalid token' } };
  }
}
