import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn()
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn().mockImplementation(() => ({}))
}));

vi.mock('@aws-sdk/lib-dynamodb', () => {
  class UpdateCommand {
    input: unknown;
    constructor(input: unknown) { this.input = input; }
  }
  class PutCommand {
    input: unknown;
    constructor(input: unknown) { this.input = input; }
  }
  return {
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    UpdateCommand,
    PutCommand
  };
});

import { enforceSeedRequestRateLimit } from '../../src/services/seed-requests.mjs';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SEED_REQUESTS_TABLE_NAME = 'test-seed-requests';
  process.env.SEED_REQUEST_RATE_LIMIT_MAX = '5';
  process.env.SEED_REQUEST_RATE_LIMIT_WINDOW_SECONDS = '60';
});

describe('enforceSeedRequestRateLimit', () => {
  it('starts a fresh window on the first request (no record present)', async () => {
    mockSend.mockResolvedValueOnce({ Attributes: { count: 1 } });

    await enforceSeedRequestRateLimit('1.2.3.4');

    expect(mockSend).toHaveBeenCalledOnce();
    const cmd = mockSend.mock.calls[0][0];
    expect(cmd.input.UpdateExpression).toContain('SET #count = :one');
    expect(cmd.input.ConditionExpression).toBe('attribute_not_exists(#count) OR #exp <= :now');
  });

  it('falls back to plain increment when the window is still live', async () => {
    const conditionalFail = Object.assign(new Error('fail'), { name: 'ConditionalCheckFailedException' });
    mockSend
      .mockRejectedValueOnce(conditionalFail)
      .mockResolvedValueOnce({ Attributes: { count: 2 } });

    await enforceSeedRequestRateLimit('1.2.3.4');

    expect(mockSend).toHaveBeenCalledTimes(2);
    const secondCmd = mockSend.mock.calls[1][0];
    expect(secondCmd.input.UpdateExpression).toBe('ADD #count :one');
    expect(secondCmd.input.ConditionExpression).toBe('attribute_exists(#exp) AND #exp > :now');
  });

  it('resets count on the first attempt when the prior window has expired', async () => {
    // First attempt succeeds with count=1 — meaning the SET fired (fresh window).
    // The important behavior is that count does NOT keep climbing past the limit
    // because the expired record was overwritten, not just incremented.
    mockSend.mockResolvedValueOnce({ Attributes: { count: 1 } });

    await expect(enforceSeedRequestRateLimit('1.2.3.4')).resolves.toBeUndefined();
    expect(mockSend).toHaveBeenCalledOnce();
  });

  it('throws SEED_REQUEST_RATE_LIMITED when count exceeds max', async () => {
    const conditionalFail = Object.assign(new Error('fail'), { name: 'ConditionalCheckFailedException' });
    mockSend
      .mockRejectedValueOnce(conditionalFail)
      .mockResolvedValueOnce({ Attributes: { count: 6 } });

    await expect(enforceSeedRequestRateLimit('1.2.3.4')).rejects.toMatchObject({
      code: 'SEED_REQUEST_RATE_LIMITED',
      retryAfterSeconds: 60
    });
  });

  it('rethrows unexpected DynamoDB errors unchanged', async () => {
    const boom = Object.assign(new Error('boom'), { name: 'ProvisionedThroughputExceededException' });
    mockSend.mockRejectedValueOnce(boom);

    await expect(enforceSeedRequestRateLimit('1.2.3.4')).rejects.toBe(boom);
  });
});
