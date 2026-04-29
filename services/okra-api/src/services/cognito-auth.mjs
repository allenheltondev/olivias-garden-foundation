import {
  CognitoIdentityProviderClient,
  GetUserCommand
} from '@aws-sdk/client-cognito-identity-provider';
import { CognitoJwtVerifier } from 'aws-jwt-verify';

let accessVerifier;
let idVerifier;
let cognitoClient;

export function getSharedPoolConfig() {
  const userPoolId = process.env.SHARED_USER_POOL_ID;
  const clientId = process.env.SHARED_USER_POOL_CLIENT_ID;

  if (!userPoolId || !clientId) {
    throw new Error('Cognito shared pool/client env vars are required');
  }

  return { userPoolId, clientId };
}

export function getAccessVerifier() {
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

export function getIdVerifier() {
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

export function getCognitoClient() {
  if (cognitoClient) {
    return cognitoClient;
  }

  cognitoClient = new CognitoIdentityProviderClient();
  return cognitoClient;
}

export function stripBearerToken(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }

  if (!value.toLowerCase().startsWith('bearer ')) {
    return null;
  }

  return value.slice(7).trim();
}

export function getBearerToken(headers = {}) {
  return stripBearerToken(headers.authorization ?? headers.Authorization);
}

export function getRequiredAdminGroup() {
  return process.env.ADMIN_REQUIRED_GROUP ?? 'admin';
}

export function getCognitoGroups(payload = {}) {
  const groups = payload['cognito:groups'] ?? [];
  return Array.isArray(groups) ? groups : [];
}

export function hasRequiredAdminGroup(payload, requiredGroup = getRequiredAdminGroup()) {
  return getCognitoGroups(payload).includes(requiredGroup);
}

export function generateAuthorizerPolicy(principalId, effect, methodArn, context = {}) {
  const arnParts = methodArn.split(':');
  const apiGatewayPart = arnParts[5];
  const [apiId, stage] = apiGatewayPart.split('/');
  const wildcardArn = `${arnParts.slice(0, 5).join(':')}:${apiId}/${stage}/*`;

  return {
    principalId,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'execute-api:Invoke',
          Effect: effect,
          Resource: wildcardArn
        }
      ]
    },
    context
  };
}

export function authorizerContextFromPayload(payload) {
  return {
    sub: payload.sub,
    groups: JSON.stringify(getCognitoGroups(payload)),
    email: payload.email ?? ''
  };
}

export async function fetchContributorProfileFromAccessToken(token, payload) {
  const baseContributor = {
    sub: firstNonEmptyString(payload.sub),
    email: firstNonEmptyString(payload.email),
    name: firstNonEmptyString(
      payload.name,
      payload.given_name,
      payload.preferred_username,
      usernameAsDisplayName(payload.username)
    )
  };

  if (baseContributor.email && baseContributor.name) {
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

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

// Cognito synthesizes usernames like `google_<sub>` or `facebook_<sub>` for
// federated users. Those are opaque identifiers, not display names.
const FEDERATED_USERNAME_PATTERN = /^(google|facebook|signinwithapple|apple|loginwithamazon|amazon|oidc)_/i;

function usernameAsDisplayName(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || FEDERATED_USERNAME_PATTERN.test(trimmed)) return null;
  return trimmed;
}

function attributesToObject(attributes = []) {
  return Object.fromEntries(
    attributes
      .filter((attribute) => attribute?.Name)
      .map((attribute) => [attribute.Name, attribute.Value ?? null])
  );
}
