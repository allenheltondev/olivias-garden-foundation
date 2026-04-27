import assert from 'node:assert/strict';
import {
  requireAdminContext,
  requireUserContext,
  resolveOptionalAuthContext
} from '../src/services/auth.mjs';
import { mapApiError, normalizeRoutePath, parseJsonBody, readRawBody } from '../src/services/http.mjs';
import {
  createCheckoutSession,
  getAllowedRedirectOrigins,
  handleStripeEventBridgeEvent,
  recordPaidOrder
} from '../src/services/orders.mjs';
import { mapProduct } from '../src/services/products.mjs';
import { StripeClient } from '../src/services/stripe.mjs';

const verifyJwtAsUser = async () => ({
  sub: 'user-123',
  email: 'alice@example.com',
  'cognito:groups': ['user']
});
const verifyJwtAsAdmin = async () => ({
  sub: 'admin-1',
  email: 'admin@example.com',
  'cognito:groups': ['Admin']
});
const verifyJwtRejects = async () => {
  throw new Error('jwt verification failed');
};

async function testResolveOptionalAuthContextAnonymous() {
  const ctx = await resolveOptionalAuthContext({});
  assert.equal(ctx, null, 'no headers => null context');
}

async function testResolveOptionalAuthContextUser() {
  const ctx = await resolveOptionalAuthContext(
    { headers: { Authorization: 'Bearer signed.jwt' } },
    { verifyJwt: verifyJwtAsUser }
  );
  assert.equal(ctx.userId, 'user-123');
  assert.equal(ctx.email, 'alice@example.com');
  assert.equal(ctx.isAdmin, false);
}

async function testResolveOptionalAuthContextAdmin() {
  const ctx = await resolveOptionalAuthContext(
    { headers: { Authorization: 'Bearer signed.jwt' } },
    { verifyJwt: verifyJwtAsAdmin }
  );
  assert.equal(ctx.isAdmin, true);
}

async function testResolveOptionalAuthContextRejectsInvalid() {
  await assert.rejects(
    () =>
      resolveOptionalAuthContext(
        { headers: { Authorization: 'Bearer bad.jwt' } },
        { verifyJwt: verifyJwtRejects }
      ),
    /Invalid access token/
  );
}

async function testResolveOptionalAuthContextRejectsMalformedHeader() {
  await assert.rejects(
    () => resolveOptionalAuthContext({ headers: { Authorization: 'NotBearer xxx' } }),
    /authorization header format/
  );
}

async function testRequireUserContextRejectsAnonymous() {
  await assert.rejects(() => requireUserContext({}), /Authentication required/);
}

async function testRequireAdminContextRejectsNonAdmin() {
  await assert.rejects(
    () =>
      requireAdminContext(
        { headers: { Authorization: 'Bearer x' } },
        { verifyJwt: verifyJwtAsUser }
      ),
    /Forbidden/
  );
}

async function testRequireAdminContextAcceptsAdmin() {
  const ctx = await requireAdminContext(
    { headers: { Authorization: 'Bearer x' } },
    { verifyJwt: verifyJwtAsAdmin }
  );
  assert.equal(ctx.isAdmin, true);
  assert.equal(ctx.userId, 'admin-1');
}

function testHttpHelpers() {
  assert.equal(normalizeRoutePath('/api/products'), '/products');
  assert.equal(mapApiError(new Error('Product not found'), 'cid').statusCode, 404);
  assert.equal(mapApiError(new Error('Cart is empty'), 'cid').statusCode, 400);
  assert.equal(mapApiError(new Error('Authentication required'), 'cid').statusCode, 401);
  assert.equal(mapApiError(new Error('STRIPE_SECRET_KEY is not configured'), 'cid').statusCode, 503);
}

function testProductMapperExposesMultiImageContract() {
  const product = mapProduct({
    id: 'product-1',
    slug: 'seed-pack',
    name: 'Seed Pack',
    short_description: null,
    description: null,
    status: 'active',
    kind: 'merchandise',
    fulfillment_type: 'shipping',
    is_public: true,
    is_featured: false,
    currency: 'usd',
    unit_amount_cents: 1200,
    statement_descriptor: null,
    nonprofit_program: null,
    impact_summary: null,
    image_url: null,
    images: [{
      id: 'image-1',
      url: 'https://assets.example.test/store-products/seed/display.webp',
      thumbnail_url: 'https://assets.example.test/store-products/seed/thumbnail.webp'
    }],
    metadata: {},
    stripe_product_id: 'prod_1',
    stripe_price_id: 'price_1',
    created_at: '2026-04-27T00:00:00.000Z',
    updated_at: '2026-04-27T00:00:00.000Z'
  });

  assert.equal(product.image_url, 'https://assets.example.test/store-products/seed/display.webp');
  assert.deepEqual(product.image_urls, ['https://assets.example.test/store-products/seed/display.webp']);
  assert.equal(product.images.length, 1);
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
    metadata: { og_kind: 'store', og_user_id: 'user-1' }
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
  assert.match(body, /metadata%5Bog_kind%5D=store/);
  assert.match(body, /metadata%5Bog_user_id%5D=user-1/);
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
  metadata: { og_kind: 'store' },
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
      __userByEmail: { 'alice@example.com': 'should-not-be-used' }
    }
  });

  const session = {
    ...sampleStripeSession,
    metadata: { og_kind: 'store', og_user_id: 'user-from-metadata' }
  };

  await recordPaidOrder(session, { db: fake.db });
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

