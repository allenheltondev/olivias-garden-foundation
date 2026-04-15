import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockClient = {
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn()
};

const mockEnqueuePhotoProcessing = vi.fn();
const mockResolveOptionalContributor = vi.fn();

vi.mock('../../scripts/db-client.mjs', () => ({
  createDbClient: vi.fn(() => mockClient)
}));

vi.mock('../../src/services/photo-processing-queue.mjs', () => ({
  enqueuePhotoProcessing: mockEnqueuePhotoProcessing
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

    if (text.includes('insert into submissions')) {
      return Promise.resolve({
        rows: [{ id: 'sub-123', status: 'pending_review', created_at: '2026-04-15T12:00:00.000Z' }],
        rowCount: 1,
        params
      });
    }

    if (text.includes('update submission_photos')) {
      return Promise.resolve({ rows: [], rowCount: 1 });
    }

    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
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
