import { Logger } from '@aws-lambda-powertools/logger';
import { CognitoJwtVerifier } from 'aws-jwt-verify';

const verifierCache = new Map();
const logger = new Logger({ serviceName: 'store-authorizer', logLevel: 'DEBUG' });

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

export function normalizePath(path = '') {
  if (path === '/api') return '/';
  if (path.startsWith('/api/')) return path.slice(4);
  return path;
}

const PUBLIC_GET_PREFIXES = ['/products', '/orders/by-session/'];
const PUBLIC_POST_PATHS = ['/checkout', '/webhook'];

export function isAnonymousRoute(method, path) {
  const normalized = normalizePath(path);
  if (method === 'OPTIONS') return true;
  if (method === 'GET') {
    return PUBLIC_GET_PREFIXES.some((prefix) => {
      if (normalized === prefix) return true;
      const separator = prefix.endsWith('/') ? '' : '/';
      return normalized.startsWith(prefix + separator);
    });
  }
  if (method === 'POST') {
    return PUBLIC_POST_PATHS.includes(normalized);
  }
  return false;
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

    const apiArn = getApiArnPattern(methodArn ?? '');
    const authHeader = getAuthorizationHeader(event?.headers);

    logger.info('Authorizer invoked', {
      method,
      path,
      hasAuthHeader: Boolean(authHeader)
    });

    const anonymousAllowed = isAnonymousRoute(method, path);

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      if (anonymousAllowed) {
        return generatePolicy('anonymous', 'Allow', apiArn, {
          userId: 'anonymous',
          isAdmin: 'false'
        });
      }
      return generatePolicy('anonymous', 'Deny', apiArn);
    }

    try {
      if (!userPoolId || !userPoolClientId) {
        throw new Error('Authorizer is missing Cognito configuration');
      }

      const token = authHeader.slice('Bearer '.length).trim();
      const jwtVerifier =
        verifyJwt ??
        ((jwt) => getVerifier(userPoolId, userPoolClientId).verify(jwt));

      const claims = await jwtVerifier(token);

      const groups = Array.isArray(claims['cognito:groups'])
        ? claims['cognito:groups']
        : [];
      const isAdmin = groups.some(
        (group) => typeof group === 'string' && group.toLowerCase() === 'admin'
      );

      const sub = typeof claims.sub === 'string' ? claims.sub : '';
      if (!sub) throw new Error('Missing sub claim');

      return generatePolicy(sub, 'Allow', apiArn, {
        userId: sub,
        isAdmin: isAdmin ? 'true' : 'false',
        email: typeof claims.email === 'string' ? claims.email : ''
      });
    } catch (error) {
      logger.error('Authorization failed', {
        error: error instanceof Error ? error.message : String(error),
        path,
        method
      });

      if (anonymousAllowed) {
        return generatePolicy('anonymous', 'Allow', apiArn, {
          userId: 'anonymous',
          isAdmin: 'false'
        });
      }

      return generatePolicy('anonymous', 'Deny', apiArn);
    }
  };
}

export const handler = createHandler();
