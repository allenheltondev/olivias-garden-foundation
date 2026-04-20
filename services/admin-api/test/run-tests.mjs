import assert from 'node:assert/strict';
import { createHandler, getApiArnPattern, isPublicRoute, verifyAdminToken } from '../src/auth/authorizer.mjs';
import { extractAuthContext, requireAdmin } from '../src/services/auth.mjs';
import { mapApiError, normalizeRoutePath } from '../src/services/http.mjs';
import { StripeStoreClient, validatePayload } from '../src/services/store.mjs';

async function testAuthorizer() {
  assert.equal(
    getApiArnPattern(
      'arn:aws:execute-api:us-east-1:123456789012:restApiId/api/GET/admin/store/products'
    ),
    'arn:aws:execute-api:us-east-1:123456789012:restApiId/api/*/*'
  );

  assert.equal(
    isPublicRoute({ httpMethod: 'GET', path: '/store/products' }),
    true
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

  const handler = createHandler({
    userPoolId: 'us-east-1_pool',
    userPoolClientId: 'client-id',
    verifyJwt: async () => ({
      sub: 'user-123',
      'cognito:groups': ['Admin']
    })
  });

  const response = await handler({
    httpMethod: 'GET',
    path: '/admin/store/products',
    methodArn:
      'arn:aws:execute-api:us-east-1:123456789012:restApiId/api/GET/admin/store/products',
    headers: {
      Authorization: 'Bearer signed.jwt.token'
    }
  });

  assert.equal(response.principalId, 'user-123');
  assert.deepEqual(response.context, {
    userId: 'user-123',
    isAdmin: 'true'
  });
}

function testAuthAndHttpHelpers() {
  const context = extractAuthContext({
    requestContext: {
      authorizer: {
        userId: 'user-123',
        isAdmin: 'true'
      }
    }
  });

  assert.equal(context.userId, 'user-123');
  assert.equal(context.isAdmin, true);
  assert.doesNotThrow(() => requireAdmin(context));
  assert.equal(normalizeRoutePath('/api/admin/store/products'), '/admin/store/products');
  assert.equal(mapApiError(new Error('Store product not found'), 'cid-1').statusCode, 404);
}

async function testStoreHelpers() {
  const payload = {
    slug: 'okra-seed-pack',
    name: 'Okra Seed Pack',
    short_description: 'Starter seeds',
    description: 'A nonprofit seed pack.',
    status: 'draft',
    kind: 'donation',
    fulfillment_type: 'shipping',
    is_public: false,
    is_featured: false,
    currency: 'usd',
    unit_amount_cents: 1200,
    statement_descriptor: 'OGF STORE',
    nonprofit_program: 'Seed outreach',
    impact_summary: 'Funds seed distribution',
    image_url: null,
    metadata: { campaign: 'okra' }
  };

  assert.doesNotThrow(() => validatePayload(payload));
  assert.throws(
    () => validatePayload({ ...payload, metadata: [] }),
    /metadata must be a JSON object/
  );

  const requests = [];
  const stripe = new StripeStoreClient('sk_test_123', async (_url, init) => {
    requests.push(init);
    return {
      ok: true,
      status: 200,
      async json() {
        return { id: requests.length === 1 ? 'prod_123' : 'price_123' };
      }
    };
  });

  const productId = await stripe.createProduct(payload);
  const priceId = await stripe.createPrice(productId, payload.unit_amount_cents, payload.currency);

  assert.equal(productId, 'prod_123');
  assert.equal(priceId, 'price_123');
}

await testAuthorizer();
testAuthAndHttpHelpers();
await testStoreHelpers();
console.log('admin api tests passed');
