import {
  CognitoIdentityProviderClient,
  GetUserCommand
} from '@aws-sdk/client-cognito-identity-provider';
import { CognitoJwtVerifier } from 'aws-jwt-verify';

let accessVerifier;
let idVerifier;
let cognitoClient;

function getSharedPoolConfig() {
  const userPoolId = process.env.SHARED_USER_POOL_ID;
  const clientId = process.env.SHARED_USER_POOL_CLIENT_ID;

  if (!userPoolId || !clientId) {
    throw new Error('Cognito shared pool/client env vars are required');
  }

  return { userPoolId, clientId };
}

function getAccessVerifier() {
  if (accessVerifier) return accessVerifier;

  const { userPoolId, clientId } = getSharedPoolConfig();

  accessVerifier = CognitoJwtVerifier.create({
    userPoolId,
    tokenUse: 'access',
    clientId
  });

  return accessVerifier;
}

function getIdVerifier() {
  if (idVerifier) return idVerifier;

  const { userPoolId, clientId } = getSharedPoolConfig();

  idVerifier = CognitoJwtVerifier.create({
    userPoolId,
    tokenUse: 'id',
    clientId
  });

  return idVerifier;
}

function getCognitoClient() {
  if (cognitoClient) return cognitoClient;
  cognitoClient = new CognitoIdentityProviderClient();
  return cognitoClient;
}

function getBearerToken(headers = {}) {
  const auth = headers.authorization ?? headers.Authorization;
  if (!auth || typeof auth !== 'string') return null;
  if (!auth.toLowerCase().startsWith('bearer ')) return null;
  return auth.slice(7).trim();
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function attributesToObject(attributes = []) {
  return Object.fromEntries(
    attributes
      .filter((attribute) => attribute?.Name)
      .map((attribute) => [attribute.Name, attribute.Value ?? null])
  );
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

async function enrichAccessTokenContributor(token, payload) {
  const baseContributor = {
    sub: firstNonEmptyString(payload.sub),
    email: firstNonEmptyString(payload.email),
    name: firstNonEmptyString(payload.name, payload.given_name, payload.preferred_username, payload.username)
  };

  if (baseContributor.email || baseContributor.name) {
    return baseContributor;
  }

  try {
    const response = await getCognitoClient().send(
      new GetUserCommand({ AccessToken: token })
    );
    const attributes = attributesToObject(response.UserAttributes);

    return {
      sub: baseContributor.sub,
      email: firstNonEmptyString(attributes.email, baseContributor.email),
      name: firstNonEmptyString(
        attributes.name,
        attributes.given_name,
        attributes.preferred_username,
        attributes.email,
        baseContributor.name
      )
    };
  } catch {
    return baseContributor;
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
      contributor: await enrichAccessTokenContributor(token, payload)
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
