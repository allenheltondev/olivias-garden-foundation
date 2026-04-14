import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fuzzCoordinates } from '../../src/services/privacy-fuzzing.mjs';

// ─── Mocks ──────────────────────────────────────────────────────────────────

let queryResponses: Record<string, any>;

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
      requestId: 'req-okra',
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
  };
}

// ─── Fixtures ───────────────────────────────────────────────────────────────

const UUID_1 = '550e8400-e29b-41d4-a716-446655440001';
const UUID_2 = '550e8400-e29b-41d4-a716-446655440002';

function makeApprovedRow(overrides: Record<string, any> = {}) {
  return {
    id: UUID_1,
    contributor_name: 'Alice',
    story_text: 'Found okra here',
    privacy_mode: 'exact',
    display_lat: 34.05,
    display_lng: -118.24,
    ...overrides,
  };
}

function setupOkraMocks(submissionRows: any[] = [], photoRows: any[] = []) {
  queryResponses = {
    'FROM submissions': { rows: submissionRows, rowCount: submissionRows.length },
    'FROM submission_photos': { rows: photoRows, rowCount: photoRows.length },
  };
}

// ─── Setup / Teardown ───────────────────────────────────────────────────────

beforeEach(() => {
  process.env.MEDIA_CDN_DOMAIN = 'dtest123.cloudfront.net';
  queryResponses = {};
  vi.clearAllMocks();
});

afterEach(() => {
  delete process.env.MEDIA_CDN_DOMAIN;
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /okra — Empty result (Requirement 2.4)
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /okra — empty result', () => {
  it('returns empty data array and total_count 0 when no approved submissions exist', async () => {
    setupOkraMocks([], []);
    const res = await handler(makeRestApiEvent('/okra'));
    const { statusCode, body } = parseRes(res);

    expect(statusCode).toBe(200);
    expect(body.data).toEqual([]);
    expect(body.total_count).toBe(0);
    // No cursor field in the new unpaginated response
    expect(body).not.toHaveProperty('cursor');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /okra — Cache-Control header (Requirement 2.6)
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /okra — Cache-Control header', () => {
  it('sets Cache-Control: public, max-age=300, stale-while-revalidate=60', async () => {
    setupOkraMocks([], []);
    const res = await handler(makeRestApiEvent('/okra'));
    const { statusCode } = parseRes(res);

    expect(statusCode).toBe(200);
    // Powertools router splits comma-separated header values into multiValueHeaders array
    const cacheValues = res.multiValueHeaders?.['cache-control'];
    expect(cacheValues).toBeDefined();
    const joined = cacheValues.join(', ');
    expect(joined).toBe('public, max-age=300, stale-while-revalidate=60');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /okra — total_count matches data.length (Requirement 2.5)
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /okra — total_count matches data.length', () => {
  it('total_count equals the number of items in data array', async () => {
    const rows = [
      makeApprovedRow({ id: UUID_1 }),
      makeApprovedRow({ id: UUID_2, display_lat: 40.0, display_lng: -74.0 }),
    ];
    setupOkraMocks(rows, []);

    const res = await handler(makeRestApiEvent('/okra'));
    const { statusCode, body } = parseRes(res);

    expect(statusCode).toBe(200);
    expect(body.total_count).toBe(body.data.length);
    expect(body.total_count).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /okra — Missing MEDIA_CDN_DOMAIN returns empty photo_urls (Requirement 2.1)
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /okra — MEDIA_CDN_DOMAIN not set', () => {
  it('returns empty photo_urls for all submissions when MEDIA_CDN_DOMAIN is missing', async () => {
    delete process.env.MEDIA_CDN_DOMAIN;
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const row = makeApprovedRow();
    const photoRows = [
      { submission_id: UUID_1, thumbnail_s3_key: 'submissions/abc/thumb.webp' },
    ];
    setupOkraMocks([row], photoRows);

    const res = await handler(makeRestApiEvent('/okra'));
    const { statusCode, body } = parseRes(res);

    expect(statusCode).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].photo_urls).toEqual([]);

    // Verify warning was logged
    expect(consoleSpy).toHaveBeenCalled();
    const loggedMsg = consoleSpy.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('MEDIA_CDN_DOMAIN')
    );
    expect(loggedMsg).toBeDefined();

    consoleSpy.mockRestore();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /okra — 500 on database failure
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /okra — database error handling', () => {
  it('returns 500 INTERNAL_ERROR on database failure', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    queryResponses = {
      'FROM submissions': () => { throw new Error('Connection refused: ECONNREFUSED'); },
    };

    const res = await handler(makeRestApiEvent('/okra'));
    const { statusCode, body } = parseRes(res);

    expect(statusCode).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('An unexpected error occurred');
    // Should not leak internal error details
    expect(body.error.message).not.toContain('ECONNREFUSED');

    consoleSpy.mockRestore();
  });
});
