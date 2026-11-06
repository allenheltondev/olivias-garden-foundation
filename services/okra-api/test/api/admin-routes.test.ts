import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────────────

let queryResponses: Record<string, any>;
let scanResponses: any[];
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

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(() => Promise.resolve('https://s3.example.com/signed-url')),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(() => ({})),
  GetObjectCommand: vi.fn((params: any) => params),
}));

const mockEventBridgeSend = vi.hoisted(() => vi.fn(() => Promise.resolve({})));

vi.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: vi.fn(() => ({ send: mockEventBridgeSend })),
  PutEventsCommand: vi.fn((params: any) => ({ _params: params, _type: 'PutEventsCommand' })),
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(() => ({})),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: vi.fn(() => ({ send: mockDynamoSend })),
  },
  GetCommand: vi.fn((input: any) => ({ input, _type: 'GetCommand' })),
  ScanCommand: vi.fn((input: any) => ({ input, _type: 'ScanCommand' })),
  TransactWriteCommand: vi.fn((input: any) => ({ input, _type: 'TransactWriteCommand' })),
}));

const mockResolveCountry = vi.hoisted(() => vi.fn(() => 'United States'));

vi.mock('../../src/services/reverse-geocoder.mjs', () => ({
  resolveCountry: mockResolveCountry,
}));

