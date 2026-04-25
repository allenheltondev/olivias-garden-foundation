import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  createHandler,
  getApiArnPattern,
  isAnonymousRoute,
  normalizePath
} from '../src/auth/authorizer.mjs';
import { extractAuthContext, requireAdmin, requireUser } from '../src/services/auth.mjs';
import { mapApiError, normalizeRoutePath } from '../src/services/http.mjs';
import { StripeClient, verifyWebhookSignature } from '../src/services/stripe.mjs';

function testAnonymousRoutes() {
  assert.equal(isAnonymousRoute('GET', '/products'), true);
  assert.equal(isAnonymousRoute('GET', '/api/products'), true);
  assert.equal(isAnonymousRoute('GET', '/products/okra-pack'), true);
  assert.equal(isAnonymousRoute('GET', '/orders/by-session/cs_test_123'), true);
  assert.equal(isAnonymousRoute('POST', '/checkout'), true);
  assert.equal(isAnonymousRoute('POST', '/webhook'), true);
  assert.equal(isAnonymousRoute('OPTIONS', '/orders'), true);
  assert.equal(isAnonymousRoute('GET', '/orders'), false);
  assert.equal(isAnonymousRoute('GET', '/admin/orders'), false);

  assert.equal(normalizePath('/api/products'), '/products');
  assert.equal(normalizePath('/api'), '/');
}

async function testAuthorizer() {
  assert.equal(
    getApiArnPattern('arn:aws:execute-api:us-east-1:123:apiId/api/GET/products'),
    'arn:aws:execute-api:us-east-1:123:apiId/api/*/*'
  );

  // Anonymous request to a public route should be allowed.
  const anonHandler = createHandler({
    userPoolId: 'us-east-1_pool',
    userPoolClientId: 'client-id',
    verifyJwt: async () => {
      throw new Error('should not be called');
    }
  });
  const anonResponse = await anonHandler({
    httpMethod: 'GET',
    path: '/products',
    methodArn: 'arn:aws:execute-api:us-east-1:123:apiId/api/GET/products',
    headers: {}
  });
  assert.equal(anonResponse.policyDocument.Statement[0].Effect, 'Allow');
  assert.equal(anonResponse.context.userId, 'anonymous');

  // Anonymous request to a protected route should be denied.
  const denied = await anonHandler({
    httpMethod: 'GET',
    path: '/orders',
    methodArn: 'arn:aws:execute-api:us-east-1:123:apiId/api/GET/orders',
    headers: {}
  });
  assert.equal(denied.policyDocument.Statement[0].Effect, 'Deny');

  // Valid token to a protected route should attach userId/isAdmin.
  const userHandler = createHandler({
    userPoolId: 'us-east-1_pool',
    userPoolClientId: 'client-id',
    verifyJwt: async () => ({ sub: 'user-123', 'cognito:groups': ['user'], email: 'a@b.com' })
  });
  const userResponse = await userHandler({
    httpMethod: 'GET',
    path: '/orders',
    methodArn: 'arn:aws:execute-api:us-east-1:123:apiId/api/GET/orders',
    headers: { Authorization: 'Bearer signed.jwt.token' }
  });
  assert.equal(userResponse.policyDocument.Statement[0].Effect, 'Allow');
  assert.equal(userResponse.context.userId, 'user-123');
  assert.equal(userResponse.context.isAdmin, 'false');

  const adminHandler = createHandler({
    userPoolId: 'us-east-1_pool',
    userPoolClientId: 'client-id',
    verifyJwt: async () => ({ sub: 'admin-1', 'cognito:groups': ['Admin'] })
  });
  const adminResponse = await adminHandler({
    httpMethod: 'GET',
    path: '/admin/orders',
    methodArn: 'arn:aws:execute-api:us-east-1:123:apiId/api/GET/admin/orders',
    headers: { Authorization: 'Bearer signed.jwt.token' }
  });
  assert.equal(adminResponse.context.isAdmin, 'true');
}

