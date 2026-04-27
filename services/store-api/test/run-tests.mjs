import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  createHandler,
  getApiArnPattern,
  isAnonymousRoute,
  normalizePath
} from '../src/auth/authorizer.mjs';
import { extractAuthContext, requireAdmin, requireUser } from '../src/services/auth.mjs';
import { mapApiError, normalizeRoutePath, parseJsonBody, readRawBody } from '../src/services/http.mjs';
import {
  createCheckoutSession,
  getAllowedRedirectOrigins,
  handleStripeWebhook,
  recordPaidOrder
} from '../src/services/orders.mjs';
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

function makeFakeDb({ existingOrderId = null, productLookup = {} } = {}) {
  const calls = {
    query: [],
    clientQuery: [],
    transactions: 0,
    inserts: { orders: [], items: [] }
  };
  let storedOrderId = existingOrderId;

  const handleClientQuery = async (sql, params = []) => {
    calls.clientQuery.push({ sql: sql.trim(), params });
    if (/from\s+store_orders\s+where\s+stripe_checkout_session_id/i.test(sql)) {
      return { rows: storedOrderId ? [{ id: storedOrderId }] : [] };
    }
    if (/^insert\s+into\s+store_orders/i.test(sql.trim())) {
      const newId = '00000000-0000-4000-8000-000000000001';
      storedOrderId = newId;
      calls.inserts.orders.push(params);
      return { rows: [{ id: newId }] };
    }
    if (/from\s+store_products\s+where\s+stripe_price_id/i.test(sql)) {
      const priceId = params[0];
      const product = productLookup[priceId];
      return { rows: product ? [product] : [] };
    }
    if (/^insert\s+into\s+store_order_items/i.test(sql.trim())) {
      calls.inserts.items.push(params);
      return { rows: [] };
    }
    throw new Error(`Unexpected client.query: ${sql}`);
  };

  return {
    db: {
      async query(sql, params = []) {
        calls.query.push({ sql: sql.trim(), params });
        if (/from\s+users\s+where\s+email/i.test(sql)) {
          // Return a mapped user when the test wires productLookup.__userByEmail.
          const email = params[0];
          const map = productLookup.__userByEmail ?? {};
          const id = map[email];
          return { rows: id ? [{ id }] : [] };
        }
        throw new Error(`Unexpected db.query: ${sql}`);
      },
      async withTransaction(fn) {
        calls.transactions += 1;
        return fn({ query: handleClientQuery });
      }
    },
    calls
  };
}

const sampleStripeSession = {
  id: 'cs_test_abc',
  payment_intent: 'pi_test_abc',
  customer: 'cus_test_abc',
  customer_email: 'alice@example.com',
  customer_details: {
    email: 'alice@example.com',
    name: 'Alice Adams',
    address: null
  },
  currency: 'usd',
  amount_total: 2900,
  amount_subtotal: 2500,
  total_details: { amount_tax: 0, amount_shipping: 400 },
  metadata: {},
  shipping_details: {
    name: 'Alice Adams',
    address: {
      line1: '1 Main St',
      line2: null,
      city: 'Austin',
      state: 'TX',
      postal_code: '78701',
      country: 'US'
    }
  },
  line_items: {
    data: [
      {
        price: { id: 'price_seed', unit_amount: 2500 },
        quantity: 1,
        amount_total: 2500,
        description: 'Seed pack'
      }
    ]
  }
};

