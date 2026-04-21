import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockClient = {
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn()
};

vi.mock('../../scripts/db-client.mjs', () => ({
  createDbClient: vi.fn(() => mockClient)
}));

import { handler } from '../../src/handlers/api.mjs';

function makeRestApiEvent(path, method = 'GET', headers = {}) {
  return {
    resource: '/{proxy+}',
    path,
    httpMethod: method,
    headers,
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    requestContext: {
      requestId: 'req-1',
      path,
      stage: 'api',
      identity: {
        sourceIp: '127.0.0.1',
        userAgent: 'vitest'
      }
    },
    body: null,
    isBase64Encoded: false
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockClient.query.mockResolvedValue({
    rows: [{ total_pins: 3, country_count: 2, contributor_count: 2 }],
    rowCount: 1
  });
});

describe('api handler wrapper', () => {
  it('returns not-found payload for unknown route', async () => {
    const res = await handler(makeRestApiEvent('/does-not-exist'));

    expect(res.statusCode).toBe(404);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['x-correlation-id']).toBe('req-1');
  });

  it('normalizes the API stage prefix before router resolution', async () => {
    const res = await handler(
      makeRestApiEvent('/api/okra/stats', 'GET', {
        'x-correlation-id': 'corr-123'
      })
    );

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(String(res.body))).toEqual({
      total_pins: 3,
      country_count: 2,
      contributor_count: 2
    });
    expect(res.headers['x-correlation-id']).toBe('corr-123');
  });
});
