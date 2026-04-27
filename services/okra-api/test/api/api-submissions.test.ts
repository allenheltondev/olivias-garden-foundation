import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockClient = {
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn()
};

const {
  mockEnqueuePhotoProcessing,
  mockResolveOptionalContributor,
  mockPublishSubmissionCreatedEvent,
  mockPublishSubmissionEditSubmittedEvent
} = vi.hoisted(() => ({
  mockEnqueuePhotoProcessing: vi.fn(),
  mockResolveOptionalContributor: vi.fn(),
  mockPublishSubmissionCreatedEvent: vi.fn(),
  mockPublishSubmissionEditSubmittedEvent: vi.fn()
}));

vi.mock('../../scripts/db-client.mjs', () => ({
  createDbClient: vi.fn(() => mockClient)
}));

vi.mock('../../src/services/photo-processing-queue.mjs', () => ({
  enqueuePhotoProcessing: mockEnqueuePhotoProcessing
}));

vi.mock('../../src/services/submission-notifications.mjs', () => ({
  publishSubmissionCreatedEvent: mockPublishSubmissionCreatedEvent,
  publishSubmissionEditSubmittedEvent: mockPublishSubmissionEditSubmittedEvent
}));

vi.mock('../../src/services/auth.mjs', async () => {
  const actual = await vi.importActual('../../src/services/auth.mjs');
  return {
    ...actual,
    resolveOptionalContributor: mockResolveOptionalContributor
  };
});

import { handler } from '../../src/handlers/api.mjs';

function makeRestApiEvent(path, method = 'POST', body = null, headers = {}) {
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
      requestId: 'req-submit',
      path,
      stage: 'api',
      identity: {
        sourceIp: '127.0.0.1',
        userAgent: 'vitest'
      }
    },
    body,
    isBase64Encoded: false
  };
}

function mockSubmissionInsertSuccess() {
  mockClient.query.mockImplementation((text, params) => {
    if (text === 'begin' || text === 'commit' || text === 'rollback') {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }

    if (String(text).includes('information_schema.columns')) {
      return Promise.resolve({ rows: [{ '?column?': 1 }], rowCount: 1 });
    }

    if (text.includes('insert into submissions')) {
      return Promise.resolve({
        rows: [{ id: 'sub-123', status: 'pending_review', created_at: '2026-04-15T12:00:00.000Z' }],
        rowCount: 1,
        params
      });
    }

    if (text.includes('update submission_photos')) {
      return Promise.resolve({
        rows: [{
          id: '550e8400-e29b-41d4-a716-446655440001',
          original_s3_key: 'temp-photos/550e8400-e29b-41d4-a716-446655440001/original'
        }],
        rowCount: 1
      });
    }

    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.MEDIA_CDN_DOMAIN = 'assets.oliviasgarden.test';
  mockClient.connect.mockResolvedValue(undefined);
  mockClient.end.mockResolvedValue(undefined);
  mockResolveOptionalContributor.mockResolvedValue({ ok: true, contributor: null });
  mockSubmissionInsertSuccess();
});

describe('submit endpoint validation', () => {
  it('returns 422 when required fields are missing', async () => {
    const res = await handler(
      makeRestApiEvent('/submissions', 'POST', JSON.stringify({ contributorName: 'A' }))
    );

    expect(res.statusCode).toBe(422);
    const payload = JSON.parse(String(res.body));
    expect(payload.error).toBe('RequestValidationError');
  });
});

describe('submit endpoint optional auth enrichment', () => {
  it('stores anonymous submissions without contributor auth metadata', async () => {
    const res = await handler(
      makeRestApiEvent(
        '/submissions',
        'POST',
        JSON.stringify({
          contributorName: 'Guest',
          storyText: 'Found some okra',
          rawLocationText: 'Austin, TX',
          displayLat: 30.2672,
          displayLng: -97.7431,
          photoIds: ['550e8400-e29b-41d4-a716-446655440001']
        })
      )
    );

    expect(res.statusCode).toBe(201);
    const insertCall = mockClient.query.mock.calls.find(([text]) => String(text).includes('insert into submissions'));
    expect(insertCall[1][0]).toBe('Guest');
    expect(insertCall[1][1]).toBeNull();
    expect(insertCall[1][2]).toBeNull();
    expect(mockEnqueuePhotoProcessing).toHaveBeenCalledWith(['550e8400-e29b-41d4-a716-446655440001']);
    expect(mockPublishSubmissionCreatedEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'sub-123',
        status: 'pending_review',
        contributorName: 'Guest',
        rawLocationText: 'Austin, TX',
        photoUrls: ['https://assets.oliviasgarden.test/temp-photos/550e8400-e29b-41d4-a716-446655440001/original']
      }),
      'req-submit'
    );
  });

  it('enriches submissions from an authenticated contributor when form fields are omitted', async () => {
    mockResolveOptionalContributor.mockResolvedValue({
      ok: true,
      contributor: {
        sub: 'user-123',
        email: 'okra@goodroots.test',
        name: 'Okra Grower'
      }
    });

    const res = await handler(
      makeRestApiEvent(
        '/submissions',
        'POST',
        JSON.stringify({
          storyText: 'My backyard plant',
          rawLocationText: 'Dallas, TX',
          displayLat: 32.7767,
          displayLng: -96.797,
          photoIds: ['550e8400-e29b-41d4-a716-446655440001']
        }),
        { authorization: 'Bearer test-token' }
      )
    );

    expect(res.statusCode).toBe(201);
    const insertCall = mockClient.query.mock.calls.find(([text]) => String(text).includes('insert into submissions'));
    expect(insertCall[1][0]).toBe('Okra Grower');
    expect(insertCall[1][1]).toBe('okra@goodroots.test');
    expect(insertCall[1][2]).toBe('user-123');
  });

  it('returns 401 when an invalid bearer token is supplied', async () => {
    mockResolveOptionalContributor.mockResolvedValue({
      ok: false,
      statusCode: 401,
      body: {
        error: 'Unauthorized',
        message: 'Invalid bearer token'
      }
    });

    const res = await handler(
      makeRestApiEvent(
        '/submissions',
        'POST',
        JSON.stringify({
          rawLocationText: 'Houston, TX',
          displayLat: 29.7604,
          displayLng: -95.3698,
          photoIds: ['550e8400-e29b-41d4-a716-446655440001']
        }),
        { authorization: 'Bearer bad-token' }
      )
    );

    expect(res.statusCode).toBe(401);
    const payload = JSON.parse(String(res.body));
    expect(payload.error).toBe('Unauthorized');
    expect(mockClient.connect).not.toHaveBeenCalled();
  });
});