function makeEventBridgeEvent({ id = 'cs_test_abc', type = 'checkout.session.completed', metadata = { og_kind: 'store' }, paymentStatus = 'paid' } = {}) {
  return {
    id: 'eb-evt-1',
    'detail-type': type,
    detail: {
      id: 'evt_1',
      type,
      data: {
        object: {
          id,
          metadata,
          payment_status: paymentStatus
        }
      }
    }
  };
}

async function testEventBridgeHappyPath() {
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

  const result = await handleStripeEventBridgeEvent(makeEventBridgeEvent(), {
    stripeClient,
    db: fake.db
  });

  assert.equal(result.handled, true);
  assert.equal(getSessionCalledWith, 'cs_test_abc');
  assert.equal(fake.calls.inserts.orders.length, 1);
}

async function testEventBridgeHandlesAsyncSucceeded() {
  const stripeClient = {
    async getCheckoutSession() {
      return sampleStripeSession;
    }
  };
  const fake = makeFakeDb({
    productLookup: {
      price_seed: { id: 'p1', slug: 's', name: 'n', kind: 'donation' }
    }
  });

  const result = await handleStripeEventBridgeEvent(
    makeEventBridgeEvent({ type: 'checkout.session.async_payment_succeeded' }),
    { stripeClient, db: fake.db }
  );

  assert.equal(result.handled, true);
  assert.equal(fake.calls.inserts.orders.length, 1);
}

async function testEventBridgeIgnoresDonationEvents() {
  // Donation checkouts come through the same partner bus. They have
  // metadata.donation_mode set and (importantly) lack og_kind=store, so the
  // store consumer must skip them so it doesn't insert spurious order rows.
  const stripeClient = {
    async getCheckoutSession() {
      throw new Error('should not be called for donation events');
    }
  };
  const fake = makeFakeDb();

  const result = await handleStripeEventBridgeEvent(
    makeEventBridgeEvent({ metadata: { donation_mode: 'one_time' } }),
    { stripeClient, db: fake.db }
  );

  assert.equal(result.handled, false);
  assert.match(result.reason, /not a store checkout session/);
  assert.equal(fake.calls.inserts.orders.length, 0);
}

async function testEventBridgeIgnoresUnpaidSessions() {
  const stripeClient = {
    async getCheckoutSession() {
      throw new Error('should not be called for unpaid sessions');
    }
  };

  const result = await handleStripeEventBridgeEvent(
    makeEventBridgeEvent({ paymentStatus: 'unpaid' }),
    { stripeClient }
  );

  assert.equal(result.handled, false);
  assert.match(result.reason, /payment_status=unpaid/);
}

async function testEventBridgeIgnoresUnsupportedDetailType() {
  const result = await handleStripeEventBridgeEvent(
    makeEventBridgeEvent({ type: 'charge.refunded' }),
    { stripeClient: { async getCheckoutSession() { throw new Error('nope'); } } }
  );

  assert.equal(result.handled, false);
  assert.match(result.reason, /unsupported detail-type/);
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
  const event = {};
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
  const event = {};
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
  const event = {};
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
  const event = {};
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

await testResolveOptionalAuthContextAnonymous();
await testResolveOptionalAuthContextUser();
await testResolveOptionalAuthContextAdmin();
await testResolveOptionalAuthContextRejectsInvalid();
await testResolveOptionalAuthContextRejectsMalformedHeader();
await testRequireUserContextRejectsAnonymous();
await testRequireAdminContextRejectsNonAdmin();
await testRequireAdminContextAcceptsAdmin();
testHttpHelpers();
testProductMapperExposesMultiImageContract();
await testStripeCheckoutSession();
await testRecordPaidOrderInfersUserFromEmail();
await testRecordPaidOrderUsesMetadataUserId();
await testRecordPaidOrderIsIdempotent();
await testRecordPaidOrderGuestKeepsUserNull();
await testRecordPaidOrderRequiresEmail();
await testEventBridgeHappyPath();
await testEventBridgeHandlesAsyncSucceeded();
await testEventBridgeIgnoresDonationEvents();
await testEventBridgeIgnoresUnpaidSessions();
await testEventBridgeIgnoresUnsupportedDetailType();
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
