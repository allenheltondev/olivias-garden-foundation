import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn()
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

import { createSeedRequest, notifySeedRequestSlack } from '../../src/services/seed-requests.mjs';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SEED_REQUESTS_TABLE_NAME = 'test-seed-requests';
  process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.test/okra';
  mockSend.mockResolvedValue({});
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
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

describe('notifySeedRequestSlack', () => {
  it('does not include contributor identifiers in the Slack message body', async () => {
    await notifySeedRequestSlack(
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
        },
        contributorCognitoSub: 'cog-123'
      },
      'corr-seed'
    );

    expect(fetch).toHaveBeenCalledOnce();
    const [, options] = fetch.mock.calls[0];
    const payload = JSON.parse(options.body);
    expect(payload.text).toContain('*:clipboard: New okra seed request*');
    expect(payload.text).not.toContain('Signed-in user');
    expect(payload.text).not.toContain('cog-123');
  });
});
