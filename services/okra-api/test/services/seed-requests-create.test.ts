import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSend, mockEventBridgeSend } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockEventBridgeSend: vi.fn()
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn().mockImplementation(() => ({}))
}));

vi.mock('@aws-sdk/lib-dynamodb', () => {
  class TransactWriteCommand {
    input;
    constructor(input) {
      this.input = input;
    }
  }

  class UpdateCommand {
    input;
    constructor(input) {
      this.input = input;
    }
  }

  return {
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    TransactWriteCommand,
    UpdateCommand
  };
});

vi.mock('@aws-sdk/client-eventbridge', async () => {
  const { PutEventsCommand } = await vi.importActual<typeof import('@aws-sdk/client-eventbridge')>(
    '@aws-sdk/client-eventbridge'
  );
  return {
    EventBridgeClient: class {
      send = mockEventBridgeSend;
    },
    PutEventsCommand
  };
});

import { createSeedRequest, publishSeedRequestCreatedEvent } from '../../src/services/seed-requests.mjs';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SEED_REQUESTS_TABLE_NAME = 'test-seed-requests';
  mockSend.mockResolvedValue({});
  mockEventBridgeSend.mockResolvedValue({ FailedEntryCount: 0, Entries: [] });
});

describe('createSeedRequest', () => {
  it('omits contributorCognitoSub for anonymous requests', async () => {
    await createSeedRequest(
      {
        name: 'Olivia Helton',
        email: 'olivia@example.com',
        fulfillmentMethod: 'mail',
        shippingAddress: {
          line1: '100 Garden Lane',
          city: 'Austin',
          region: 'TX',
          postalCode: '73301',
          country: 'US'
        }
      },
      null
    );

    expect(mockSend).toHaveBeenCalledOnce();
    const command = mockSend.mock.calls[0][0];
    const putItem = command.input.TransactItems[0].Put.Item;
    expect(putItem).not.toHaveProperty('contributorCognitoSub');
    expect(command.input.TransactItems[1].Update.Key).toEqual({ requestId: 'stats#seed-requests' });
  });

  it('stores contributorCognitoSub for authenticated requests', async () => {
    await createSeedRequest(
      {
        name: 'Olivia Helton',
        email: 'olivia@example.com',
        fulfillmentMethod: 'in_person'
      },
      { sub: 'cog-123' }
    );

    const command = mockSend.mock.calls[0][0];
    const putItem = command.input.TransactItems[0].Put.Item;
    expect(putItem.contributorCognitoSub).toBe('cog-123');
    expect(command.input.TransactItems[1].Update.UpdateExpression).toContain('ADD #count :one');
  });
});

describe('publishSeedRequestCreatedEvent', () => {
  it('emits an EventBridge event without contributor identifiers', async () => {
    await publishSeedRequestCreatedEvent(
      {
        requestId: 'req-1',
        createdAt: '2026-04-27T12:00:00.000Z',
        name: 'Olivia Helton',
        email: 'olivia@example.com',
        fulfillmentMethod: 'mail',
        shippingAddress: {
          line1: '100 Garden Lane',
          city: 'Austin',
          region: 'TX',
          postalCode: '73301',
          country: 'US'
        },
        contributorCognitoSub: 'cog-123'
      },
      'corr-seed'
    );

    expect(mockEventBridgeSend).toHaveBeenCalledOnce();
    const command = mockEventBridgeSend.mock.calls[0][0];
    const entry = command.input.Entries[0];
    expect(entry.Source).toBe('okra.seed-requests');
    expect(entry.DetailType).toBe('seed-request.created');
    const detail = JSON.parse(entry.Detail);
    expect(detail.name).toBe('Olivia Helton');
    expect(detail).not.toHaveProperty('contributorCognitoSub');
    expect(JSON.stringify(detail)).not.toContain('cog-123');
  });
});
