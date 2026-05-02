import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockClient = {
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn()
};
const mockDynamoSend = vi.hoisted(() => vi.fn());

vi.mock('../../scripts/db-client.mjs', () => ({
  createDbClient: vi.fn(() => mockClient)
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(() => ({}))
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: vi.fn(() => ({ send: mockDynamoSend }))
  },
  GetCommand: vi.fn((input) => ({ input, _type: 'GetCommand' })),
  TransactWriteCommand: vi.fn((input) => ({ input, _type: 'TransactWriteCommand' })),
  UpdateCommand: vi.fn((input) => ({ input, _type: 'UpdateCommand' }))
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
  process.env.SEED_REQUESTS_TABLE_NAME = 'test-seed-requests';
  vi.clearAllMocks();
  mockClient.query.mockResolvedValue({
    rows: [{ total_pins: 3, country_count: 2, contributor_count: 2 }],
    rowCount: 1
  });
  mockDynamoSend.mockResolvedValue({ Item: { count: 9 } });
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
      contributor_count: 2,
      seed_packets_sent: 9
    });
    expect(res.headers['x-correlation-id']).toBe('corr-123');
  });
});
