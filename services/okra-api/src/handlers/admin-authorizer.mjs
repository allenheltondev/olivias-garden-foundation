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

function generatePolicy(principalId, effect, resource, context = {}) {
  // Wildcard the resource so the cached policy covers all methods/paths on this API stage.
  // methodArn format: arn:aws:execute-api:{region}:{accountId}:{apiId}/{stage}/{method}/{resource}
  const arnParts = resource.split(':');
  const apiGatewayPart = arnParts[5]; // e.g. {apiId}/{stage}/GET/submissions
  const [apiId, stage] = apiGatewayPart.split('/');
  const wildcardArn = arnParts.slice(0, 5).join(':') + ':' + apiId + '/' + stage + '/*';

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

export const handler = async (event) => {
  const token = event.authorizationToken?.replace(/^Bearer\s+/i, '');

  if (!token) {
    throw new Error('Unauthorized');
  }

  try {
    const payload = await getVerifier().verify(token);

    const requiredGroup = process.env.ADMIN_REQUIRED_GROUP ?? 'admin';
    const groups = payload['cognito:groups'] ?? [];
    const hasGroup = Array.isArray(groups) && groups.includes(requiredGroup);

    if (!hasGroup) {
      throw new Error('Unauthorized');
    }

    // REST API authorizer context values must be strings, numbers, or booleans
    return generatePolicy(payload.sub, 'Allow', event.methodArn, {
      sub: payload.sub,
      groups: JSON.stringify(groups),
      email: payload.email ?? ''
    });
  } catch {
    throw new Error('Unauthorized');
  }
};

