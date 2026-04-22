import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn()
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn().mockImplementation(() => ({}))
}));

vi.mock('@aws-sdk/lib-dynamodb', () => {
  class PutCommand {
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
    PutCommand,
    UpdateCommand
  };
});

import { createSeedRequest } from '../../src/services/seed-requests.mjs';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SEED_REQUESTS_TABLE_NAME = 'test-seed-requests';
  mockSend.mockResolvedValue({});
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
    expect(command.input.Item).not.toHaveProperty('contributorCognitoSub');
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
    expect(command.input.Item.contributorCognitoSub).toBe('cog-123');
  });
});
