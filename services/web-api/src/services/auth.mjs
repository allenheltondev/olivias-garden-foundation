import {
  CognitoIdentityProviderClient,
  GetUserCommand
} from '@aws-sdk/client-cognito-identity-provider';
import { CognitoJwtVerifier } from 'aws-jwt-verify';

let accessVerifier;
let idVerifier;
let cognitoClient;

function getSharedPoolConfig() {
  const userPoolId = process.env.OGF_USER_POOL_ID ?? process.env.SHARED_USER_POOL_ID;
  const clientId = process.env.OGF_USER_POOL_CLIENT_ID ?? process.env.SHARED_USER_POOL_CLIENT_ID;

  if (!userPoolId || !clientId) {
    throw new Error('OGF_USER_POOL_ID and OGF_USER_POOL_CLIENT_ID are required');
  }

  return { userPoolId, clientId };
}

function getBearerToken(headers = {}) {
  const auth = headers.authorization ?? headers.Authorization;
  if (!auth) {
    return null;
  }

  if (typeof auth !== 'string' || !auth.toLowerCase().startsWith('bearer ')) {
    throw new Error('Invalid authorization header format');
  }

  const token = auth.slice(7).trim();
  if (!token) {
    throw new Error('Authorization token is required');
  }

  return token;
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
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

function getAccessVerifier() {
  if (accessVerifier) {
    return accessVerifier;
  }

  const { userPoolId, clientId } = getSharedPoolConfig();
  accessVerifier = CognitoJwtVerifier.create({
    userPoolId,
    tokenUse: 'access',
    clientId
  });
  return accessVerifier;
}

function getIdVerifier() {
  if (idVerifier) {
    return idVerifier;
  }

  const { userPoolId, clientId } = getSharedPoolConfig();
  idVerifier = CognitoJwtVerifier.create({
    userPoolId,
    tokenUse: 'id',
    clientId
  });
  return idVerifier;
}

function getCognitoClient() {
  if (cognitoClient) {
    return cognitoClient;
  }

  cognitoClient = new CognitoIdentityProviderClient();
  return cognitoClient;
}

async function resolveTokenClaims(token) {
  try {
    const payload = await getIdVerifier().verify(token);
    return { payload, tokenUse: 'id' };
  } catch {
    const payload = await getAccessVerifier().verify(token);
    return { payload, tokenUse: 'access' };
  }
}

async function enrichAccessTokenContext(token, payload) {
  const base = {
    userId: firstNonEmptyString(payload.sub),
    email: firstNonEmptyString(payload.email),
    name: firstNonEmptyString(payload.name, payload.given_name, payload.preferred_username, payload.username)
  };

  if (base.email || base.name) {
    return base;
  }

  try {
    const response = await getCognitoClient().send(new GetUserCommand({ AccessToken: token }));
    const attributes = attributesToObject(response.UserAttributes);

    return {
      userId: base.userId,
      email: firstNonEmptyString(attributes.email, base.email),
      name: firstNonEmptyString(
        attributes.name,
        attributes.given_name,
        attributes.preferred_username,
        attributes.email,
        base.name
      )
    };
  } catch {
    return base;
  }
}

export async function resolveOptionalAuthContext(event) {
  const token = getBearerToken(event?.headers ?? {});
  if (!token) {
    return null;
  }

  try {
    const { payload, tokenUse } = await resolveTokenClaims(token);

    if (tokenUse === 'id') {
      return {
        userId: firstNonEmptyString(payload.sub),
        email: firstNonEmptyString(payload.email),
        name: firstNonEmptyString(payload.name, payload.given_name, payload.preferred_username, payload.email)
      };
    }

    return await enrichAccessTokenContext(token, payload);
  } catch {
    throw new Error('Invalid access token');
  }
}
