import assert from 'node:assert/strict';
import {
  createHandler,
  generatePolicy,
  getApiArnPattern,
  isPublicRoute,
  verifyAdminToken
} from '../src/auth/authorizer.mjs';

function buildEvent(overrides = {}) {
  return {
    httpMethod: 'GET',
    path: '/admin/store/products',
    methodArn:
      'arn:aws:execute-api:us-east-1:123456789012:restApiId/api/GET/admin/store/products',
    headers: {},
    ...overrides
  };
}

async function run() {
  assert.equal(
    getApiArnPattern(
      'arn:aws:execute-api:us-east-1:123456789012:restApiId/api/GET/admin/store/products'
    ),
    'arn:aws:execute-api:us-east-1:123456789012:restApiId/api/*/*'
  );

  assert.equal(isPublicRoute(buildEvent({ path: '/store/products' })), true);
  assert.equal(isPublicRoute(buildEvent()), false);

  assert.deepEqual(
    generatePolicy('user-123', 'Allow', 'arn:example', {
      userId: 'user-123',
      isAdmin: 'true'
    }),
    {
      principalId: 'user-123',
      policyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Action: 'execute-api:Invoke',
            Effect: 'Allow',
            Resource: 'arn:example'
          }
        ]
      },
      context: {
        userId: 'user-123',
        isAdmin: 'true'
      }
    }
  );

  await assert.rejects(
    () =>
      verifyAdminToken('token', {
        userPoolId: 'us-east-1_pool',
        userPoolClientId: 'client-id',
        verifyJwt: async () => ({ sub: 'user-123', 'cognito:groups': ['staff'] })
      }),
    /Missing admin group/
  );

  const publicHandler = createHandler();
  const publicResponse = await publicHandler(buildEvent({ path: '/store/products' }));
  assert.equal(publicResponse.policyDocument.Statement[0].Effect, 'Allow');
  assert.equal(publicResponse.principalId, 'anonymous');

  const adminHandler = createHandler({
    userPoolId: 'us-east-1_pool',
    userPoolClientId: 'client-id',
    verifyJwt: async () => ({
      sub: 'user-123',
      'cognito:groups': ['Admin']
    })
  });
  const allowedResponse = await adminHandler(
    buildEvent({
      headers: {
        Authorization: 'Bearer signed.jwt.token'
      }
    })
  );
  assert.equal(allowedResponse.principalId, 'user-123');
  assert.deepEqual(allowedResponse.context, {
    userId: 'user-123',
    isAdmin: 'true'
  });
  assert.equal(allowedResponse.policyDocument.Statement[0].Effect, 'Allow');

  const deniedResponse = await createHandler({
    userPoolId: 'us-east-1_pool',
    userPoolClientId: 'client-id'
  })(buildEvent());
  assert.equal(deniedResponse.policyDocument.Statement[0].Effect, 'Deny');
  assert.equal(deniedResponse.principalId, 'anonymous');
  assert.equal(deniedResponse.context, undefined);

  console.log('admin authorizer tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
