import { Logger } from '@aws-lambda-powertools/logger';
import { CognitoJwtVerifier } from 'aws-jwt-verify';

const verifierCache = new Map();
const logger = new Logger({ serviceName: 'admin-authorizer' });

export function getApiArnPattern(methodArn = '') {
  const [part1, part2] = methodArn.split('/');
  return part1 && part2 ? `${part1}/${part2}/*/*` : methodArn;
}

export function generatePolicy(principalId, effect, resource, context) {
  return {
    principalId,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'execute-api:Invoke',
          Effect: effect,
          Resource: resource
        }
      ]
    },
    ...(effect === 'Allow' && context ? { context } : {})
  };
}

export function isPublicRoute(event) {
  return (
    event?.httpMethod === 'GET' &&
    (event?.path === '/api/store/products' || event?.path === '/store/products')
  );
}

function getAuthorizationHeader(headers = {}) {
  return headers.authorization ?? headers.Authorization ?? null;
}

function getVerifier(userPoolId, userPoolClientId) {
  const cacheKey = `${userPoolId}:${userPoolClientId}`;

  if (!verifierCache.has(cacheKey)) {
    verifierCache.set(
      cacheKey,
      CognitoJwtVerifier.create({
        userPoolId,
        clientId: userPoolClientId,
        tokenUse: 'access'
      })
    );
  }

  return verifierCache.get(cacheKey);
}

export async function verifyAdminToken(
  token,
  { userPoolId, userPoolClientId, verifyJwt = undefined }
) {
  const jwtVerifier =
    verifyJwt ??
    ((jwt) => getVerifier(userPoolId, userPoolClientId).verify(jwt));

  const claims = await jwtVerifier(token);
  const groups = Array.isArray(claims['cognito:groups'])
    ? claims['cognito:groups']
    : [];

  if (!groups.some((group) => typeof group === 'string' && group.toLowerCase() === 'admin')) {
    throw new Error('Missing admin group');
  }

  if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
    throw new Error('Missing sub claim');
  }

  return claims;
}

export function createHandler({
  userPoolId = process.env.USER_POOL_ID,
  userPoolClientId = process.env.USER_POOL_CLIENT_ID,
  verifyJwt = undefined
} = {}) {
  return async function handler(event) {
    const apiArn = getApiArnPattern(event?.methodArn ?? '');

    if (event?.httpMethod === 'OPTIONS' || isPublicRoute(event)) {
      return generatePolicy('anonymous', 'Allow', apiArn);
    }

    try {
      if (!userPoolId || !userPoolClientId) {
        throw new Error('Authorizer is missing Cognito configuration');
      }

      const authHeader = getAuthorizationHeader(event?.headers);

      if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
        throw new Error('Invalid authorization header format');
      }

      const token = authHeader.slice('Bearer '.length).trim();
      const claims = await verifyAdminToken(token, {
        userPoolId,
        userPoolClientId,
        verifyJwt
      });

      return generatePolicy(claims.sub, 'Allow', apiArn, {
        userId: claims.sub,
        isAdmin: 'true'
      });
    } catch (error) {
      logger.warn('Authorization failed', {
        error: error instanceof Error ? error.message : String(error),
        path: event?.path,
        method: event?.httpMethod
      });
      return generatePolicy('anonymous', 'Deny', apiArn);
    }
  };
}

export const handler = createHandler();
