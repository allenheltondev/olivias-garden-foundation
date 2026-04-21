import {
  authorizerContextFromPayload,
  generateAuthorizerPolicy,
  getAccessVerifier,
  getRequiredAdminGroup,
  hasRequiredAdminGroup,
  stripBearerToken
} from '../services/cognito-auth.mjs';

export const handler = async (event) => {
  const token = stripBearerToken(event.authorizationToken);

  if (!token) {
    throw new Error('Unauthorized');
  }

  try {
    const payload = await getAccessVerifier().verify(token);

    if (!hasRequiredAdminGroup(payload, getRequiredAdminGroup())) {
      throw new Error('Unauthorized');
    }

    return generateAuthorizerPolicy(payload.sub, 'Allow', event.methodArn, authorizerContextFromPayload(payload));
  } catch {
    throw new Error('Unauthorized');
  }
};
