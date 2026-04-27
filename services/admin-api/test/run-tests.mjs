import assert from 'node:assert/strict';
import { createHandler, getApiArnPattern, isPublicRoute, verifyAdminToken } from '../src/auth/authorizer.mjs';
import { extractAuthContext, requireAdmin } from '../src/services/auth.mjs';
import { mapApiError, normalizeRoutePath } from '../src/services/http.mjs';
import { StripeStoreClient, validatePayload } from '../src/services/store.mjs';
import {
  buildActivityQueryParams,
  clampLimit,
  decodeCursor,
  encodeCursor,
  toActivityItem
} from '../src/services/activity.mjs';
import {
  aggregateRevenue,
  defaultRange,
  getRevenueSummary,
  parseDateBoundary,
  resolveGranularity
} from '../src/services/finance.mjs';

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

function testActivityHelpers() {
  // clampLimit
  assert.equal(clampLimit(undefined), 25);
  assert.equal(clampLimit(0), 25);
  assert.equal(clampLimit(-5), 25);
  assert.equal(clampLimit('not-a-number'), 25);
  assert.equal(clampLimit(50), 50);
  assert.equal(clampLimit(500), 100);
  assert.equal(clampLimit(1.7), 1);

  // cursor round-trip
  const key = { pk: 'ACTIVITY', sk: '2026-04-27T15:00:00Z#evt-1' };
  const cursor = encodeCursor(key);
  assert.ok(typeof cursor === 'string' && cursor.length > 0);
  assert.deepEqual(decodeCursor(cursor), key);
  assert.equal(encodeCursor(null), null);
  assert.equal(decodeCursor(undefined), undefined);
  assert.equal(decodeCursor('not-base64-json'), undefined);

  // toActivityItem strips internal DDB attributes
  const item = toActivityItem({
    pk: 'ACTIVITY',
    sk: '2026-04-27T15:00:00Z#evt-1',
    eventId: 'evt-1',
    source: 'ogf.donations',
    detailType: 'donation.completed',
    occurredAt: '2026-04-27T15:00:00Z',
    summary: 'One-time donation',
    data: { amountCents: 5000 },
    expiresAt: 1234567890
  });
  assert.deepEqual(item, {
    eventId: 'evt-1',
    source: 'ogf.donations',
    detailType: 'donation.completed',
    occurredAt: '2026-04-27T15:00:00Z',
    summary: 'One-time donation',
    data: { amountCents: 5000 }
  });

  // toActivityItem fills nullable defaults
  const sparse = toActivityItem({ eventId: 'e', source: 's', detailType: 'd', occurredAt: 't' });
  assert.equal(sparse.summary, null);
  assert.deepEqual(sparse.data, {});

  // buildActivityQueryParams shape
  const baseParams = buildActivityQueryParams({ tableName: 'tbl' });
  assert.equal(baseParams.TableName, 'tbl');
  assert.equal(baseParams.KeyConditionExpression, 'pk = :pk');
  assert.deepEqual(baseParams.ExpressionAttributeValues, { ':pk': 'ACTIVITY' });
  assert.equal(baseParams.ScanIndexForward, false);
  assert.equal(baseParams.Limit, 25);
  assert.equal(baseParams.ExclusiveStartKey, undefined);
  assert.equal(baseParams.FilterExpression, undefined);

  // buildActivityQueryParams with cursor + filter
  const filtered = buildActivityQueryParams({
    tableName: 'tbl',
    cursor,
    limit: 10,
    detailType: 'donation.completed'
  });
  assert.deepEqual(filtered.ExclusiveStartKey, key);
  assert.equal(filtered.Limit, 10);
  assert.equal(filtered.FilterExpression, '#dt = :dt');
  assert.deepEqual(filtered.ExpressionAttributeNames, { '#dt': 'detailType' });
  assert.equal(filtered.ExpressionAttributeValues[':dt'], 'donation.completed');

  // Empty/whitespace detailType is ignored
  const noFilter = buildActivityQueryParams({ tableName: 'tbl', detailType: '   ' });
  assert.equal(noFilter.FilterExpression, undefined);
}

function testFinanceHelpers() {
  // resolveGranularity falls back to month for invalid values
  assert.equal(resolveGranularity('day'), 'day');
  assert.equal(resolveGranularity('week'), 'week');
  assert.equal(resolveGranularity('month'), 'month');
  assert.equal(resolveGranularity('hour'), 'month');
  assert.equal(resolveGranularity(undefined), 'month');

  // parseDateBoundary throws on invalid date strings, returns fallback for empty
  const fallback = new Date('2026-01-01T00:00:00Z');
  assert.equal(parseDateBoundary('', fallback), fallback);
  assert.equal(parseDateBoundary(null, fallback), fallback);
  assert.equal(parseDateBoundary('2026-04-01T00:00:00Z', fallback).toISOString(), '2026-04-01T00:00:00.000Z');
  assert.throws(() => parseDateBoundary('not-a-date', fallback), /Invalid date/);

  // defaultRange spans 6 months ending now
  const now = new Date('2026-04-27T15:00:00Z');
  const range = defaultRange(now);
  assert.equal(range.to.toISOString(), '2026-04-27T15:00:00.000Z');
  assert.equal(range.from.toISOString(), '2025-10-27T00:00:00.000Z');
}

