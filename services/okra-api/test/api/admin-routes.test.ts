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
  ScanCommand: vi.fn((input: any) => ({ input, _type: 'ScanCommand' })),
  UpdateCommand: vi.fn((input: any) => ({ input, _type: 'UpdateCommand' })),
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
    if (command?._type === 'UpdateCommand') {
      return Promise.resolve({ Attributes: {} });
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
    expect(body).toEqual({ data: [], cursor: null });
    const queryCall = mockClient.query.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('FROM submissions')
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

  it('applies the ready-photo filter for status=pending_review', async () => {
    setupListMocks();
    await handler(
      makeRestApiEvent('/submissions', 'GET', { queryStringParameters: { status: 'pending_review' } })
    );
    const queryCall = mockClient.query.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('FROM submissions s')
    );
    expect(queryCall![0]).toMatch(/submission_photos sp/);
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
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('FROM submissions')
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
      await handler(makeRestApiEvent('/requests/review-queue'))
    );

    expect(statusCode).toBe(200);
    expect(body.data).toHaveLength(2);
    expect(body.data[0].id).toBe('22222222-2222-2222-2222-222222222222');
    expect(body.data[1].id).toBe('11111111-1111-1111-1111-111111111111');
  });

  it('marks a seed request as handled', async () => {
    mockDynamoSend.mockImplementationOnce((command: any) => {
      expect(command._type).toBe('UpdateCommand');
      return Promise.resolve({
        Attributes: {
          requestId: '33333333-3333-3333-3333-333333333333',
          requestStatus: 'handled',
          handledAt: '2026-04-22T12:00:00.000Z',
          handledByCognitoSub: 'admin-cognito-sub-1',
          reviewNotes: 'Handled in admin dashboard.',
        },
      });
    });

    const { statusCode, body } = parseRes(await handler(
      makeRestApiEvent('/requests/33333333-3333-3333-3333-333333333333/statuses', 'POST', {
        pathParameters: { id: '33333333-3333-3333-3333-333333333333' },
        body: { status: 'handled', review_notes: 'Handled in admin dashboard.' },
      })
    ));

    expect(statusCode).toBe(200);
    expect(body.requestStatus).toBe('handled');
    expect(body.handledByCognitoSub).toBe('admin-cognito-sub-1');
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


// ═══════════════════════════════════════════════════════════════════════════
// GET /admin/submissions/review-queue
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /admin/submissions/review-queue', () => {
  function makeReviewQueueSubmissionRow(overrides: Record<string, any> = {}) {
    return {
      id: '550e8400-e29b-41d4-a716-446655440001',
      contributor_name: 'Alice',
      contributor_email: 'alice@example.com',
      story_text: 'Found okra here',
      raw_location_text: '123 Main St',
      privacy_mode: 'exact',
      display_lat: 34.05,
      display_lng: -118.24,
      status: 'pending_review',
      created_at: new Date('2024-01-15T10:00:00Z'),
      created_at_raw: '2024-01-15 10:00:00.000000+00',
      ...overrides,
    };
  }

  function setupReviewQueueMocks(submissionRows: any[] = [], photoRows: any[] = []) {
    queryResponses = {
      'pending_review': { rows: submissionRows, rowCount: submissionRows.length },
      'original_s3_key': { rows: photoRows, rowCount: photoRows.length },
    };
  }

  // ─── Validates: Requirement 5.1 — Only pending submissions with ready photos ──
  it('returns only pending submissions with ready photos', async () => {
    const sub1 = makeReviewQueueSubmissionRow();
    setupReviewQueueMocks([sub1], [
      { submission_id: sub1.id, original_s3_key: 'photos/abc.jpg' },
    ]);

    const res = await handler(makeRestApiEvent('/submissions/review-queue'));
    const { statusCode, body } = parseRes(res);

    expect(statusCode).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe(sub1.id);
    expect(body.data[0].status).toBe('pending_review');
  });

  // ─── Validates: Requirement 5.1, 5.4 — Submissions without ready photos excluded ──
  it('excludes submissions with only uploaded/processing/failed photos (via DB query)', async () => {
    // The EXISTS subquery in the handler filters at the DB level,
    // so if the DB returns no rows, the response should be empty.
    setupReviewQueueMocks([], []);

    const res = await handler(makeRestApiEvent('/submissions/review-queue'));
    const { statusCode, body } = parseRes(res);

    expect(statusCode).toBe(200);
    expect(body.data).toEqual([]);
    expect(body.cursor).toBeNull();
  });

  // ─── Validates: Requirement 5.5 — Pre-signed URLs for ready photos only ──
  it('generates pre-signed URLs for ready photos only', async () => {
    const sub1 = makeReviewQueueSubmissionRow();
    setupReviewQueueMocks([sub1], [
      { submission_id: sub1.id, original_s3_key: 'photos/ready1.jpg' },
      { submission_id: sub1.id, original_s3_key: 'photos/ready2.jpg' },
    ]);

    const res = await handler(makeRestApiEvent('/submissions/review-queue'));
    const { body } = parseRes(res);

    expect(body.data[0].photos).toHaveLength(2);
    expect(body.data[0].photos[0]).toBe('https://s3.example.com/signed-url');
    expect(body.data[0].photos[1]).toBe('https://s3.example.com/signed-url');
    expect(body.data[0].photo_count).toBe(2);
    expect(body.data[0].has_photos).toBe(true);
  });

  // ─── Validates: Requirement 5.3 — Response shape with all required fields ──
  it('returns response with all required fields', async () => {
    const sub1 = makeReviewQueueSubmissionRow();
    setupReviewQueueMocks([sub1], [
      { submission_id: sub1.id, original_s3_key: 'photos/abc.jpg' },
    ]);

    const res = await handler(makeRestApiEvent('/submissions/review-queue'));
    const { body } = parseRes(res);

    expect(body.data).toHaveLength(1);
    const item = body.data[0];
    for (const field of [
      'id', 'contributor_name', 'contributor_email', 'story_text',
      'raw_location_text', 'privacy_mode', 'display_lat', 'display_lng',
      'status', 'created_at', 'photo_count', 'has_photos', 'photos',
    ]) {
      expect(item).toHaveProperty(field);
    }
    expect(item.photo_count).toBe(1);
    expect(item.has_photos).toBe(true);
    expect(Array.isArray(item.photos)).toBe(true);
  });

  // ─── Validates: Requirement 5.3 — photo_count and has_photos when no photos ──
  it('returns photo_count=0 and has_photos=false when submission has no ready photos', async () => {
    const sub1 = makeReviewQueueSubmissionRow();
    setupReviewQueueMocks([sub1], []);

    const res = await handler(makeRestApiEvent('/submissions/review-queue'));
    const { body } = parseRes(res);

    expect(body.data[0].photo_count).toBe(0);
    expect(body.data[0].has_photos).toBe(false);
    expect(body.data[0].photos).toEqual([]);
  });

  // ─── Validates: Requirement 6.2 — Existing GET /admin/submissions still works ──
  it('existing GET /admin/submissions endpoint still works unchanged', async () => {
    queryResponses = {
      'FROM submissions': { rows: [], rowCount: 0 },
    };

    const res = await handler(makeRestApiEvent('/submissions'));
    const { statusCode, body } = parseRes(res);

    expect(statusCode).toBe(200);
    expect(body).toEqual({ data: [], cursor: null });
  });

  // ─── Validates: Requirement 7.5 — Limit validation on review queue ──
  it('returns INVALID_LIMIT for zero limit', async () => {
    const res = await handler(
      makeRestApiEvent('/submissions/review-queue', 'GET', {
        queryStringParameters: { limit: '0' },
      })
    );
    const { statusCode, body } = parseRes(res);
    expect(statusCode).toBe(400);
    expect(body.error.code).toBe('INVALID_LIMIT');
  });

  it('returns INVALID_LIMIT for negative limit', async () => {
    const res = await handler(
      makeRestApiEvent('/submissions/review-queue', 'GET', {
        queryStringParameters: { limit: '-5' },
      })
    );
    expect(parseRes(res).body.error.code).toBe('INVALID_LIMIT');
  });

  it('returns INVALID_LIMIT for non-numeric limit', async () => {
    const res = await handler(
      makeRestApiEvent('/submissions/review-queue', 'GET', {
        queryStringParameters: { limit: 'abc' },
      })
    );
    expect(parseRes(res).body.error.code).toBe('INVALID_LIMIT');
  });

  it('returns INVALID_LIMIT for decimal limit', async () => {
    const res = await handler(
      makeRestApiEvent('/submissions/review-queue', 'GET', {
        queryStringParameters: { limit: '3.7' },
      })
    );
    expect(parseRes(res).body.error.code).toBe('INVALID_LIMIT');
  });

  it('clamps limit above 100 to 100', async () => {
    const sub1 = makeReviewQueueSubmissionRow();
    setupReviewQueueMocks([sub1], []);

    await handler(
      makeRestApiEvent('/submissions/review-queue', 'GET', {
        queryStringParameters: { limit: '200' },
      })
    );

    // The handler should query with limit + 1 = 101
    const queryCall = mockClient.query.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('pending_review') && c[0].includes('LIMIT')
    );
    expect(queryCall).toBeDefined();
    expect(queryCall![1]).toContain(101);
  });

  // ─── Validates: Requirement 7.6 — Cursor validation on review queue ──
  it('returns INVALID_CURSOR for malformed cursor', async () => {
    const res = await handler(
      makeRestApiEvent('/submissions/review-queue', 'GET', {
        queryStringParameters: { cursor: 'not-valid' },
      })
    );
    expect(parseRes(res).body.error.code).toBe('INVALID_CURSOR');
  });

  // ─── Validates: Requirement 9.1 — 500 error when MEDIA_BUCKET_NAME not set ──
  it('returns 500 INTERNAL_ERROR when MEDIA_BUCKET_NAME is not set', async () => {
    delete process.env.MEDIA_BUCKET_NAME;

    const res = await handler(makeRestApiEvent('/submissions/review-queue'));
    const { statusCode, body } = parseRes(res);

    expect(statusCode).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('An unexpected error occurred');
  });

  // ─── Empty result set ──
  it('returns empty result set as { data: [], cursor: null }', async () => {
    setupReviewQueueMocks([], []);

    const { body } = parseRes(
      await handler(makeRestApiEvent('/submissions/review-queue'))
    );
    expect(body.data).toEqual([]);
    expect(body.cursor).toBeNull();
  });

  // ─── Cursor is null on last page ──
  it('cursor is null on last page', async () => {
    const sub1 = makeReviewQueueSubmissionRow();
    setupReviewQueueMocks([sub1], []);

    const { body } = parseRes(
      await handler(makeRestApiEvent('/submissions/review-queue'))
    );
    expect(body.cursor).toBeNull();
  });

  // ─── Multiple submissions with photos ──
  it('returns multiple submissions with their respective photos', async () => {
    const sub1 = makeReviewQueueSubmissionRow({
      id: '550e8400-e29b-41d4-a716-446655440001',
      created_at: new Date('2024-01-15T10:00:00Z'),
      created_at_raw: '2024-01-15 10:00:00.000000+00',
    });
    const sub2 = makeReviewQueueSubmissionRow({
      id: '550e8400-e29b-41d4-a716-446655440002',
      contributor_name: 'Bob',
      created_at: new Date('2024-01-16T10:00:00Z'),
      created_at_raw: '2024-01-16 10:00:00.000000+00',
    });

    setupReviewQueueMocks([sub1, sub2], [
      { submission_id: sub1.id, original_s3_key: 'photos/sub1-photo.jpg' },
      { submission_id: sub2.id, original_s3_key: 'photos/sub2-photo1.jpg' },
      { submission_id: sub2.id, original_s3_key: 'photos/sub2-photo2.jpg' },
    ]);

    const { body } = parseRes(
      await handler(makeRestApiEvent('/submissions/review-queue'))
    );

    expect(body.data).toHaveLength(2);
    expect(body.data[0].photos).toHaveLength(1);
    expect(body.data[1].photos).toHaveLength(2);
    expect(body.data[1].photo_count).toBe(2);
  });
});
