import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockResolveOptionalContributor,
  mockCreateSeedRequest,
  mockNotifySeedRequestSlack,
  mockEnforceRateLimit,
  mockMakeIdempotent
} = vi.hoisted(() => ({
  mockResolveOptionalContributor: vi.fn(),
  mockCreateSeedRequest: vi.fn(),
  mockNotifySeedRequestSlack: vi.fn(),
  mockEnforceRateLimit: vi.fn(),
  mockMakeIdempotent: vi.fn((fn: (...args: unknown[]) => unknown) => fn)
}));

vi.mock('../../src/services/auth.mjs', async () => {
  const actual = await vi.importActual('../../src/services/auth.mjs');
  return {
    ...actual,
    resolveOptionalContributor: mockResolveOptionalContributor
  };
});

vi.mock('../../src/services/seed-requests.mjs', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/seed-requests.mjs')>(
    '../../src/services/seed-requests.mjs'
  );
  return {
    ...actual,
    createSeedRequest: mockCreateSeedRequest,
    notifySeedRequestSlack: mockNotifySeedRequestSlack,
    enforceSeedRequestRateLimit: mockEnforceRateLimit
  };
});

vi.mock('@aws-lambda-powertools/idempotency', async () => {
  const actual = await vi.importActual<typeof import('@aws-lambda-powertools/idempotency')>(
    '@aws-lambda-powertools/idempotency'
  );
  return {
    ...actual,
    makeIdempotent: mockMakeIdempotent
  };
});

vi.mock('@aws-lambda-powertools/idempotency/dynamodb', () => ({
  DynamoDBPersistenceLayer: vi.fn().mockImplementation(() => ({}))
}));

import { handler } from '../../src/handlers/api.mjs';

function makeRestApiEvent(path: string, method = 'POST', body: string | null = null, headers: Record<string, string> = {}) {
  return {
    resource: '/{proxy+}',
    path,
    httpMethod: method,
    headers: {
      'content-type': 'application/json',
      ...headers
    },
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    requestContext: {
      requestId: 'req-seed',
      path,
      stage: 'api',
      identity: {
        sourceIp: '203.0.113.5',
        userAgent: 'vitest'
      }
    },
    body,
    isBase64Encoded: false
  };
}

const mailPayload = {
  name: 'Olivia Helton',
  email: 'olivia@example.com',
  fulfillmentMethod: 'mail',
  shippingAddress: {
    line1: '100 Garden Lane',
    city: 'Austin',
    region: 'TX',
    postalCode: '73301',
    country: 'US'
  }
};

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveOptionalContributor.mockResolvedValue({ ok: true, contributor: null });
  mockCreateSeedRequest.mockResolvedValue({
    requestId: 'req-uuid-1',
    createdAt: '2026-04-21T12:00:00.000Z'
  });
  mockNotifySeedRequestSlack.mockResolvedValue(undefined);
  mockEnforceRateLimit.mockResolvedValue(undefined);
});