function testAggregateRevenue() {
  // empty inputs produce empty result with zero totals
  const empty = aggregateRevenue();
  assert.deepEqual(empty.totals, {
    totalCents: 0,
    donationOneTimeCents: 0,
    donationRecurringCents: 0,
    merchandiseCents: 0
  });
  assert.deepEqual(empty.buckets, []);

  // donation_mode splits one-time vs recurring; merch rows merge into the
  // same bucket as donations on the same period_start; totals roll up.
  const result = aggregateRevenue({
    donationRows: [
      { period_start: '2026-03-01T00:00:00Z', donation_mode: 'one_time', cents: 5000 },
      { period_start: '2026-03-01T00:00:00Z', donation_mode: 'recurring', cents: 1500 },
      { period_start: '2026-04-01T00:00:00Z', donation_mode: 'one_time', cents: 2500 },
      { period_start: '2026-04-01T00:00:00Z', donation_mode: 'recurring', cents: 0 } // skipped
    ],
    merchRows: [
      { period_start: '2026-03-01T00:00:00Z', cents: 4000 },
      { period_start: '2026-05-01T00:00:00Z', cents: 1200 }
    ]
  });

  assert.deepEqual(result.totals, {
    totalCents: 5000 + 1500 + 2500 + 4000 + 1200,
    donationOneTimeCents: 5000 + 2500,
    donationRecurringCents: 1500,
    merchandiseCents: 4000 + 1200
  });

  // Buckets ordered by periodStart ascending
  const periods = result.buckets.map((b) => b.periodStart);
  assert.deepEqual(periods, [
    '2026-03-01T00:00:00.000Z',
    '2026-04-01T00:00:00.000Z',
    '2026-05-01T00:00:00.000Z'
  ]);

  // March bucket merges donations + merch on the same date
  const march = result.buckets[0];
  assert.equal(march.donationOneTimeCents, 5000);
  assert.equal(march.donationRecurringCents, 1500);
  assert.equal(march.merchandiseCents, 4000);
  assert.equal(march.totalCents, 5000 + 1500 + 4000);

  // May bucket has merch only, no donations
  const may = result.buckets[2];
  assert.equal(may.donationOneTimeCents, 0);
  assert.equal(may.donationRecurringCents, 0);
  assert.equal(may.merchandiseCents, 1200);
  assert.equal(may.totalCents, 1200);
}

async function testGetRevenueSummary() {
  // End-to-end: stub queryFn, assert the query is parameterised correctly
  // and the response wraps the aggregated buckets.
  const calls = [];
  const queryFn = async (sql, params) => {
    calls.push({ sql: sql.trim(), params });
    if (/donation_events/.test(sql)) {
      return {
        rows: [
          { period_start: '2026-04-01T00:00:00Z', donation_mode: 'one_time', cents: '5000' }
        ]
      };
    }
    return {
      rows: [
        { period_start: '2026-04-01T00:00:00Z', cents: '2500' }
      ]
    };
  };

  const result = await getRevenueSummary({
    from: '2026-04-01T00:00:00Z',
    to: '2026-04-30T00:00:00Z',
    granularity: 'week',
    queryFn
  });

  assert.equal(calls.length, 2);
  // Both queries get the from/to/granularity parameters in slots 1, 2, 3
  for (const { params } of calls) {
    assert.equal(params[0].toISOString(), '2026-04-01T00:00:00.000Z');
    assert.equal(params[1].toISOString(), '2026-04-30T00:00:00.000Z');
    assert.equal(params[2], 'week');
  }
  assert.equal(result.range.granularity, 'week');
  assert.equal(result.range.from, '2026-04-01T00:00:00.000Z');
  assert.equal(result.range.to, '2026-04-30T00:00:00.000Z');
  assert.equal(result.totals.totalCents, 7500);
  assert.equal(result.totals.donationOneTimeCents, 5000);
  assert.equal(result.totals.merchandiseCents, 2500);
  assert.equal(result.buckets.length, 1);
}

await testAuthorizer();
testAuthAndHttpHelpers();
testActivityHelpers();
testFinanceHelpers();
testAggregateRevenue();
await testGetRevenueSummary();
await testStoreHelpers();
console.log('admin api tests passed');
