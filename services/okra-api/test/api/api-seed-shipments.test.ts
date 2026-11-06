import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────────────

let queryResponses: Record<string, any>;
const mockDynamoSend = vi.hoisted(() => vi.fn());

const mockClient = {
  connect: vi.fn(),
  query: vi.fn((text: string, _params?: any[]) => {
    for (const [pattern, response] of Object.entries(queryResponses)) {
      if (text.includes(pattern)) {
        if (typeof response === 'function') return response(text, _params);
        return response;
      }
    }
    return { rows: [], rowCount: 0 };
  }),
  end: vi.fn(),
};

vi.mock('../../scripts/db-client.mjs', () => ({
  createDbClient: vi.fn(() => mockClient),
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(() => ({})),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: vi.fn(() => ({ send: mockDynamoSend })),
  },
  GetCommand: vi.fn((input: any) => ({ input, _type: 'GetCommand' })),
  TransactWriteCommand: vi.fn((input: any) => ({ input, _type: 'TransactWriteCommand' })),
  UpdateCommand: vi.fn((input: any) => ({ input, _type: 'UpdateCommand' })),
}));

import { handler } from '../../src/handlers/api.mjs';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeRestApiEvent(path: string, method = 'GET') {
  return {
    resource: '/{proxy+}',
    path,
    httpMethod: method,
    headers: {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    requestContext: {
      requestId: 'req-stats',
      path,
      stage: 'api',
      identity: { sourceIp: '127.0.0.1', userAgent: 'vitest' },
    },
    body: null,
    isBase64Encoded: false,
  };
}

function parseRes(res: any) {
  return {
    statusCode: res.statusCode,
    body: JSON.parse(res.body),
    headers: res.headers ?? {},
    multiValueHeaders: res.multiValueHeaders ?? {},
  };
}

// ─── Setup / Teardown ───────────────────────────────────────────────────────

beforeEach(() => {
  process.env.SEED_REQUESTS_TABLE_NAME = 'test-seed-requests';
  queryResponses = {};
  vi.clearAllMocks();
  mockDynamoSend.mockResolvedValue({ Item: { count: 12 } });
});

afterEach(() => {
  delete process.env.SEED_REQUESTS_TABLE_NAME;
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /okra/seed-shipments — public "seeds sent" pins
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /okra/seed-shipments', () => {
  it('returns only public-safe fields with fuzzed coordinates and month precision', async () => {
    queryResponses['FROM seed_shipment_pins'] = {
      rows: [
        {
          request_id: '33333333-3333-3333-3333-333333333333',
          first_name: 'Jane',
          locality: 'Austin, TX',
          country: 'US',
          display_lat: 30.27,
          display_lng: -97.74,
          sent_at: new Date('2026-10-15T12:00:00Z'),
        },
      ],
    };

    const { statusCode, body, multiValueHeaders } = parseRes(await handler(makeRestApiEvent('/okra/seed-shipments')));

    expect(statusCode).toBe(200);
    expect(multiValueHeaders['cache-control'].join(', ')).toBe('public, max-age=300, stale-while-revalidate=60');
    expect(body.total_count).toBe(1);
    const [pin] = body.data;
    expect(Object.keys(pin).sort()).toEqual(
      ['country', 'display_lat', 'display_lng', 'first_name', 'id', 'locality', 'sent_month'].sort()
    );
    expect(pin.first_name).toBe('Jane');
    expect(pin.locality).toBe('Austin, TX');
    expect(pin.sent_month).toBe('2026-10');
    // Internal request id is not exposed
    expect(pin.id).not.toContain('3333');
    expect(pin.id).toMatch(/^seeds-[0-9a-f]{16}$/);
    // Fuzzed, but stays within city radius
    expect(Math.abs(pin.display_lat - 30.27)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(pin.display_lng + 97.74)).toBeLessThanOrEqual(0.05);
    expect(pin.display_lat !== 30.27 || pin.display_lng !== -97.74).toBe(true);
  });

  it('is deterministic across requests', async () => {
    queryResponses['FROM seed_shipment_pins'] = {
      rows: [{
        request_id: 'abc', first_name: 'Sam', locality: 'Toronto, ON', country: 'CA',
        display_lat: 43.65, display_lng: -79.38, sent_at: '2026-09-01T00:00:00.000Z',
      }],
    };
    const first = parseRes(await handler(makeRestApiEvent('/okra/seed-shipments'))).body.data[0];
    const second = parseRes(await handler(makeRestApiEvent('/okra/seed-shipments'))).body.data[0];
    expect(second).toEqual(first);
  });

  it('returns an empty list when nothing has been sent', async () => {
    const { statusCode, body } = parseRes(await handler(makeRestApiEvent('/okra/seed-shipments')));
    expect(statusCode).toBe(200);
    expect(body).toEqual({ total_count: 0, data: [] });
  });

  it('returns 500 with a consistent error shape when the query fails', async () => {
    queryResponses['FROM seed_shipment_pins'] = () => { throw new Error('db down'); };
    const { statusCode, body } = parseRes(await handler(makeRestApiEvent('/okra/seed-shipments')));
    expect(statusCode).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(mockClient.end).toHaveBeenCalled();
  });
});
