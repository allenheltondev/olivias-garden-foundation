import { afterEach, describe, expect, it, vi } from 'vitest';
import { handler } from '../src/handlers/api.mjs';

function createApiGatewayEvent({ method, path, body, queryStringParameters }) {
  return {
    version: '2.0',
    routeKey: `${method} ${path}`,
    rawPath: path,
    rawQueryString: new URLSearchParams(queryStringParameters ?? {}).toString(),
    headers: {},
    queryStringParameters,
    requestContext: {
      accountId: '123456789012',
      apiId: 'api-id',
      domainName: 'example.execute-api.us-east-1.amazonaws.com',
      domainPrefix: 'example',
      http: {
        method,
        path,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'vitest'
      },
      requestId: 'request-id',
      routeKey: `${method} ${path}`,
      stage: '$default',
      time: '20/Apr/2026:11:00:00 +0000',
      timeEpoch: 1776682800000
    },
    isBase64Encoded: false,
    body: body === undefined ? undefined : JSON.stringify(body)
  };
}

describe('web-api donation handler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.OGF_USER_POOL_ID;
    delete process.env.OGF_USER_POOL_CLIENT_ID;
  });

  it('returns 422 for invalid donation amount', async () => {
    const response = await handler(createApiGatewayEvent({
      method: 'POST',
      path: '/donations/checkout-session',
      body: {
        mode: 'one_time',
        amountCents: 100,
        returnUrl: 'https://example.com/donate?session_id={CHECKOUT_SESSION_ID}'
      }
    }));

    expect(response.statusCode).toBe(422);
    expect(JSON.parse(response.body)).toEqual({
      error: 'RequestValidationError',
      message: 'Validation failed for request',
      details: {
        issues: ['Schema validation failed']
      }
    });
  });

  it('creates a Stripe checkout session when payload is valid', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'cs_test_123', client_secret: 'cs_test_123_secret_456' })
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await handler(createApiGatewayEvent({
      method: 'POST',
      path: '/donations/checkout-session',
      body: {
        mode: 'one_time',
        amountCents: 2500,
        returnUrl: 'https://example.com/donate?session_id={CHECKOUT_SESSION_ID}',
        donorName: 'Olivia Garden Donor'
      }
    }));

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      clientSecret: 'cs_test_123_secret_456',
      checkoutSessionId: 'cs_test_123'
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('returns checkout session status for embedded completion handling', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'cs_test_123',
        status: 'complete',
        payment_status: 'paid',
        customer_email: 'donor@example.com'
      })
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await handler(createApiGatewayEvent({
      method: 'GET',
      path: '/donations/checkout-session-status',
      queryStringParameters: {
        session_id: 'cs_test_123'
      }
    }));

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      sessionId: 'cs_test_123',
      status: 'complete',
      paymentStatus: 'paid',
      customerEmail: 'donor@example.com'
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