describe('submit endpoint error handling', () => {
  it('logs structured context and returns 500 when database connection fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockClient.connect.mockRejectedValueOnce(new Error('database offline'));

    const res = await handler(
      makeRestApiEvent(
        '/submissions',
        'POST',
        JSON.stringify({
          contributorName: 'Guest',
          storyText: 'Found some okra',
          rawLocationText: 'Austin, TX',
          displayLat: 30.2672,
          displayLng: -97.7431,
          photoIds: ['550e8400-e29b-41d4-a716-446655440001']
        })
      )
    );

    expect(res.statusCode).toBe(500);
    const payload = JSON.parse(String(res.body));
    expect(payload.error.code).toBe('INTERNAL_ERROR');

    const logLine = consoleSpy.mock.calls
      .map(([entry]) => String(entry))
      .find((entry) => entry.includes('"endpoint":"POST /submissions"'));

    expect(logLine).toBeDefined();
    expect(logLine).toContain('"correlationId":"req-submit"');

    consoleSpy.mockRestore();
  });
});

describe('edit endpoint', () => {
  it('submits an approved contributor edit for review and queues new photos', async () => {
    mockResolveOptionalContributor.mockResolvedValue({
      ok: true,
      contributor: {
        sub: 'user-123',
        email: 'okra@goodroots.test',
        name: 'Okra Grower'
      }
    });

    mockClient.query.mockImplementation((text) => {
      const sql = String(text);
      if (text === 'begin' || text === 'commit' || text === 'rollback') {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      if (sql.includes('from submissions') && sql.includes('for update')) {
        return Promise.resolve({ rows: [{ id: '550e8400-e29b-41d4-a716-446655440010', status: 'approved' }], rowCount: 1 });
      }
      if (sql.includes('select id') && sql.includes('client_edit_key')) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      if (sql.includes('from submission_photos') && sql.includes('removed_at is null')) {
        return Promise.resolve({ rows: [{ id: '550e8400-e29b-41d4-a716-446655440011' }], rowCount: 1 });
      }
      if (sql.includes('update submission_photos') && sql.includes('submission_id is null')) {
        return Promise.resolve({ rows: [{ id: '550e8400-e29b-41d4-a716-446655440012' }], rowCount: 1 });
      }
      if (sql.includes('update submission_edits') && sql.includes('Superseded')) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      if (sql.includes('insert into submission_edits')) {
        return Promise.resolve({
          rows: [{
            id: '550e8400-e29b-41d4-a716-446655440099',
            status: 'pending_review',
            created_at: '2026-04-27T12:00:00.000Z'
          }],
          rowCount: 1
        });
      }
      if (sql.includes('insert into submission_edit_photos')) {
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const res = await handler(
      makeRestApiEvent(
        '/me/submissions/550e8400-e29b-41d4-a716-446655440010',
        'PATCH',
        JSON.stringify({
          contributorName: 'Edited Grower',
          storyText: 'Edited story',
          rawLocationText: 'McKinney, TX',
          displayLat: 33.1972,
          displayLng: -96.6398,
          privacyMode: 'city',
          photoIds: ['550e8400-e29b-41d4-a716-446655440012'],
          removePhotoIds: [],
          editClientKey: 'client-key-1'
        }),
        { authorization: 'Bearer test-token' }
      )
    );

    expect(res.statusCode).toBe(202);
    const body = JSON.parse(String(res.body));
    expect(body.editId).toBe('550e8400-e29b-41d4-a716-446655440099');
    expect(mockEnqueuePhotoProcessing).toHaveBeenCalledWith(['550e8400-e29b-41d4-a716-446655440012']);
    expect(mockPublishSubmissionEditSubmittedEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        submissionId: '550e8400-e29b-41d4-a716-446655440010',
        editId: '550e8400-e29b-41d4-a716-446655440099'
      }),
      'req-submit'
    );
  });

  it('returns 404 when the contributor does not own the submission', async () => {
    mockResolveOptionalContributor.mockResolvedValue({
      ok: true,
      contributor: { sub: 'user-123', email: 'okra@goodroots.test', name: 'Okra Grower' }
    });

    mockClient.query.mockImplementation((text) => {
      if (text === 'begin' || text === 'rollback') {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      if (String(text).includes('from submissions') && String(text).includes('for update')) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const res = await handler(
      makeRestApiEvent(
        '/me/submissions/550e8400-e29b-41d4-a716-446655440010',
        'PATCH',
        JSON.stringify({
          rawLocationText: 'McKinney, TX',
          displayLat: 33.1972,
          displayLng: -96.6398,
          photoIds: []
        }),
        { authorization: 'Bearer test-token' }
      )
    );

    expect(res.statusCode).toBe(404);
  });
});