function testAuthHelpers() {
  const ctx = extractAuthContext({
    requestContext: {
      authorizer: { userId: 'user-1', isAdmin: 'false', email: 'a@b.com' }
    }
  });
  assert.equal(ctx.userId, 'user-1');
  assert.equal(ctx.isAdmin, false);
  assert.equal(ctx.email, 'a@b.com');
  assert.doesNotThrow(() => requireUser(ctx));
  assert.throws(() => requireAdmin(ctx), /Forbidden/);

  const anonCtx = extractAuthContext({
    requestContext: { authorizer: { userId: 'anonymous' } }
  });
  assert.equal(anonCtx.userId, null);
  assert.throws(() => requireUser(anonCtx), /Authentication required/);

  assert.equal(normalizeRoutePath('/api/products'), '/products');
  assert.equal(mapApiError(new Error('Product not found'), 'cid').statusCode, 404);
  assert.equal(mapApiError(new Error('Cart is empty'), 'cid').statusCode, 400);
  assert.equal(mapApiError(new Error('Authentication required'), 'cid').statusCode, 401);
  assert.equal(mapApiError(new Error('STRIPE_SECRET_KEY is not configured'), 'cid').statusCode, 503);
}

async function testStripeCheckoutSession() {
  const calls = [];
  const stripe = new StripeClient('sk_test_x', async (url, init) => {
    calls.push({ url: String(url), init });
    return {
      ok: true,
      status: 200,
      async json() {
        return { id: 'cs_test_123', url: 'https://checkout.stripe.com/c/cs_test_123' };
      }
    };
  });

  const session = await stripe.createCheckoutSession({
    items: [
      { priceId: 'price_a', quantity: 2 },
      { priceId: 'price_b', quantity: 1 }
    ],
    successUrl: 'https://store.example.org/order-complete?session_id={CHECKOUT_SESSION_ID}',
    cancelUrl: 'https://store.example.org/cart',
    customerEmail: 'a@b.com',
    requiresShipping: true,
    metadata: { og_user_id: 'user-1' }
  });

  assert.equal(session.id, 'cs_test_123');
  assert.match(session.url, /checkout\.stripe\.com/);
  assert.equal(calls.length, 1);
  const body = String(calls[0].init.body);
  assert.match(body, /mode=payment/);
  assert.match(body, /line_items%5B0%5D%5Bprice%5D=price_a/);
  assert.match(body, /line_items%5B0%5D%5Bquantity%5D=2/);
  assert.match(body, /line_items%5B1%5D%5Bprice%5D=price_b/);
  assert.match(body, /shipping_address_collection/);
  assert.match(body, /customer_email=a%40b.com/);
  assert.match(body, /metadata%5Bog_user_id%5D=user-1/);
}

function testWebhookSignature() {
  const secret = 'whsec_test_secret';
  const payload = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' });
  const timestamp = Math.floor(Date.now() / 1000);
  const signedPayload = `${timestamp}.${payload}`;
  const sig = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  const header = `t=${timestamp},v1=${sig}`;

  assert.doesNotThrow(() =>
    verifyWebhookSignature({
      payload,
      signatureHeader: header,
      secret,
      now: () => timestamp * 1000
    })
  );

  assert.throws(
    () =>
      verifyWebhookSignature({
        payload,
        signatureHeader: `t=${timestamp},v1=deadbeef`,
        secret,
        now: () => timestamp * 1000
      }),
    /signature verification failed/
  );

  assert.throws(
    () =>
      verifyWebhookSignature({
        payload,
        signatureHeader: header,
        secret,
        now: () => (timestamp + 10_000) * 1000
      }),
    /tolerance/
  );
}

testAnonymousRoutes();
await testAuthorizer();
testAuthHelpers();
await testStripeCheckoutSession();
testWebhookSignature();
console.log('store api tests passed');
