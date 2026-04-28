import assert from 'node:assert/strict';
import { createHandler, getApiArnPattern, isPublicRoute, verifyAdminToken } from '../src/auth/authorizer.mjs';
import { extractAuthContext, requireAdmin } from '../src/services/auth.mjs';
import { mapApiError, normalizeRoutePath } from '../src/services/http.mjs';
import { StripeStoreClient, validatePayload } from '../src/services/store.mjs';
import {
  assertImageVariationMatchesAreValid,
  completeStoreProductImageUpload,
  createStoreProductImageUploadIntent,
  normalizeProductImageInputs
} from '../src/services/store-images.mjs';

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
    images: [],
    metadata: { campaign: 'okra' }
  };

  assert.doesNotThrow(() => validatePayload(payload));
  assert.throws(
    () => validatePayload({ ...payload, metadata: [] }),
    /metadata must be a JSON object/
  );

  // variations is optional but, if provided, must be a well-formed array
  // of { name, values: string[] }. Empty value lists and duplicate names
  // are rejected up-front so we never persist garbage.
  assert.doesNotThrow(() =>
    validatePayload({
      ...payload,
      variations: [
        { name: 'Color', values: ['Red', 'Blue'] },
        { name: 'Ink', values: ['Black'] }
      ]
    })
  );
  assert.throws(
    () => validatePayload({ ...payload, variations: 'nope' }),
    /variations must be an array/
  );
  assert.throws(
    () => validatePayload({ ...payload, variations: [{ name: '', values: ['Red'] }] }),
    /variation name is required/
  );
  assert.throws(
    () => validatePayload({ ...payload, variations: [{ name: 'Color', values: [] }] }),
    /at least one value/
  );
  assert.throws(
    () =>
      validatePayload({
        ...payload,
        variations: [
          { name: 'Color', values: ['Red'] },
          { name: 'color', values: ['Blue'] }
        ]
      }),
    /variation names must be unique/
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

  await stripe.updateProductImages(productId, [
    'https://assets.example.test/store-products/1/display.webp',
    'https://assets.example.test/store-products/2/display.webp'
  ]);

  const imageBody = requests[2].body;
  assert.equal(imageBody.get('images[0]'), 'https://assets.example.test/store-products/1/display.webp');
  assert.equal(imageBody.get('images[1]'), 'https://assets.example.test/store-products/2/display.webp');
}

async function testStoreImageHelpers() {
  process.env.MEDIA_BUCKET_NAME = 'assets-test-bucket';
  const event = {
    headers: {},
    requestContext: {
      authorizer: {
        userId: 'admin-user-1',
        isAdmin: 'true'
      }
    }
  };

  assert.deepEqual(
    normalizeProductImageInputs([{ id: '00000000-0000-4000-8000-000000000001', alt_text: 'Okra seeds' }]),
    [
      {
        id: '00000000-0000-4000-8000-000000000001',
        sort_order: 0,
        alt_text: 'Okra seeds',
        variation_match: {}
      }
    ]
  );

  // variation_match passes through when valid and is rejected up-front when
  // it isn't an object of strings.
  assert.deepEqual(
    normalizeProductImageInputs([
      {
        id: '00000000-0000-4000-8000-000000000002',
        variation_match: { Color: 'Red' }
      }
    ]),
    [
      {
        id: '00000000-0000-4000-8000-000000000002',
        sort_order: 0,
        alt_text: null,
        variation_match: { Color: 'Red' }
      }
    ]
  );
  assert.throws(
    () =>
      normalizeProductImageInputs([
        { id: '00000000-0000-4000-8000-000000000003', variation_match: { Color: 123 } }
      ]),
    /variation_match values must be 1–100 character strings/
  );

  // Cross-validation against a product's variations rejects tags that
  // reference an option or value that doesn't exist.
  const tagged = normalizeProductImageInputs([
    { id: '00000000-0000-4000-8000-000000000004', variation_match: { Color: 'Red' } }
  ]);
  assert.doesNotThrow(() =>
    assertImageVariationMatchesAreValid(tagged, [
      { name: 'Color', values: ['Red', 'Blue'] }
    ])
  );
  assert.throws(
    () =>
      assertImageVariationMatchesAreValid(tagged, [
        { name: 'Color', values: ['Blue'] }
      ]),
    /not a value of "Color"/
  );
  assert.throws(
    () =>
      assertImageVariationMatchesAreValid(tagged, [
        { name: 'Ink', values: ['Black'] }
      ]),
    /variation "Color" that is not defined/
  );

  const queries = [];
  const intent = await createStoreProductImageUploadIntent(
    event,
    { contentType: 'image/jpeg', contentLength: 1234 },
    {
      db: {
        async query(sql, params) {
          queries.push({ sql, params });
          return { rows: [], rowCount: 1 };
        }
      },
      async signUploadUrl(command, expiresIn) {
        assert.equal(command.input.ContentType, 'image/jpeg');
        assert.equal(command.input.ContentLength, 1234);
        assert.equal(expiresIn, 900);
        return 'https://upload.example.test/product-image';
      }
    }
  );

  assert.equal(intent.method, 'PUT');
  assert.equal(intent.uploadUrl, 'https://upload.example.test/product-image');
  assert.equal(queries.length, 1);

  let enqueuedImageId = null;
  const complete = await completeStoreProductImageUpload(
    event,
    '00000000-0000-4000-8000-000000000001',
    {
      db: {
        async query() {
          return { rows: [{ id: '00000000-0000-4000-8000-000000000001' }], rowCount: 1 };
        }
      },
      async enqueue(imageId) {
        enqueuedImageId = imageId;
      }
    }
  );

  assert.equal(complete.status, 'processing');
  assert.equal(enqueuedImageId, '00000000-0000-4000-8000-000000000001');
}

await testAuthorizer();
testAuthAndHttpHelpers();
await testStoreHelpers();
await testStoreImageHelpers();
console.log('admin api tests passed');