describe('POST /requests', () => {
  it('returns 400 when Idempotency-Key header is missing', async () => {
    const res = await handler(makeRestApiEvent('/requests', 'POST', JSON.stringify(mailPayload)));

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(String(res.body)).error).toBe('MissingIdempotencyKey');
    expect(mockCreateSeedRequest).not.toHaveBeenCalled();
  });

  it('returns 422 when required fields are missing from the payload', async () => {
    const res = await handler(
      makeRestApiEvent('/requests', 'POST', JSON.stringify({ name: 'Olivia' }), {
        'Idempotency-Key': 'k-1'
      })
    );

    expect(res.statusCode).toBe(422);
    expect(JSON.parse(String(res.body)).error).toBe('RequestValidationError');
    expect(mockCreateSeedRequest).not.toHaveBeenCalled();
  });

  it('returns 422 when mail fulfillment is missing shipping address fields', async () => {
    const payload = { ...mailPayload, shippingAddress: { ...mailPayload.shippingAddress, postalCode: '' } };
    const res = await handler(
      makeRestApiEvent('/requests', 'POST', JSON.stringify(payload), { 'Idempotency-Key': 'k-2' })
    );

    expect(res.statusCode).toBe(422);
    const body = JSON.parse(String(res.body));
    expect(body.message).toMatch(/postalCode/);
    expect(mockCreateSeedRequest).not.toHaveBeenCalled();
  });

  it('returns 422 when shipping country is outside US/CA', async () => {
    const payload = { ...mailPayload, shippingAddress: { ...mailPayload.shippingAddress, country: 'GB' } };
    const res = await handler(
      makeRestApiEvent('/requests', 'POST', JSON.stringify(payload), { 'Idempotency-Key': 'k-3' })
    );

    expect(res.statusCode).toBe(422);
    expect(mockCreateSeedRequest).not.toHaveBeenCalled();
  });

  it('returns 429 when rate limit is exceeded', async () => {
    mockEnforceRateLimit.mockRejectedValueOnce(
      Object.assign(new Error('too fast'), {
        code: 'SEED_REQUEST_RATE_LIMITED',
        retryAfterSeconds: 3600
      })
    );

    const res = await handler(
      makeRestApiEvent('/requests', 'POST', JSON.stringify(mailPayload), {
        'Idempotency-Key': 'k-4'
      })
    );

    expect(res.statusCode).toBe(429);
    const body = JSON.parse(String(res.body));
    expect(body.error).toBe('RateLimitExceeded');
    expect(body.retryAfterSeconds).toBe(3600);
    expect(mockCreateSeedRequest).not.toHaveBeenCalled();
  });

  it('enforces the rate limit inside the idempotent wrapper', async () => {
    // With our passthrough mock of makeIdempotent, the wrapper's body runs on
    // every call. Asserting both rate-limit and create were called proves the
    // check happens inside the wrapped function, not on the outer route.
    await handler(
      makeRestApiEvent('/requests', 'POST', JSON.stringify(mailPayload), {
        'Idempotency-Key': 'k-inside'
      })
    );

    expect(mockEnforceRateLimit).toHaveBeenCalledWith('203.0.113.5');
    expect(mockCreateSeedRequest).toHaveBeenCalledOnce();
    const enforceOrder = mockEnforceRateLimit.mock.invocationCallOrder[0];
    const createOrder = mockCreateSeedRequest.mock.invocationCallOrder[0];
    expect(enforceOrder).toBeLessThan(createOrder);
  });

  it('creates a mail request and returns 201 with requestId', async () => {
    const res = await handler(
      makeRestApiEvent('/requests', 'POST', JSON.stringify(mailPayload), {
        'Idempotency-Key': 'k-5'
      })
    );

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(String(res.body));
    expect(body.requestId).toBe('req-uuid-1');
    expect(mockEnforceRateLimit).toHaveBeenCalledWith('203.0.113.5');
    expect(mockCreateSeedRequest).toHaveBeenCalledOnce();
    expect(mockNotifySeedRequestSlack).toHaveBeenCalledOnce();
  });

  it('accepts an in-person request without a shipping address', async () => {
    const payload = {
      name: 'Visiting Friend',
      email: 'friend@example.com',
      fulfillmentMethod: 'in_person',
      visitDetails: { approximateDate: 'next spring' }
    };

    const res = await handler(
      makeRestApiEvent('/requests', 'POST', JSON.stringify(payload), {
        'Idempotency-Key': 'k-6'
      })
    );

    expect(res.statusCode).toBe(201);
    expect(mockCreateSeedRequest).toHaveBeenCalledOnce();
  });

  it('passes the authenticated contributor when a valid bearer token is provided', async () => {
    mockResolveOptionalContributor.mockResolvedValueOnce({
      ok: true,
      contributor: { sub: 'cog-abc', email: 'olivia@example.com', name: 'Olivia' }
    });

    await handler(
      makeRestApiEvent('/requests', 'POST', JSON.stringify(mailPayload), {
        'Idempotency-Key': 'k-7',
        Authorization: 'Bearer valid'
      })
    );

    const [, contributor] = mockCreateSeedRequest.mock.calls[0];
    expect(contributor).toEqual({ sub: 'cog-abc', email: 'olivia@example.com', name: 'Olivia' });
  });
});
