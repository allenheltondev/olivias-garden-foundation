import {
  fetchContributorProfileFromAccessToken,
  getAccessVerifier,
  getBearerToken,
  getCognitoGroups,
  getIdVerifier,
  getRequiredAdminGroup,
  hasRequiredAdminGroup
} from './cognito-auth.mjs';

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

async function resolveContributorClaims(token) {
  try {
    const payload = await getIdVerifier().verify(token);
    return { payload, tokenUse: 'id' };
  } catch {
    const payload = await getAccessVerifier().verify(token);
    return { payload, tokenUse: 'access' };
  }
}

export async function resolveOptionalContributor(event) {
  const token = getBearerToken(event?.headers);

  if (!token) {
    return { ok: true, contributor: null };
  }

  try {
    const { payload, tokenUse } = await resolveContributorClaims(token);

    if (tokenUse === 'id') {
      return {
        ok: true,
        contributor: {
          sub: firstNonEmptyString(payload.sub),
          email: firstNonEmptyString(payload.email),
          name: firstNonEmptyString(payload.name, payload.given_name, payload.preferred_username, payload.email)
        }
      };
    }

    return {
      ok: true,
      contributor: await fetchContributorProfileFromAccessToken(token, payload)
    };
  } catch {
    return {
      ok: false,
      statusCode: 401,
      body: { error: 'Unauthorized', message: 'Invalid bearer token' }
    };
  }
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
    const payload = await getAccessVerifier().verify(token);

    if (!hasRequiredAdminGroup(payload)) {
      return {
        ok: false,
        statusCode: 403,
        body: {
          error: 'Forbidden',
          message: `Requires ${getRequiredAdminGroup()} group`
        }
      };
    }

    return {
      ok: true,
      payload: {
        ...payload,
        'cognito:groups': getCognitoGroups(payload)
      }
    };
  } catch {
    return { ok: false, statusCode: 401, body: { error: 'Unauthorized', message: 'Invalid token' } };
  }
}
