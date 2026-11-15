import { CognitoJwtVerifier } from 'aws-jwt-verify';

let accessVerifier;

function getAccessVerifier() {
  if (accessVerifier) return accessVerifier;

  const userPoolId = process.env.OGF_USER_POOL_ID;
  const clientId = process.env.OGF_USER_POOL_CLIENT_ID;

  if (!userPoolId || !clientId) {
    throw new Error('OGF_USER_POOL_ID and OGF_USER_POOL_CLIENT_ID are required');
  }

  accessVerifier = CognitoJwtVerifier.create({
    userPoolId,
    clientId,
    tokenUse: 'access'
  });
  return accessVerifier;
}

function getBearerToken(headers = {}) {
  const raw = headers.authorization ?? headers.Authorization;
  if (!raw) return null;
  if (typeof raw !== 'string' || !raw.toLowerCase().startsWith('bearer ')) {
    throw new Error('Invalid authorization header format');
  }
  const token = raw.slice(7).trim();
  if (!token) {
    throw new Error('Authorization token is required');
  }
  return token;
}

function readGroups(claims) {
  const groups = claims?.['cognito:groups'];
  return Array.isArray(groups) ? groups : [];
}

function isAdminFromClaims(claims) {
  return readGroups(claims).some(
    (group) => typeof group === 'string' && group.toLowerCase() === 'admin'
  );
}

// The identity an upstream authorizer already established, or null.
//
// The store API has no API Gateway authorizer, so a request through API
// Gateway never carries `requestContext.authorizer`: API Gateway writes that
// field itself and a client cannot set it. It is present only when an IAM
// principal invokes this function directly with an event that carries it —
// the operator MCP server (services/mcp-api), which has verified its own key
// and the operator's admin group first — exactly as admin-api, okra-api and
// grn-api read the context their authorizers attach.
function authorizerContext(event) {
  const authorizer = event?.requestContext?.authorizer;
  const userId = authorizer?.userId;
  if (typeof userId !== 'string' || userId.length === 0) return null;
  return {
    userId,
    email: typeof authorizer.email === 'string' && authorizer.email.length > 0 ? authorizer.email : null,
    isAdmin: String(authorizer.isAdmin ?? '').toLowerCase() === 'true'
  };
}

// Resolve auth context from the request's bearer token. Returns null when
// no token is present (anonymous requests on public routes). Throws when a
// token is present but invalid — handlers map that to a 401.
export async function resolveOptionalAuthContext(event, options = {}) {
  const upstream = authorizerContext(event);
  if (upstream) return upstream;

  const token = getBearerToken(event?.headers ?? {});
  if (!token) return null;

  const verify = options.verifyJwt ?? ((jwt) => getAccessVerifier().verify(jwt));

  let claims;
  try {
    claims = await verify(token);
  } catch {
    throw new Error('Invalid access token');
  }

  return {
    userId: typeof claims.sub === 'string' && claims.sub.length > 0 ? claims.sub : null,
    email: typeof claims.email === 'string' && claims.email.length > 0 ? claims.email : null,
    isAdmin: isAdminFromClaims(claims)
  };
}

export async function requireUserContext(event, options = {}) {
  const ctx = await resolveOptionalAuthContext(event, options);
  if (!ctx?.userId) {
    throw new Error('Authentication required');
  }
  return ctx;
}

export async function requireAdminContext(event, options = {}) {
  const ctx = await requireUserContext(event, options);
  if (!ctx.isAdmin) {
    throw new Error('Forbidden: This feature is only available to administrators');
  }
  return ctx;
}
