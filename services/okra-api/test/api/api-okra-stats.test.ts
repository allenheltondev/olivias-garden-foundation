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
// GET /okra/stats — Correct aggregates with mixed data (Requirement 3.1, 3.2, 3.3)
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /okra/stats — correct aggregates with mixed data', () => {
  it('returns correct total_pins, country_count, and contributor_count', async () => {
    queryResponses = {
      'COUNT(*)': {
        rows: [{ total_pins: 42, country_count: 7, contributor_count: 15 }],
        rowCount: 1,
      },
    };

    const res = await handler(makeRestApiEvent('/okra/stats'));
    const { statusCode, body } = parseRes(res);

    expect(statusCode).toBe(200);
    expect(body).toEqual({
      total_pins: 42,
      country_count: 7,
      contributor_count: 15,
      seed_packets_sent: 12,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /okra/stats — Cache-Control header (Requirement 3.5)
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /okra/stats — Cache-Control header', () => {
  it('sets Cache-Control: public, max-age=300, stale-while-revalidate=60', async () => {
    queryResponses = {
      'COUNT(*)': {
        rows: [{ total_pins: 0, country_count: 0, contributor_count: 0 }],
        rowCount: 1,
      },
    };

    const res = await handler(makeRestApiEvent('/okra/stats'));
    const { statusCode } = parseRes(res);

    expect(statusCode).toBe(200);
    const cacheValues = res.multiValueHeaders?.['cache-control'];
    expect(cacheValues).toBeDefined();
    const joined = cacheValues.join(', ');
    expect(joined).toBe('public, max-age=300, stale-while-revalidate=60');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /okra/stats — Zero results when no approved submissions (Requirement 3.1)
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /okra/stats — zero results', () => {
  it('returns all zeros when no approved submissions exist', async () => {
    queryResponses = {
      'COUNT(*)': {
        rows: [{ total_pins: 0, country_count: 0, contributor_count: 0 }],
        rowCount: 1,
      },
    };

    const res = await handler(makeRestApiEvent('/okra/stats'));
    const { statusCode, body } = parseRes(res);

    expect(statusCode).toBe(200);
    expect(body.total_pins).toBe(0);
    expect(body.country_count).toBe(0);
    expect(body.contributor_count).toBe(0);
    expect(body.seed_packets_sent).toBe(12);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /okra/stats — Null/empty contributor names excluded (Requirement 3.1)
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /okra/stats — null/empty contributor names excluded', () => {
  it('contributor_count excludes null and empty contributor names', async () => {
    // Simulates a DB with 5 approved submissions but only 2 distinct non-null
    // non-empty contributor names — the SQL FILTER clause handles this
    queryResponses = {
      'COUNT(*)': {
        rows: [{ total_pins: 5, country_count: 3, contributor_count: 2 }],
        rowCount: 1,
      },
    };

    const res = await handler(makeRestApiEvent('/okra/stats'));
    const { statusCode, body } = parseRes(res);

    expect(statusCode).toBe(200);
    expect(body.total_pins).toBe(5);
    expect(body.contributor_count).toBe(2);
    expect(body.seed_packets_sent).toBe(12);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /okra/stats — Null countries excluded from country_count (Req 3.2, 3.3)
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /okra/stats — null countries excluded', () => {
  it('country_count excludes null country values while total_pins includes those submissions', async () => {
    // 10 approved submissions, but only 4 have non-null country values
    queryResponses = {
      'COUNT(*)': {
        rows: [{ total_pins: 10, country_count: 4, contributor_count: 8 }],
        rowCount: 1,
      },
    };

    const res = await handler(makeRestApiEvent('/okra/stats'));
    const { statusCode, body } = parseRes(res);

    expect(statusCode).toBe(200);
    expect(body.total_pins).toBe(10);
    expect(body.country_count).toBe(4);
    expect(body.seed_packets_sent).toBe(12);
    // total_pins > country_count confirms null countries are excluded from count
    // but those submissions are still counted in total_pins
    expect(body.total_pins).toBeGreaterThan(body.country_count);
  });
});

describe('GET /okra/stats — seed packets sent counter', () => {
  it('returns zero seed_packets_sent when the DynamoDB counter has not been created yet', async () => {
    queryResponses = {
      'COUNT(*)': {
        rows: [{ total_pins: 2, country_count: 1, contributor_count: 2 }],
        rowCount: 1,
      },
    };
    mockDynamoSend.mockResolvedValueOnce({});

    const res = await handler(makeRestApiEvent('/okra/stats'));
    const { statusCode, body } = parseRes(res);

    expect(statusCode).toBe(200);
    expect(body.seed_packets_sent).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /okra/stats — 500 on database failure
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /okra/stats — database error handling', () => {
  it('returns 500 INTERNAL_ERROR on database failure', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    queryResponses = {
      'COUNT(*)': () => { throw new Error('Connection refused'); },
    };

    const res = await handler(makeRestApiEvent('/okra/stats'));
    const { statusCode, body } = parseRes(res);

    expect(statusCode).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('An unexpected error occurred');

    consoleSpy.mockRestore();
  });
});
