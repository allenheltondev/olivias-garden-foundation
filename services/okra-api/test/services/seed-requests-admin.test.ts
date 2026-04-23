import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn()
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn().mockImplementation(() => ({}))
}));

vi.mock('@aws-sdk/lib-dynamodb', () => {
  class ScanCommand {
    input: any;
    constructor(input: any) {
      this.input = input;
    }
  }
  class UpdateCommand {
    input: any;
    constructor(input: any) {
      this.input = input;
    }
  }
  return {
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    ScanCommand,
    UpdateCommand
  };
});

import {
  countOpenSeedRequests,
  listOpenSeedRequests,
  markSeedRequestHandled
} from '../../src/services/seed-requests-admin.mjs';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SEED_REQUESTS_TABLE_NAME = 'test-seed-requests';
});

describe('listOpenSeedRequests', () => {
  it('filters out counter/ratelimit rows and orders by createdAt desc', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          requestId: 'a1111111-1111-4111-8111-111111111111',
          createdAt: '2026-03-05T12:00:00Z',
          name: 'Alice',
          email: 'alice@example.com',
          fulfillmentMethod: 'mail'
        },
        { requestId: 'ratelimit#10.0.0.1', count: 3, expiresAt: 9999 },
        { requestId: 'stats#seed-requests', count: 42, entityType: 'seed_request_stats' },
        {
          requestId: 'b2222222-2222-4222-8222-222222222222',
          createdAt: '2026-04-20T08:00:00Z',
          name: 'Bob',
          email: 'bob@example.com',
          fulfillmentMethod: 'in_person'
        }
      ]
    });

    const result = await listOpenSeedRequests();

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Bob');
    expect(result[1].name).toBe('Alice');
  });

  it('sends a ScanCommand with the open status filter', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    await listOpenSeedRequests();

    const command = mockSend.mock.calls[0][0];
    expect(command.input.TableName).toBe('test-seed-requests');
    expect(command.input.FilterExpression).toContain('#status');
    expect(command.input.ExpressionAttributeValues).toEqual({ ':open': 'open' });
  });

  it('paginates with ExclusiveStartKey until LastEvaluatedKey is absent', async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [
          {
            requestId: 'a1111111-1111-4111-8111-111111111111',
            createdAt: '2026-03-05T12:00:00Z',
            name: 'Alice',
            fulfillmentMethod: 'mail'
          }
        ],
        LastEvaluatedKey: { requestId: 'a1111111-1111-4111-8111-111111111111' }
      })
      .mockResolvedValueOnce({
        Items: [
          {
            requestId: 'b2222222-2222-4222-8222-222222222222',
            createdAt: '2026-04-20T08:00:00Z',
            name: 'Bob',
            fulfillmentMethod: 'in_person'
          }
        ]
      });

    const result = await listOpenSeedRequests();

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(2);
  });
});

describe('countOpenSeedRequests', () => {
  it('returns the length of the open list', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        { requestId: 'a1111111-1111-4111-8111-111111111111', createdAt: '2026-03-05T12:00:00Z', name: 'A' },
        { requestId: 'b2222222-2222-4222-8222-222222222222', createdAt: '2026-04-20T08:00:00Z', name: 'B' },
        { requestId: 'ratelimit#ip', count: 3 }
      ]
    });

    await expect(countOpenSeedRequests()).resolves.toBe(2);
  });
});

describe('markSeedRequestHandled', () => {
  it('returns the mapped request on success', async () => {
    mockSend.mockResolvedValueOnce({
      Attributes: {
        requestId: 'a1111111-1111-4111-8111-111111111111',
        createdAt: '2026-03-05T12:00:00Z',
        name: 'Alice',
        email: 'alice@example.com',
        fulfillmentMethod: 'mail',
        status: 'handled',
        handledAt: '2026-04-23T15:30:00Z',
        handledByCognitoSub: 'admin-sub'
      }
    });

    const result = await markSeedRequestHandled(
      'a1111111-1111-4111-8111-111111111111',
      'admin-sub'
    );

    expect(result?.status).toBe('handled');
    expect(result?.handledByCognitoSub).toBe('admin-sub');
    const command = mockSend.mock.calls[0][0];
    expect(command.input.Key).toEqual({ requestId: 'a1111111-1111-4111-8111-111111111111' });
    expect(command.input.ConditionExpression).toContain('attribute_exists(requestId)');
  });

  it('returns null when the conditional check fails', async () => {
    mockSend.mockRejectedValueOnce(Object.assign(new Error('conditional'), {
      name: 'ConditionalCheckFailedException'
    }));

    const result = await markSeedRequestHandled(
      'a1111111-1111-4111-8111-111111111111',
      'admin-sub'
    );

    expect(result).toBeNull();
  });

  it('rethrows other errors', async () => {
    mockSend.mockRejectedValueOnce(new Error('boom'));

    await expect(
      markSeedRequestHandled('a1111111-1111-4111-8111-111111111111', 'admin-sub')
    ).rejects.toThrow('boom');
  });
});
