import { Logger } from '@aws-lambda-powertools/logger';
import { CognitoJwtVerifier } from 'aws-jwt-verify';

const verifierCache = new Map();
const logger = new Logger({ serviceName: 'admin-authorizer', logLevel: 'DEBUG' });

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
    logger.info('Creating Cognito JWT verifier', { userPoolId, userPoolClientId });
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

  logger.debug('Verifying JWT');
  const claims = await jwtVerifier(token);
  logger.debug('JWT verified', { sub: claims?.sub, groups: claims?.['cognito:groups'] });

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
    const method = event?.httpMethod;
    const path = event?.path;
    const methodArn = event?.methodArn;
    const hasAuthHeader = Boolean(getAuthorizationHeader(event?.headers));

    logger.info('Authorizer invoked', {
      method,
      path,
      methodArn,
      hasAuthHeader,
      userPoolConfigured: Boolean(userPoolId),
      clientConfigured: Boolean(userPoolClientId)
    });

    const apiArn = getApiArnPattern(methodArn ?? '');

    if (method === 'OPTIONS' || isPublicRoute(event)) {
      logger.info('Bypassing auth for public route', { method, path });
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

      logger.info('Authorization allowed', { sub: claims.sub, path, method });
      return generatePolicy(claims.sub, 'Allow', apiArn, {
        userId: claims.sub,
        isAdmin: 'true'
      });
    } catch (error) {
      logger.error('Authorization failed', {
        error: error instanceof Error ? error.message : String(error),
        errorName: error instanceof Error ? error.name : 'UnknownError',
        stack: error instanceof Error ? error.stack : undefined,
        path,
        method
      });
      return generatePolicy('anonymous', 'Deny', apiArn);
    }
  };
}

export const handler = createHandler();