async function testRecordPaidOrderInfersUserFromEmail() {
  const fake = makeFakeDb({
    productLookup: {
      price_seed: {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        slug: 'okra-seed-pack',
        name: 'Okra Seed Pack',
        kind: 'merchandise'
      },
      __userByEmail: { 'alice@example.com': 'user-alice' }
    }
  });

  const orderId = await recordPaidOrder(sampleStripeSession, { db: fake.db });
  assert.equal(orderId, '00000000-0000-4000-8000-000000000001');
  assert.equal(fake.calls.transactions, 1);
  assert.equal(fake.calls.inserts.orders.length, 1);
  assert.equal(fake.calls.inserts.items.length, 1);

  const orderParams = fake.calls.inserts.orders[0];
  // Insert order: [user_id, email, customer_name, sessionId, paymentIntentId, customerId,
  //                subtotal, shipping, tax, total, currency, shippingAddress]
  assert.equal(orderParams[0], 'user-alice', 'user_id should be inferred from email');
  assert.equal(orderParams[1], 'alice@example.com');
  assert.equal(orderParams[2], 'Alice Adams');
  assert.equal(orderParams[3], 'cs_test_abc');
  assert.equal(orderParams[4], 'pi_test_abc');
  assert.equal(orderParams[5], 'cus_test_abc');
  assert.equal(orderParams[6], 2500);
  assert.equal(orderParams[7], 400);
  assert.equal(orderParams[8], 0);
  assert.equal(orderParams[9], 2900);
  assert.equal(orderParams[10], 'usd');
  const shippingAddress = JSON.parse(orderParams[11]);
  assert.equal(shippingAddress.line1, '1 Main St');
  assert.equal(shippingAddress.country, 'US');

  const itemParams = fake.calls.inserts.items[0];
  // [order_id, product_id, slug, name, kind, quantity, unit_amount, total, stripe_price_id]
  assert.equal(itemParams[1], 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.equal(itemParams[2], 'okra-seed-pack');
  assert.equal(itemParams[3], 'Okra Seed Pack');
  assert.equal(itemParams[4], 'merchandise');
  assert.equal(itemParams[5], 1);
  assert.equal(itemParams[6], 2500);
  assert.equal(itemParams[7], 2500);
  assert.equal(itemParams[8], 'price_seed');
}

async function testRecordPaidOrderUsesMetadataUserId() {
  const fake = makeFakeDb({
    productLookup: {
      price_seed: { id: 'p1', slug: 's', name: 'n', kind: 'donation' },
      // Email map intentionally NOT used; metadata wins.
      __userByEmail: { 'alice@example.com': 'should-not-be-used' }
    }
  });

  const session = {
    ...sampleStripeSession,
    metadata: { og_user_id: 'user-from-metadata' }
  };

  await recordPaidOrder(session, { db: fake.db });
  // The email->user lookup should be skipped entirely.
  assert.equal(fake.calls.query.length, 0, 'should not query users when metadata user id present');

  const orderParams = fake.calls.inserts.orders[0];
  assert.equal(orderParams[0], 'user-from-metadata');
}

async function testRecordPaidOrderIsIdempotent() {
  const fake = makeFakeDb({
    existingOrderId: 'existing-order-id',
    productLookup: {
      price_seed: { id: 'p1', slug: 's', name: 'n', kind: 'donation' }
    }
  });

  const orderId = await recordPaidOrder(sampleStripeSession, { db: fake.db });
  assert.equal(orderId, 'existing-order-id');
  assert.equal(fake.calls.inserts.orders.length, 0);
  assert.equal(fake.calls.inserts.items.length, 0);
}

async function testRecordPaidOrderGuestKeepsUserNull() {
  const fake = makeFakeDb({
    productLookup: {
      price_seed: { id: 'p1', slug: 's', name: 'n', kind: 'donation' }
      // No __userByEmail mapping — email is unknown.
    }
  });

  await recordPaidOrder(sampleStripeSession, { db: fake.db });
  const orderParams = fake.calls.inserts.orders[0];
  assert.equal(orderParams[0], null, 'guest orders should leave user_id null');
  assert.equal(orderParams[1], 'alice@example.com', 'email is still recorded');
}

async function testRecordPaidOrderRequiresEmail() {
  const fake = makeFakeDb();
  const session = { ...sampleStripeSession, customer_email: null, customer_details: {} };
  await assert.rejects(() => recordPaidOrder(session, { db: fake.db }), /no customer email/);
}

async function testHandleStripeWebhookHappyPath() {
  const secret = 'whsec_integration';
  const payload = JSON.stringify({
    id: 'evt_1',
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_test_abc', payment_status: 'paid' } }
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const sig = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`)
    .digest('hex');

  let getSessionCalledWith = null;
  const stripeClient = {
    async getCheckoutSession(id) {
      getSessionCalledWith = id;
      return sampleStripeSession;
    }
  };
  const fake = makeFakeDb({
    productLookup: {
      price_seed: { id: 'p1', slug: 's', name: 'n', kind: 'donation' }
    }
  });

  const result = await handleStripeWebhook(payload, `t=${timestamp},v1=${sig}`, {
    webhookSecret: secret,
    stripeClient,
    db: fake.db
  });

  assert.equal(result.handled, true);
  assert.equal(getSessionCalledWith, 'cs_test_abc');
  assert.equal(fake.calls.inserts.orders.length, 1);
}

async function testHandleStripeWebhookSkipsUnpaid() {
  const secret = 'whsec_integration';
  const payload = JSON.stringify({
    id: 'evt_2',
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_test_unpaid', payment_status: 'unpaid' } }
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const sig = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`)
    .digest('hex');

  const stripeClient = {
    async getCheckoutSession() {
      throw new Error('should not be called for unpaid session');
    }
  };

  const result = await handleStripeWebhook(payload, `t=${timestamp},v1=${sig}`, {
    webhookSecret: secret,
    stripeClient
  });

  assert.equal(result.handled, false);
  assert.match(result.reason ?? '', /payment_status=unpaid/);
}

async function testHandleStripeWebhookSkipsUnrelatedEvent() {
  const secret = 'whsec_integration';
  const payload = JSON.stringify({
    id: 'evt_3',
    type: 'charge.refunded',
    data: { object: { id: 'ch_test' } }
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const sig = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`)
    .digest('hex');

  const result = await handleStripeWebhook(payload, `t=${timestamp},v1=${sig}`, {
    webhookSecret: secret,
    stripeClient: { async getCheckoutSession() { throw new Error('nope'); } }
  });

  assert.equal(result.handled, false);
  assert.equal(result.type, 'charge.refunded');
}

async function testHandleStripeWebhookRejectsBadSignature() {
  const payload = JSON.stringify({ id: 'evt_x', type: 'checkout.session.completed' });
  await assert.rejects(
    () => handleStripeWebhook(payload, 't=1,v1=deadbeef', { webhookSecret: 'whsec_x' }),
    /signature/
  );
}

function testReadRawBodyDecodesBase64() {
  const payload = JSON.stringify({ items: [{ productId: 'x', quantity: 1 }] });
  const event = {
    body: Buffer.from(payload, 'utf8').toString('base64'),
    isBase64Encoded: true
  };
  assert.equal(readRawBody(event), payload);
}

function testParseJsonBodyDecodesBase64() {
  const payload = JSON.stringify({ items: ['hello'] });
  const event = {
    body: Buffer.from(payload, 'utf8').toString('base64'),
    isBase64Encoded: true
  };
  const parsed = parseJsonBody(event);
  assert.deepEqual(parsed, { items: ['hello'] });
}

function testParseJsonBodyHandlesPlainString() {
  const event = { body: '{"hello":"world"}' };
  assert.deepEqual(parseJsonBody(event), { hello: 'world' });
}

function testGetAllowedRedirectOriginsFromEnvList() {
  const origins = getAllowedRedirectOrigins({
    ALLOWED_CHECKOUT_REDIRECT_ORIGINS: 'https://store.example.org , https://admin.example.org'
  });
  assert.deepEqual(origins, ['https://store.example.org', 'https://admin.example.org']);
}

function testGetAllowedRedirectOriginsFromOrigin() {
  const origins = getAllowedRedirectOrigins({ ORIGIN: 'https://store.example.org/' });
  assert.deepEqual(origins, [
    'https://store.example.org',
    'http://localhost:5177',
    'http://localhost:4177'
  ]);
}

function testGetAllowedRedirectOriginsIgnoresWildcardOrigin() {
  const origins = getAllowedRedirectOrigins({ ORIGIN: '*' });
  assert.deepEqual(origins, ['http://localhost:5177', 'http://localhost:4177']);
}

const validCheckoutPayload = {
  items: [
    {
      productId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      quantity: 1
    }
  ],
  success_url: 'https://store.example.org/order-complete?session_id={CHECKOUT_SESSION_ID}',
  cancel_url: 'https://store.example.org/cart'
};

async function testCheckoutRejectsAttackerControlledSuccessUrl() {
  const event = { requestContext: { authorizer: {} } };
  await assert.rejects(
    () =>
      createCheckoutSession(
        event,
        { ...validCheckoutPayload, success_url: 'https://evil.example/steal?session_id={CHECKOUT_SESSION_ID}' },
        { allowedRedirectOrigins: ['https://store.example.org'] }
      ),
    /success_url origin is not allowed/
  );
}

async function testCheckoutRejectsAttackerControlledCancelUrl() {
  const event = { requestContext: { authorizer: {} } };
  await assert.rejects(
    () =>
      createCheckoutSession(
        event,
        { ...validCheckoutPayload, cancel_url: 'https://evil.example/cart' },
        { allowedRedirectOrigins: ['https://store.example.org'] }
      ),
    /cancel_url origin is not allowed/
  );
}

async function testCheckoutRejectsMalformedRedirectUrl() {
  const event = { requestContext: { authorizer: {} } };
  await assert.rejects(
    () =>
      createCheckoutSession(
        event,
        { ...validCheckoutPayload, success_url: 'not-a-real-url' },
        { allowedRedirectOrigins: ['https://store.example.org'] }
      ),
    /success_url is not a valid URL|success_url origin is not allowed/
  );
}

async function testCheckoutRejectsNonHttpScheme() {
  const event = { requestContext: { authorizer: {} } };
  await assert.rejects(
    () =>
      createCheckoutSession(
        event,
        { ...validCheckoutPayload, success_url: 'javascript:alert(1)' },
        { allowedRedirectOrigins: ['https://store.example.org'] }
      ),
    /success_url/
  );
}

testAnonymousRoutes();
await testAuthorizer();
testAuthHelpers();
await testStripeCheckoutSession();
testWebhookSignature();
await testRecordPaidOrderInfersUserFromEmail();
await testRecordPaidOrderUsesMetadataUserId();
await testRecordPaidOrderIsIdempotent();
await testRecordPaidOrderGuestKeepsUserNull();
await testRecordPaidOrderRequiresEmail();
await testHandleStripeWebhookHappyPath();
await testHandleStripeWebhookSkipsUnpaid();
await testHandleStripeWebhookSkipsUnrelatedEvent();
await testHandleStripeWebhookRejectsBadSignature();
testReadRawBodyDecodesBase64();
testParseJsonBodyDecodesBase64();
testParseJsonBodyHandlesPlainString();
testGetAllowedRedirectOriginsFromEnvList();
testGetAllowedRedirectOriginsFromOrigin();
testGetAllowedRedirectOriginsIgnoresWildcardOrigin();
await testCheckoutRejectsAttackerControlledSuccessUrl();
await testCheckoutRejectsAttackerControlledCancelUrl();
await testCheckoutRejectsMalformedRedirectUrl();
await testCheckoutRejectsNonHttpScheme();
console.log('store api tests passed');