import { handler } from '../../src/handlers/admin-api.mjs';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeRestApiEvent(
  path: string,
  method = 'GET',
  options: {
    queryStringParameters?: Record<string, string> | null;
    pathParameters?: Record<string, string> | null;
    body?: any;
    requestContext?: any;
  } = {}
) {
  return {
    resource: '/{proxy+}',
    path,
    httpMethod: method,
    headers: {},
    multiValueHeaders: {},
    queryStringParameters: options.queryStringParameters ?? null,
    multiValueQueryStringParameters: null,
    pathParameters: options.pathParameters ?? null,
    stageVariables: null,
    requestContext: options.requestContext ?? {
      requestId: 'req-test',
      path,
      stage: 'api',
      identity: { sourceIp: '127.0.0.1', userAgent: 'vitest' },
      authorizer: { sub: 'admin-cognito-sub-1' },
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : null,
    isBase64Encoded: false,
  };
}

function parseRes(res: any) {
  return { statusCode: res.statusCode, body: JSON.parse(res.body) };
}

// ─── Fixtures ───────────────────────────────────────────────────────────────

const ADMIN_USER_ROW = { id: 'admin-uuid-1' };

function makeSubmissionRow(overrides: Record<string, any> = {}) {
  return {
    id: '550e8400-e29b-41d4-a716-446655440001',
    contributor_name: 'Alice',
    story_text: 'Found okra here',
    raw_location_text: '123 Main St',
    privacy_mode: 'public',
    display_lat: 34.05,
    display_lng: -118.24,
    status: 'pending_review',
    created_at: new Date('2024-01-15T10:00:00Z'),
    created_at_raw: '2024-01-15 10:00:00.000000+00',
    reviewed_by: null,
    reviewed_at: null,
    review_notes: null,
    ...overrides,
  };
}

function makeApprovedRow(overrides: Record<string, any> = {}) {
  return makeSubmissionRow({
    status: 'approved',
    reviewed_by: 'admin-uuid-1',
    reviewed_at: new Date('2024-01-16T12:00:00Z'),
    ...overrides,
  });
}

function makeDeniedRow(overrides: Record<string, any> = {}) {
  return makeSubmissionRow({
    status: 'denied',
    reviewed_by: 'admin-uuid-1',
    reviewed_at: new Date('2024-01-16T12:00:00Z'),
    ...overrides,
  });
}

// ─── Setup / Teardown ───────────────────────────────────────────────────────

beforeEach(() => {
  process.env.DATABASE_URL = 'postgres://localhost:5432/test';
  process.env.MEDIA_BUCKET_NAME = 'test-media-bucket';
  process.env.SEED_REQUESTS_TABLE_NAME = 'test-seed-requests';
  queryResponses = {};
  scanResponses = [];
  vi.clearAllMocks();
  mockDynamoSend.mockImplementation((command: any) => {
    if (command?._type === 'ScanCommand') {
      return Promise.resolve(scanResponses.shift() ?? { Items: [] });
    }
    if (command?._type === 'TransactWriteCommand') {
      return Promise.resolve({});
    }
    return Promise.resolve({});
  });
});

afterEach(() => {
  delete process.env.DATABASE_URL;
  delete process.env.MEDIA_BUCKET_NAME;
  delete process.env.SEED_REQUESTS_TABLE_NAME;
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /admin/submissions
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /admin/submissions', () => {
  function setupListMocks(submissionRows: any[] = [], photoRows: any[] = []) {
    queryResponses = {
      'FROM submissions': { rows: submissionRows, rowCount: submissionRows.length },
      'FROM submission_photos': { rows: photoRows, rowCount: photoRows.length },
    };
  }

  it('returns every submission when no status filter is supplied (limit=20)', async () => {
    setupListMocks();
    const res = await handler(makeRestApiEvent('/submissions'));
    const { statusCode, body } = parseRes(res);
    expect(statusCode).toBe(200);
    expect(body).toEqual({ data: [], cursor: null, total: 0 });
    const queryCall = mockClient.query.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('FROM submissions s') && c[0].includes('ORDER BY')
    );
    expect(queryCall).toBeDefined();
    expect(queryCall![0]).not.toContain("'pending_review'");
    expect(queryCall![0]).not.toContain('submission_photos');
    expect(queryCall![1]).not.toContain('pending_review');
    expect(queryCall![1]).toContain(21);
  });

  it('maps status=pending to pending_review and requires a ready photo', async () => {
    setupListMocks();
    const res = await handler(
      makeRestApiEvent('/submissions', 'GET', { queryStringParameters: { status: 'pending' } })
    );
    expect(parseRes(res).statusCode).toBe(200);
    const queryCall = mockClient.query.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('FROM submissions s')
    );
    expect(queryCall).toBeDefined();
    expect(queryCall![0]).toMatch(/submission_photos sp/);
    expect(queryCall![0]).toMatch(/sp\.status = 'ready'/);
    expect(queryCall![1]).toContain('pending_review');
  });

  it('does NOT apply the ready-photo filter for status=pending_review', async () => {
    // `pending_review` is the full list of pending rows — the photo filter
    // only kicks in for the `pending` alias, which is the moderation queue.
    // This keeps callers that poll for their own just-created submission
    // (before the photo processor has run) from timing out.
    setupListMocks();
    await handler(
      makeRestApiEvent('/submissions', 'GET', { queryStringParameters: { status: 'pending_review' } })
    );
    const queryCall = mockClient.query.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('FROM submissions s')
    );
    expect(queryCall![0]).not.toMatch(/submission_photos sp/);
    expect(queryCall![1]).toContain('pending_review');
  });

  it('accepts valid status filter: approved', async () => {
    setupListMocks();
    const res = await handler(
      makeRestApiEvent('/submissions', 'GET', { queryStringParameters: { status: 'approved' } })
    );
    expect(parseRes(res).statusCode).toBe(200);
    const queryCall = mockClient.query.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('FROM submissions')
    );
    expect(queryCall![1]).toContain('approved');
  });

  it('accepts valid status filter: denied', async () => {
    setupListMocks();
    const res = await handler(
      makeRestApiEvent('/submissions', 'GET', { queryStringParameters: { status: 'denied' } })
    );
    expect(parseRes(res).statusCode).toBe(200);
  });

  it('returns INVALID_STATUS for bad status value', async () => {
    const res = await handler(
      makeRestApiEvent('/submissions', 'GET', { queryStringParameters: { status: 'bogus' } })
    );
    const { statusCode, body } = parseRes(res);
    expect(statusCode).toBe(400);
    expect(body.error.code).toBe('INVALID_STATUS');
  });

  it('returns INVALID_LIMIT for zero limit', async () => {
    const res = await handler(
      makeRestApiEvent('/submissions', 'GET', { queryStringParameters: { limit: '0' } })
    );
    const { statusCode, body } = parseRes(res);
    expect(statusCode).toBe(400);
    expect(body.error.code).toBe('INVALID_LIMIT');
  });

  it('returns INVALID_LIMIT for negative limit', async () => {
    const res = await handler(
      makeRestApiEvent('/submissions', 'GET', { queryStringParameters: { limit: '-5' } })
    );
    expect(parseRes(res).body.error.code).toBe('INVALID_LIMIT');
  });

  it('returns INVALID_LIMIT for non-numeric limit', async () => {
    const res = await handler(
      makeRestApiEvent('/submissions', 'GET', { queryStringParameters: { limit: 'abc' } })
    );
    expect(parseRes(res).body.error.code).toBe('INVALID_LIMIT');
  });

  it('clamps limit above 100 to 100', async () => {
    setupListMocks();
    await handler(
      makeRestApiEvent('/submissions', 'GET', { queryStringParameters: { limit: '200' } })
    );
    const queryCall = mockClient.query.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('FROM submissions s') && c[0].includes('ORDER BY')
    );
    expect(queryCall![1]).toContain(101);
  });

  it('returns INVALID_CURSOR for malformed cursor', async () => {
    const res = await handler(
      makeRestApiEvent('/submissions', 'GET', { queryStringParameters: { cursor: 'not-valid' } })
    );
    expect(parseRes(res).body.error.code).toBe('INVALID_CURSOR');
  });

  it('returns empty result set as { data: [], cursor: null }', async () => {
    setupListMocks([], []);
    const { body } = parseRes(await handler(makeRestApiEvent('/submissions')));
    expect(body.data).toEqual([]);
    expect(body.cursor).toBeNull();
  });

  it('returns response with all required fields', async () => {
    setupListMocks([makeSubmissionRow()], [{ submission_id: '550e8400-e29b-41d4-a716-446655440001', original_s3_key: 'photos/abc.jpg' }]);
    const { body } = parseRes(await handler(makeRestApiEvent('/submissions')));
    expect(body.data).toHaveLength(1);
    const item = body.data[0];
    for (const field of ['id','contributor_name','story_text','raw_location_text','privacy_mode','display_lat','display_lng','status','created_at','photo_count','has_photos','photos']) {
      expect(item).toHaveProperty(field);
    }
    expect(item.photo_count).toBe(1);
    expect(item.has_photos).toBe(true);
  });

  it('cursor is null on last page', async () => {
    setupListMocks([makeSubmissionRow()], []);
    const { body } = parseRes(await handler(makeRestApiEvent('/submissions')));
    expect(body.cursor).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /admin/submissions/:id/statuses — status field validation
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /admin/submissions/:id/statuses — status field validation', () => {
  it('returns INVALID_ID for non-UUID submission ID', async () => {
    const res = await handler(
      makeRestApiEvent('/submissions/not-a-uuid/statuses', 'POST', {
        pathParameters: { id: 'not-a-uuid' }, body: { status: 'approved' },
      })
    );
    const { statusCode, body } = parseRes(res);
    expect(statusCode).toBe(400);
    expect(body.error.code).toBe('INVALID_ID');
  });

  it('returns INVALID_ACTION for missing status field', async () => {
    const res = await handler(
      makeRestApiEvent('/submissions/550e8400-e29b-41d4-a716-446655440001/statuses', 'POST', {
        pathParameters: { id: '550e8400-e29b-41d4-a716-446655440001' }, body: {},
      })
    );
    const { statusCode, body } = parseRes(res);
    expect(statusCode).toBe(400);
    expect(body.error.code).toBe('INVALID_ACTION');
  });

  it('returns INVALID_ACTION for invalid status value', async () => {
    const res = await handler(
      makeRestApiEvent('/submissions/550e8400-e29b-41d4-a716-446655440001/statuses', 'POST', {
        pathParameters: { id: '550e8400-e29b-41d4-a716-446655440001' }, body: { status: 'pending_review' },
      })
    );
    expect(parseRes(res).body.error.code).toBe('INVALID_ACTION');
  });

  it('returns INVALID_ACTION for empty string status', async () => {
    const res = await handler(
      makeRestApiEvent('/submissions/550e8400-e29b-41d4-a716-446655440001/statuses', 'POST', {
        pathParameters: { id: '550e8400-e29b-41d4-a716-446655440001' }, body: { status: '' },
      })
    );
    expect(parseRes(res).body.error.code).toBe('INVALID_ACTION');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /admin/submissions/:id/statuses — approval
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /admin/submissions/:id/statuses — approval', () => {
  function setupApproveMocks(overrides: Record<string, any> = {}) {
    const approvedRow = makeApprovedRow(overrides);
    queryResponses = {
      'SELECT id, status FROM submissions': { rows: [{ id: '550e8400-e29b-41d4-a716-446655440001', status: 'pending_review' }] },
      'COUNT(*)': { rows: [{ count: 2 }] },
      'admin_users': { rows: [ADMIN_USER_ROW] },
      'BEGIN': { rows: [] },
      'UPDATE submissions': { rows: [approvedRow], rowCount: 1 },
      'INSERT INTO submission_reviews': { rows: [] },
      'COMMIT': { rows: [] },
    };
  }

  it('returns 200 with updated submission on successful approval', async () => {
    setupApproveMocks();
    const { statusCode, body } = parseRes(await handler(
      makeRestApiEvent('/submissions/550e8400-e29b-41d4-a716-446655440001/statuses', 'POST', {
        pathParameters: { id: '550e8400-e29b-41d4-a716-446655440001' }, body: { status: 'approved' },
      })
    ));
    expect(statusCode).toBe(200);
    expect(body.id).toBe('550e8400-e29b-41d4-a716-446655440001');
    expect(body.status).toBe('approved');
  });

  it('returns INVALID_COORDINATES for partial coordinates (lat only)', async () => {
    const { body } = parseRes(await handler(
      makeRestApiEvent('/submissions/550e8400-e29b-41d4-a716-446655440001/statuses', 'POST', {
        pathParameters: { id: '550e8400-e29b-41d4-a716-446655440001' }, body: { status: 'approved', display_lat: 34.05 },
      })
    ));
    expect(body.error.code).toBe('INVALID_COORDINATES');
  });

  it('returns INVALID_COORDINATES for partial coordinates (lng only)', async () => {
    const { body } = parseRes(await handler(
      makeRestApiEvent('/submissions/550e8400-e29b-41d4-a716-446655440001/statuses', 'POST', {
        pathParameters: { id: '550e8400-e29b-41d4-a716-446655440001' }, body: { status: 'approved', display_lng: -118.24 },
      })
    ));
    expect(body.error.code).toBe('INVALID_COORDINATES');
  });

  it('returns INVALID_COORDINATES for out-of-bounds lat', async () => {
    const { body } = parseRes(await handler(
      makeRestApiEvent('/submissions/550e8400-e29b-41d4-a716-446655440001/statuses', 'POST', {
        pathParameters: { id: '550e8400-e29b-41d4-a716-446655440001' }, body: { status: 'approved', display_lat: 91, display_lng: 0 },
      })
    ));
    expect(body.error.code).toBe('INVALID_COORDINATES');
  });

  it('returns INVALID_COORDINATES for out-of-bounds lng', async () => {
    const { body } = parseRes(await handler(
      makeRestApiEvent('/submissions/550e8400-e29b-41d4-a716-446655440001/statuses', 'POST', {
        pathParameters: { id: '550e8400-e29b-41d4-a716-446655440001' }, body: { status: 'approved', display_lat: 0, display_lng: -181 },
      })
    ));
    expect(body.error.code).toBe('INVALID_COORDINATES');
  });

  it('returns MISSING_PHOTOS when submission has zero photos', async () => {
    queryResponses = {
      'SELECT id, status FROM submissions': { rows: [{ id: '550e8400-e29b-41d4-a716-446655440001', status: 'pending_review' }] },
      'COUNT(*)': { rows: [{ count: 0 }] },
    };
    const { body } = parseRes(await handler(
      makeRestApiEvent('/submissions/550e8400-e29b-41d4-a716-446655440001/statuses', 'POST', {
        pathParameters: { id: '550e8400-e29b-41d4-a716-446655440001' }, body: { status: 'approved' },
      })
    ));
    expect(body.error.code).toBe('MISSING_PHOTOS');
  });

  it('returns NOT_FOUND for non-existent submission', async () => {
    queryResponses = {
      'SELECT id, status FROM submissions': { rows: [] },
    };
    const { body } = parseRes(await handler(
      makeRestApiEvent('/submissions/550e8400-e29b-41d4-a716-446655440001/statuses', 'POST', {
        pathParameters: { id: '550e8400-e29b-41d4-a716-446655440001' }, body: { status: 'approved' },
      })
    ));
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('returns INVALID_STATE for already-reviewed submission', async () => {
    queryResponses = {
      'SELECT id, status FROM submissions': { rows: [{ id: '550e8400-e29b-41d4-a716-446655440001', status: 'approved' }] },
    };
    const { body } = parseRes(await handler(
      makeRestApiEvent('/submissions/550e8400-e29b-41d4-a716-446655440001/statuses', 'POST', {
        pathParameters: { id: '550e8400-e29b-41d4-a716-446655440001' }, body: { status: 'approved' },
      })
    ));
    expect(body.error.code).toBe('INVALID_STATE');
  });

  it('updates coordinates when pin adjustment is provided', async () => {
    setupApproveMocks({ display_lat: 40.0, display_lng: -74.0 });
    const { body } = parseRes(await handler(
      makeRestApiEvent('/submissions/550e8400-e29b-41d4-a716-446655440001/statuses', 'POST', {
        pathParameters: { id: '550e8400-e29b-41d4-a716-446655440001' }, body: { status: 'approved', display_lat: 40.0, display_lng: -74.0 },
      })
    ));
    expect(body.display_lat).toBe(40.0);
    expect(body.display_lng).toBe(-74.0);
    const updateCall = mockClient.query.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('UPDATE submissions')
    );
    expect(updateCall![0]).toContain('display_lat');
  });

  it('stores review_notes correctly', async () => {
    setupApproveMocks({ review_notes: 'Looks good!' });
    const { body } = parseRes(await handler(
      makeRestApiEvent('/submissions/550e8400-e29b-41d4-a716-446655440001/statuses', 'POST', {
        pathParameters: { id: '550e8400-e29b-41d4-a716-446655440001' }, body: { status: 'approved', review_notes: 'Looks good!' },
      })
    ));
    expect(body.review_notes).toBe('Looks good!');
  });

  it('includes SUSPICIOUS_COORDINATES warning when final coords are (0,0)', async () => {
    setupApproveMocks({ display_lat: 0, display_lng: 0 });
    const { body } = parseRes(await handler(
      makeRestApiEvent('/submissions/550e8400-e29b-41d4-a716-446655440001/statuses', 'POST', {
        pathParameters: { id: '550e8400-e29b-41d4-a716-446655440001' }, body: { status: 'approved', display_lat: 0, display_lng: 0 },
      })
    ));
    expect(body.warnings).toHaveLength(1);
    expect(body.warnings[0].code).toBe('SUSPICIOUS_COORDINATES');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /admin/submissions/:id/statuses — approval reverse geocoding
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /admin/submissions/:id/statuses — approval reverse geocoding', () => {
  function setupApproveMocks(overrides: Record<string, any> = {}) {
    const approvedRow = makeApprovedRow(overrides);
    queryResponses = {
      'SELECT id, status FROM submissions': { rows: [{ id: '550e8400-e29b-41d4-a716-446655440001', status: 'pending_review' }] },
      'COUNT(*)': { rows: [{ count: 2 }] },
      'admin_users': { rows: [{ id: 'admin-uuid-1' }] },
      'BEGIN': { rows: [] },
      'SET country': { rows: [], rowCount: 1 },
      'UPDATE submissions': { rows: [approvedRow], rowCount: 1 },
      'INSERT INTO submission_reviews': { rows: [] },
      'COMMIT': { rows: [] },
    };
  }

  beforeEach(() => {
    mockResolveCountry.mockReset();
    mockResolveCountry.mockReturnValue('United States');
  });

  it('calls resolveCountry and stores the returned value', async () => {
    setupApproveMocks();
    const { statusCode } = parseRes(await handler(
      makeRestApiEvent('/submissions/550e8400-e29b-41d4-a716-446655440001/statuses', 'POST', {
        pathParameters: { id: '550e8400-e29b-41d4-a716-446655440001' },
        body: { status: 'approved' },
      })
    ));
    expect(statusCode).toBe(200);
    expect(mockResolveCountry).toHaveBeenCalledWith(34.05, -118.24);
    const countryUpdateCall = mockClient.query.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('UPDATE submissions SET country')
    );
    expect(countryUpdateCall).toBeDefined();
    expect(countryUpdateCall![1]).toEqual(['United States', '550e8400-e29b-41d4-a716-446655440001']);
  });

  it('stores null and logs warning when geocoder returns null', async () => {
    mockResolveCountry.mockReturnValue(null);
    setupApproveMocks();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { statusCode } = parseRes(await handler(
      makeRestApiEvent('/submissions/550e8400-e29b-41d4-a716-446655440001/statuses', 'POST', {
        pathParameters: { id: '550e8400-e29b-41d4-a716-446655440001' },
        body: { status: 'approved' },
      })
    ));
    expect(statusCode).toBe(200);
    expect(mockResolveCountry).toHaveBeenCalled();
    const countryUpdateCall = mockClient.query.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('UPDATE submissions SET country')
    );
    expect(countryUpdateCall![1]).toEqual([null, '550e8400-e29b-41d4-a716-446655440001']);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('still succeeds approval even if geocoder throws', async () => {
    mockResolveCountry.mockImplementation(() => { throw new Error('Geocoder exploded'); });
    setupApproveMocks();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { statusCode, body } = parseRes(await handler(
      makeRestApiEvent('/submissions/550e8400-e29b-41d4-a716-446655440001/statuses', 'POST', {
        pathParameters: { id: '550e8400-e29b-41d4-a716-446655440001' },
        body: { status: 'approved' },
      })
    ));
    expect(statusCode).toBe(200);
    expect(body.status).toBe('approved');
    const countryUpdateCall = mockClient.query.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('UPDATE submissions SET country')
    );
    expect(countryUpdateCall![1]).toEqual([null, '550e8400-e29b-41d4-a716-446655440001']);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /admin/submissions/:id/statuses — denial
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /admin/submissions/:id/statuses — denial', () => {
  function setupDenyMocks(overrides: Record<string, any> = {}) {
    const deniedRow = makeDeniedRow(overrides);
    queryResponses = {
      'SELECT id, status FROM submissions': { rows: [{ id: '550e8400-e29b-41d4-a716-446655440001', status: 'pending_review' }] },
      'admin_users': { rows: [ADMIN_USER_ROW] },
      'BEGIN': { rows: [] },
      'UPDATE submissions': { rows: [deniedRow], rowCount: 1 },
      'INSERT INTO submission_reviews': { rows: [] },
      'COMMIT': { rows: [] },
    };
  }

  it('returns 200 with updated submission on successful denial', async () => {
    setupDenyMocks();
    const { statusCode, body } = parseRes(await handler(
      makeRestApiEvent('/submissions/550e8400-e29b-41d4-a716-446655440001/statuses', 'POST', {
        pathParameters: { id: '550e8400-e29b-41d4-a716-446655440001' }, body: { status: 'denied', reason: 'spam' },
      })
    ));
    expect(statusCode).toBe(200);
    expect(body.status).toBe('denied');
  });

  it('returns INVALID_REASON for missing reason', async () => {
    const { body } = parseRes(await handler(
      makeRestApiEvent('/submissions/550e8400-e29b-41d4-a716-446655440001/statuses', 'POST', {
        pathParameters: { id: '550e8400-e29b-41d4-a716-446655440001' }, body: { status: 'denied' },
      })
    ));
    expect(body.error.code).toBe('INVALID_REASON');
  });

  it('returns INVALID_REASON for invalid reason value', async () => {
    const { body } = parseRes(await handler(
      makeRestApiEvent('/submissions/550e8400-e29b-41d4-a716-446655440001/statuses', 'POST', {
        pathParameters: { id: '550e8400-e29b-41d4-a716-446655440001' }, body: { status: 'denied', reason: 'not_valid' },
      })
    ));
    expect(body.error.code).toBe('INVALID_REASON');
  });

  it('returns MISSING_NOTES when reason=other and notes empty', async () => {
    const { body } = parseRes(await handler(
      makeRestApiEvent('/submissions/550e8400-e29b-41d4-a716-446655440001/statuses', 'POST', {
        pathParameters: { id: '550e8400-e29b-41d4-a716-446655440001' }, body: { status: 'denied', reason: 'other', review_notes: '' },
      })
    ));
    expect(body.error.code).toBe('MISSING_NOTES');
  });

  it('returns MISSING_NOTES when reason=other and notes missing', async () => {
    const { body } = parseRes(await handler(
      makeRestApiEvent('/submissions/550e8400-e29b-41d4-a716-446655440001/statuses', 'POST', {
        pathParameters: { id: '550e8400-e29b-41d4-a716-446655440001' }, body: { status: 'denied', reason: 'other' },
      })
    ));
    expect(body.error.code).toBe('MISSING_NOTES');
  });

  it('returns NOT_FOUND for non-existent submission', async () => {
    queryResponses = {
      'admin_users': { rows: [ADMIN_USER_ROW] },
      'BEGIN': { rows: [] },
      'UPDATE submissions': { rows: [], rowCount: 0 },
      'SELECT id, status FROM submissions': { rows: [] },
      'ROLLBACK': { rows: [] },
    };
    const { body } = parseRes(await handler(
      makeRestApiEvent('/submissions/550e8400-e29b-41d4-a716-446655440001/statuses', 'POST', {
        pathParameters: { id: '550e8400-e29b-41d4-a716-446655440001' }, body: { status: 'denied', reason: 'spam' },
      })
    ));
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('returns INVALID_STATE for already-reviewed submission', async () => {
    queryResponses = {
      'admin_users': { rows: [ADMIN_USER_ROW] },
      'BEGIN': { rows: [] },
      'UPDATE submissions': { rows: [], rowCount: 0 },
      'SELECT id, status FROM submissions': { rows: [{ id: '550e8400-e29b-41d4-a716-446655440001', status: 'denied' }] },
      'ROLLBACK': { rows: [] },
    };
    const { body } = parseRes(await handler(
      makeRestApiEvent('/submissions/550e8400-e29b-41d4-a716-446655440001/statuses', 'POST', {
        pathParameters: { id: '550e8400-e29b-41d4-a716-446655440001' }, body: { status: 'denied', reason: 'spam' },
      })
    ));
    expect(body.error.code).toBe('INVALID_STATE');
  });

  it('stores review_notes for spam reason', async () => {
    setupDenyMocks({ review_notes: 'Obvious spam' });
    const { body } = parseRes(await handler(
      makeRestApiEvent('/submissions/550e8400-e29b-41d4-a716-446655440001/statuses', 'POST', {
        pathParameters: { id: '550e8400-e29b-41d4-a716-446655440001' }, body: { status: 'denied', reason: 'spam', review_notes: 'Obvious spam' },
      })
    ));
    expect(body.review_notes).toBe('Obvious spam');
  });

  it('stores review_notes for invalid_location reason', async () => {
    setupDenyMocks({ review_notes: 'Wrong city' });
    const { body } = parseRes(await handler(
      makeRestApiEvent('/submissions/550e8400-e29b-41d4-a716-446655440001/statuses', 'POST', {
        pathParameters: { id: '550e8400-e29b-41d4-a716-446655440001' }, body: { status: 'denied', reason: 'invalid_location', review_notes: 'Wrong city' },
      })
    ));
    expect(body.review_notes).toBe('Wrong city');
  });

  it('stores review_notes for other reason', async () => {
    setupDenyMocks({ review_notes: 'Custom reason details' });
    const { body } = parseRes(await handler(
      makeRestApiEvent('/submissions/550e8400-e29b-41d4-a716-446655440001/statuses', 'POST', {
        pathParameters: { id: '550e8400-e29b-41d4-a716-446655440001' }, body: { status: 'denied', reason: 'other', review_notes: 'Custom reason details' },
      })
    ));
    expect(body.review_notes).toBe('Custom reason details');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /admin/submissions/:id/statuses — denial EventBridge publish
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /admin/submissions/:id/statuses — denial EventBridge publish', () => {
  function setupDenyMocks(overrides: Record<string, any> = {}) {
    const deniedRow = makeDeniedRow(overrides);
    queryResponses = {
      'SELECT id, status FROM submissions': { rows: [{ id: '550e8400-e29b-41d4-a716-446655440001', status: 'pending_review' }] },
      'admin_users': { rows: [ADMIN_USER_ROW] },
      'BEGIN': { rows: [] },
      'UPDATE submissions': { rows: [deniedRow], rowCount: 1 },
      'INSERT INTO submission_reviews': { rows: [] },
      'COMMIT': { rows: [] },
    };
  }

  it('publishes EventBridge event after successful denial', async () => {
    setupDenyMocks();
    const { statusCode, body } = parseRes(await handler(
      makeRestApiEvent('/submissions/550e8400-e29b-41d4-a716-446655440001/statuses', 'POST', {
        pathParameters: { id: '550e8400-e29b-41d4-a716-446655440001' }, body: { status: 'denied', reason: 'spam' },
      })
    ));
    expect(statusCode).toBe(200);
    expect(body.status).toBe('denied');

    expect(mockEventBridgeSend).toHaveBeenCalledTimes(1);
    const command = mockEventBridgeSend.mock.calls[0][0];
    expect(command._params.Entries).toHaveLength(1);
    expect(command._params.Entries[0].Source).toBe('okra.api');
    expect(command._params.Entries[0].DetailType).toBe('SubmissionDenied');
    expect(JSON.parse(command._params.Entries[0].Detail)).toEqual({ submissionId: '550e8400-e29b-41d4-a716-446655440001' });
  });

  it('EventBridge publish failure does not affect denial response', async () => {
    setupDenyMocks();
    mockEventBridgeSend.mockRejectedValueOnce(new Error('EventBridge unavailable'));

    const { statusCode, body } = parseRes(await handler(
      makeRestApiEvent('/submissions/550e8400-e29b-41d4-a716-446655440001/statuses', 'POST', {
        pathParameters: { id: '550e8400-e29b-41d4-a716-446655440001' }, body: { status: 'denied', reason: 'spam' },
      })
    ));
    expect(statusCode).toBe(200);
    expect(body.status).toBe('denied');
    expect(body.id).toBe('550e8400-e29b-41d4-a716-446655440001');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Error response consistency
// ═══════════════════════════════════════════════════════════════════════════

describe('Error response consistency', () => {
  it('all error responses match { error: { code, message } } shape', async () => {
    const errorEvents = [
      makeRestApiEvent('/submissions', 'GET', { queryStringParameters: { status: 'bad' } }),
      makeRestApiEvent('/submissions', 'GET', { queryStringParameters: { limit: '-1' } }),
      makeRestApiEvent('/submissions', 'GET', { queryStringParameters: { cursor: '!!!invalid!!!' } }),
      makeRestApiEvent('/submissions/550e8400-e29b-41d4-a716-446655440001/statuses', 'POST', {
        pathParameters: { id: '550e8400-e29b-41d4-a716-446655440001' }, body: {},
      }),
      makeRestApiEvent('/submissions/550e8400-e29b-41d4-a716-446655440001/statuses', 'POST', {
        pathParameters: { id: '550e8400-e29b-41d4-a716-446655440001' }, body: { status: 'approved', display_lat: 10 },
      }),
      makeRestApiEvent('/submissions/550e8400-e29b-41d4-a716-446655440001/statuses', 'POST', {
        pathParameters: { id: '550e8400-e29b-41d4-a716-446655440001' }, body: { status: 'denied' },
      }),
      makeRestApiEvent('/submissions/550e8400-e29b-41d4-a716-446655440001/statuses', 'POST', {
        pathParameters: { id: '550e8400-e29b-41d4-a716-446655440001' }, body: { status: 'denied', reason: 'other' },
      }),
    ];

    for (const event of errorEvents) {
      const res = await handler(event);
      const { statusCode, body } = parseRes(res);
      expect(statusCode).toBeGreaterThanOrEqual(400);
      expect(body).toHaveProperty('error');
      expect(body.error).toHaveProperty('code');
      expect(body.error).toHaveProperty('message');
      expect(typeof body.error.code).toBe('string');
      expect(typeof body.error.message).toBe('string');
      expect(body.error.code.length).toBeGreaterThan(0);
      expect(body.error.message.length).toBeGreaterThan(0);
    }
  });

  it('INTERNAL_ERROR on unexpected DB failure does not leak details', async () => {
    queryResponses = {
      'FROM submissions': () => { throw new Error('Connection refused: ECONNREFUSED'); },
    };
    const { statusCode, body } = parseRes(await handler(makeRestApiEvent('/submissions')));
    expect(statusCode).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).not.toContain('ECONNREFUSED');
  });
});

describe('seed request admin queue', () => {
  it('lists only open seed requests in reverse chronological order', async () => {
    scanResponses = [{
      Items: [
        {
          requestId: '11111111-1111-1111-1111-111111111111',
          createdAt: '2026-04-20T12:00:00.000Z',
          name: 'Older Request',
          email: 'older@example.com',
          fulfillmentMethod: 'mail',
          shippingAddress: { city: 'McKinney', region: 'TX', country: 'US' },
        },
        {
          requestId: '22222222-2222-2222-2222-222222222222',
          createdAt: '2026-04-21T12:00:00.000Z',
          name: 'Newest Request',
          email: 'new@example.com',
          fulfillmentMethod: 'in_person',
          visitDetails: { approximateDate: 'late May' },
        },
        {
          requestId: 'stats#seed-requests',
          createdAt: '2026-04-22T12:00:00.000Z',
        },
      ],
    }];

    const { statusCode, body } = parseRes(
      await handler(makeRestApiEvent('/requests', 'GET', {
        queryStringParameters: { status: 'open' },
      }))
    );

    expect(statusCode).toBe(200);
    expect(body.data).toHaveLength(2);
    expect(body.data[0].id).toBe('22222222-2222-2222-2222-222222222222');
    expect(body.data[1].id).toBe('11111111-1111-1111-1111-111111111111');
  });

  it('returns INVALID_STATUS when status query parameter is missing', async () => {
    const { statusCode, body } = parseRes(
      await handler(makeRestApiEvent('/requests'))
    );

    expect(statusCode).toBe(400);
    expect(body.error.code).toBe('INVALID_STATUS');
  });

  it('returns INVALID_STATUS for unsupported status value', async () => {
    const { statusCode, body } = parseRes(
      await handler(makeRestApiEvent('/requests', 'GET', {
        queryStringParameters: { status: 'shipped' },
      }))
    );

    expect(statusCode).toBe(400);
    expect(body.error.code).toBe('INVALID_STATUS');
  });

  it('rejects an invalid map_location before changing state', async () => {
    const { statusCode, body } = parseRes(await handler(
      makeRestApiEvent('/requests/33333333-3333-3333-3333-333333333333/statuses', 'POST', {
        pathParameters: { id: '33333333-3333-3333-3333-333333333333' },
        body: { status: 'handled', map_location: { lat: 200, lng: 0 } },
      })
    ));

    expect(statusCode).toBe(400);
    expect(body.error.code).toBe('INVALID_MAP_LOCATION');
    expect(mockDynamoSend).not.toHaveBeenCalled();
  });

  it('returns INVALID_ACTION for unsupported seed request action', async () => {
    const { statusCode, body } = parseRes(await handler(
      makeRestApiEvent('/requests/33333333-3333-3333-3333-333333333333/statuses', 'POST', {
        pathParameters: { id: '33333333-3333-3333-3333-333333333333' },
        body: { status: 'approved' },
      })
    ));

    expect(statusCode).toBe(400);
    expect(body.error.code).toBe('INVALID_ACTION');
  });
});

// ─── Seed request lifecycle (versioned) ─────────────────────────────────────
//
// A small stateful stand-in for the seed requests table: it honours the
// status + statusVersion conditions the service writes, so these tests check
// the optimistic-concurrency behaviour, not just call shapes. The ordering
// guarantees of the Postgres projection itself are exercised against a real
// database in test/db/seed-shipment-pins.db.test.ts.

describe('seed request lifecycle', () => {
  const REQ_ID = '44444444-4444-4444-4444-444444444444';
  let store: Map<string, any>;
  let packetsSent: number;
  let pinWrites: { op: 'show' | 'hide'; requestId: string; version: number }[];
  let pinStoreDown: boolean;
  let onGet: ((item: any) => void) | null;

  function mailRequest(overrides: Record<string, any> = {}) {
    return {
      requestId: REQ_ID,
      createdAt: '2026-10-01T00:00:00.000Z',
      name: 'Jane Gardener',
      email: 'jane@example.com',
      fulfillmentMethod: 'mail',
      shippingAddress: { line1: '123 Okra Lane', city: 'Austin', region: 'TX', postalCode: '78701', country: 'US' },
      showOnMap: true,
      statusVersion: 0,
      ...overrides,
    };
  }

  function transactionCancelled() {
    const err = new Error('Transaction cancelled');
    err.name = 'TransactionCanceledException';
    return err;
  }

  function applyTransact(input: any) {
    const updates = input.TransactItems.map((t: any) => t.Update);
    // Check every condition first: a transaction is all-or-nothing.
    for (const u of updates) {
      if (u.Key.requestId === 'stats#seed-packets-sent') continue;
      const item = store.get(u.Key.requestId);
      const vals = u.ExpressionAttributeValues;
      const status = item?.requestStatus ?? 'open';
      const version = item?.statusVersion ?? 0;
      if (!item || status !== vals[':fromStatus'] || version !== vals[':expectedVersion']) {
        throw transactionCancelled();
      }
    }
    for (const u of updates) {
      const vals = u.ExpressionAttributeValues;
      if (u.Key.requestId === 'stats#seed-packets-sent') {
        packetsSent += vals[':delta'];
        continue;
      }
      const item = store.get(u.Key.requestId);
      const nextStatus = vals[':handled'] ?? vals[':cancelled'] ?? vals[':open'] ?? item.requestStatus;
      store.set(u.Key.requestId, { ...item, requestStatus: nextStatus, statusVersion: vals[':nextVersion'] });
    }
  }

  function statusEvent(body: any) {
    return makeRestApiEvent(`/requests/${REQ_ID}/statuses`, 'POST', { pathParameters: { id: REQ_ID }, body });
  }

  function pinDeleteEvent() {
    return makeRestApiEvent(`/requests/${REQ_ID}/map-pin`, 'DELETE', { pathParameters: { id: REQ_ID } });
  }

  async function call(event: any) {
    return parseRes(await handler(event));
  }

  beforeEach(() => {
    store = new Map();
    packetsSent = 0;
    pinWrites = [];
    pinStoreDown = false;
    onGet = null;

    mockDynamoSend.mockImplementation((command: any) => {
      if (command._type === 'ScanCommand') return Promise.resolve(scanResponses.shift() ?? { Items: [] });
      if (command._type === 'GetCommand') {
        const item = store.get(command.input.Key.requestId);
        const snapshot = item ? structuredClone(item) : undefined;
        onGet?.(item);
        return Promise.resolve({ Item: snapshot });
      }
      if (command._type === 'TransactWriteCommand') {
        try {
          applyTransact(command.input);
          return Promise.resolve({});
        } catch (err) {
          return Promise.reject(err);
        }
      }
      return Promise.resolve({});
    });

    queryResponses['INSERT INTO seed_shipment_pins'] = (sql: string, params: any[]) => {
      if (pinStoreDown) throw new Error('db down');
      if (sql.includes('visible)\n     VALUES ($1, $2, false)') || sql.includes('VALUES ($1, $2, false)')) {
        pinWrites.push({ op: 'hide', requestId: params[0], version: params[1] });
        return { rows: [{ was_visible: true }], rowCount: 1 };
      }
      pinWrites.push({ op: 'show', requestId: params[0], version: params[7] });
      return { rows: [], rowCount: 1 };
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── done ──

  it('marks done and shows a pin at the new version when the requester opted in', async () => {
    store.set(REQ_ID, mailRequest());

    const { statusCode, body } = await call(statusEvent({ status: 'handled', map_location: { lat: 30.26721, lng: -97.74309 } }));

    expect(statusCode).toBe(200);
    expect(body).toMatchObject({ requestStatus: 'handled', mapPin: { locality: 'Austin, TX', country: 'US' } });
    expect(store.get(REQ_ID)).toMatchObject({ requestStatus: 'handled', statusVersion: 1 });
    expect(packetsSent).toBe(1);
    expect(pinWrites).toEqual([{ op: 'show', requestId: REQ_ID, version: 1 }]);

    const insert = mockClient.query.mock.calls.find(([sql]) => String(sql).includes('source_version, visible'));
    expect(JSON.stringify(insert![1])).not.toMatch(/Gardener|Okra Lane|78701|jane@example.com/);
  });

  it('never publishes a pin without explicit consent', async () => {
    for (const consent of [false, undefined]) {
      store.set(REQ_ID, mailRequest({ showOnMap: consent, requestStatus: 'open' }));
      pinWrites = [];
      const { statusCode, body } = await call(statusEvent({ status: 'handled', map_location: { lat: 30.2, lng: -97.7 } }));
      expect(statusCode).toBe(200);
      expect(body.mapPin).toBeNull();
      expect(pinWrites).toEqual([]);
    }
  });

  it('skips the pin for in-person requests and when no location is sent', async () => {
    store.set(REQ_ID, mailRequest({ fulfillmentMethod: 'in_person', shippingAddress: null }));
    expect((await call(statusEvent({ status: 'handled', map_location: { lat: 30.2, lng: -97.7 } }))).body.mapPin).toBeNull();

    store.set(REQ_ID, mailRequest());
    expect((await call(statusEvent({ status: 'handled' }))).body.mapPin).toBeNull();
    expect(pinWrites).toEqual([]);
  });

  it('still marks done when the pin store keeps failing, after retrying', async () => {
    store.set(REQ_ID, mailRequest());
    pinStoreDown = true;

    const { statusCode, body } = await call(statusEvent({ status: 'handled', map_location: { lat: 30.2, lng: -97.7 } }));

    expect(statusCode).toBe(200);
    expect(body.requestStatus).toBe('handled');
    expect(body.mapPin).toBeNull();
    const attempts = mockClient.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO seed_shipment_pins'));
    expect(attempts).toHaveLength(3);
  });

  it('reports no pin when a newer state already superseded the write', async () => {
    store.set(REQ_ID, mailRequest());
    queryResponses['INSERT INTO seed_shipment_pins'] = () => ({ rows: [], rowCount: 0 });

    const { body } = await call(statusEvent({ status: 'handled', map_location: { lat: 30.2, lng: -97.7 } }));
    expect(body.mapPin).toBeNull();
  });

  it('rejects marking done twice', async () => {
    store.set(REQ_ID, mailRequest({ requestStatus: 'handled', statusVersion: 1 }));
    const { statusCode, body } = await call(statusEvent({ status: 'handled' }));
    expect(statusCode).toBe(409);
    expect(body.error.code).toBe('INVALID_STATE');
    expect(packetsSent).toBe(0);
  });

  it('returns 409 if another admin changed the request between read and write', async () => {
    store.set(REQ_ID, mailRequest());
    // Another admin cancels and reopens it (version 0 -> 2) right after our read.
    onGet = (item) => store.set(REQ_ID, { ...item, requestStatus: 'open', statusVersion: 2 });

    const { statusCode, body } = await call(statusEvent({ status: 'handled', map_location: { lat: 30.2, lng: -97.7 } }));

    expect(statusCode).toBe(409);
    expect(body.error.code).toBe('INVALID_STATE');
    expect(packetsSent).toBe(0);
    expect(pinWrites).toEqual([]);
  });

  it('treats requests from before versioning as version 0', async () => {
    const legacy = mailRequest();
    delete (legacy as any).statusVersion;
    store.set(REQ_ID, legacy);

    expect((await call(statusEvent({ status: 'handled' }))).statusCode).toBe(200);
    expect(store.get(REQ_ID).statusVersion).toBe(1);
    const tx = mockDynamoSend.mock.calls.find(([c]) => c._type === 'TransactWriteCommand')![0];
    expect(tx.input.TransactItems[0].Update.ConditionExpression).toContain('attribute_not_exists(#version)');
  });

  // ── undo / reopen ──

  it('done then undo: un-counts the packet and hides the pin at a strictly newer version', async () => {
    store.set(REQ_ID, mailRequest());
    await call(statusEvent({ status: 'handled', map_location: { lat: 30.2, lng: -97.7 } }));

    const { statusCode, body } = await call(statusEvent({ status: 'open' }));

    expect(statusCode).toBe(200);
    expect(body).toMatchObject({ requestStatus: 'open', previousStatus: 'handled', mapPinRemoved: true });
    expect(store.get(REQ_ID)).toMatchObject({ requestStatus: 'open', statusVersion: 2 });
    expect(packetsSent).toBe(0);
    // The hide outranks the show, so even if the show landed late it loses.
    expect(pinWrites).toEqual([
      { op: 'show', requestId: REQ_ID, version: 1 },
      { op: 'hide', requestId: REQ_ID, version: 2 },
    ]);
  });

  it('undo writes its tombstone even if the done pin never landed', async () => {
    store.set(REQ_ID, mailRequest({ requestStatus: 'handled', statusVersion: 1 }));
    queryResponses['INSERT INTO seed_shipment_pins'] = (_sql: string, params: any[]) => {
      pinWrites.push({ op: 'hide', requestId: params[0], version: params[1] });
      return { rows: [{ was_visible: null }], rowCount: 1 };
    };

    const { body } = await call(statusEvent({ status: 'open' }));
    expect(body.mapPinRemoved).toBe(false);
    expect(pinWrites).toEqual([{ op: 'hide', requestId: REQ_ID, version: 2 }]);
  });

  it('reports mapPinRemoved=null when the hide fails, so the admin can retry', async () => {
    store.set(REQ_ID, mailRequest({ requestStatus: 'handled', statusVersion: 1 }));
    pinStoreDown = true;
    const { statusCode, body } = await call(statusEvent({ status: 'open' }));
    expect(statusCode).toBe(200);
    expect(body.mapPinRemoved).toBeNull();
    expect(store.get(REQ_ID).requestStatus).toBe('open');
  });

  it('reopens a cancelled request without touching the packet counter', async () => {
    store.set(REQ_ID, mailRequest({ requestStatus: 'cancelled', statusVersion: 3 }));
    const { statusCode, body } = await call(statusEvent({ status: 'open' }));
    expect(statusCode).toBe(200);
    expect(body.previousStatus).toBe('cancelled');
    expect(packetsSent).toBe(0);
    expect(store.get(REQ_ID).statusVersion).toBe(4);
  });

  it('returns 409 reopening an open request and 404 for a missing one', async () => {
    store.set(REQ_ID, mailRequest());
    expect((await call(statusEvent({ status: 'open' }))).statusCode).toBe(409);
    store.clear();
    expect((await call(statusEvent({ status: 'open' }))).statusCode).toBe(404);
  });

  // ── cancel ──

  it('cancels an open request without counting a packet or touching pins', async () => {
    store.set(REQ_ID, mailRequest());
    const { statusCode, body } = await call(statusEvent({ status: 'cancelled', review_notes: ' duplicate ' }));
    expect(statusCode).toBe(200);
    expect(body).toMatchObject({ requestStatus: 'cancelled', reviewNotes: 'duplicate' });
    expect(store.get(REQ_ID)).toMatchObject({ requestStatus: 'cancelled', statusVersion: 1 });
    expect(packetsSent).toBe(0);
    expect(mockClient.query).not.toHaveBeenCalled();
  });

  it('refuses to cancel a request that is already done', async () => {
    store.set(REQ_ID, mailRequest({ requestStatus: 'handled', statusVersion: 1 }));
    expect((await call(statusEvent({ status: 'cancelled' }))).statusCode).toBe(409);
  });

  it('rejects overly long review notes before reading anything', async () => {
    const { statusCode, body } = await call(statusEvent({ status: 'cancelled', review_notes: 'x'.repeat(1001) }));
    expect(statusCode).toBe(400);
    expect(body.error.code).toBe('INVALID_REVIEW_NOTES');
    expect(mockDynamoSend).not.toHaveBeenCalled();
  });

  // ── remove pin only ──

  it('removes only the pin, bumping the version so it outranks the done write', async () => {
    store.set(REQ_ID, mailRequest({ requestStatus: 'handled', statusVersion: 1 }));
    const { statusCode, body } = await call(pinDeleteEvent());
    expect(statusCode).toBe(200);
    expect(body).toEqual({ id: REQ_ID, mapPinRemoved: true });
    expect(store.get(REQ_ID)).toMatchObject({ requestStatus: 'handled', statusVersion: 2 });
    expect(pinWrites).toEqual([{ op: 'hide', requestId: REQ_ID, version: 2 }]);
    expect(packetsSent).toBe(0);
  });

  it('returns 404 removing a pin for a missing request, 500 when the pin store is down', async () => {
    expect((await call(pinDeleteEvent())).statusCode).toBe(404);

    store.set(REQ_ID, mailRequest({ requestStatus: 'handled', statusVersion: 1 }));
    pinStoreDown = true;
    const { statusCode, body } = await call(pinDeleteEvent());
    expect(statusCode).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  // ── listing + reconciliation ──

  it('lists handled requests newest first with their pin, following Scan pages', async () => {
    scanResponses = [
      {
        Items: [{ requestId: 'a', createdAt: '2026-01-01T00:00:00Z', handledAt: '2026-03-01T00:00:00Z', requestStatus: 'handled', showOnMap: true, statusVersion: 1 }],
        LastEvaluatedKey: { requestId: 'a' },
      },
      { Items: [{ requestId: 'b', createdAt: '2026-02-01T00:00:00Z', handledAt: '2026-04-01T00:00:00Z', requestStatus: 'handled', statusVersion: 1 }] },
    ];
    queryResponses['FROM seed_shipment_pins'] = { rows: [{ request_id: 'a', locality: 'Austin, TX', country: 'US' }] };

    const { statusCode, body } = await call(makeRestApiEvent('/requests', 'GET', { queryStringParameters: { status: 'handled' } }));

    expect(statusCode).toBe(200);
    expect(body.total).toBe(2);
    expect(body.data.map((r: any) => r.id)).toEqual(['b', 'a']);
    expect(body.data[0]).toMatchObject({ mapPin: null, showOnMap: false });
    expect(body.data[1]).toMatchObject({ mapPin: { locality: 'Austin, TX', country: 'US' }, showOnMap: true });
    expect(pinWrites).toEqual([]);
  });

  it('reconciles a stale pin on a request that is no longer done', async () => {
    scanResponses = [{ Items: [{ requestId: 'stale', createdAt: '2026-01-01T00:00:00Z', requestStatus: 'open', showOnMap: true, statusVersion: 2 }] }];
    queryResponses['FROM seed_shipment_pins'] = { rows: [{ request_id: 'stale', locality: 'Austin, TX', country: 'US' }] };

    const { body } = await call(makeRestApiEvent('/requests', 'GET', { queryStringParameters: { status: 'open' } }));

    expect(body.data[0].mapPin).toBeNull();
    expect(pinWrites).toEqual([{ op: 'hide', requestId: 'stale', version: 2 }]);
  });

  it('still lists requests when the pin store is down (pin status left unknown)', async () => {
    scanResponses = [{ Items: [{ requestId: 'a', createdAt: '2026-01-01T00:00:00Z', requestStatus: 'handled' }] }];
    queryResponses['FROM seed_shipment_pins'] = () => { throw new Error('db down'); };

    const { statusCode, body } = await call(makeRestApiEvent('/requests', 'GET', { queryStringParameters: { status: 'handled' } }));

    expect(statusCode).toBe(200);
    expect(body.data[0]).not.toHaveProperty('mapPin');
  });

  it('lists cancelled requests with their reason', async () => {
    scanResponses = [{ Items: [{ requestId: 'c', createdAt: '2026-01-01T00:00:00Z', cancelledAt: '2026-01-02T00:00:00Z', requestStatus: 'cancelled', reviewNotes: 'duplicate' }] }];
    const { body } = await call(makeRestApiEvent('/requests', 'GET', { queryStringParameters: { status: 'cancelled' } }));
    expect(body.data[0]).toMatchObject({ id: 'c', requestStatus: 'cancelled', reviewNotes: 'duplicate' });
  });
});
