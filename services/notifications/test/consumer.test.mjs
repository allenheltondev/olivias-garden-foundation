import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { ddbSendMock } = vi.hoisted(() => ({
  ddbSendMock: vi.fn()
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn().mockImplementation(() => ({}))
}));

vi.mock('@aws-sdk/lib-dynamodb', async () => {
  const actual = await vi.importActual('@aws-sdk/lib-dynamodb');
  return {
    ...actual,
    DynamoDBDocumentClient: { from: () => ({ send: ddbSendMock }) }
  };
});

const { handler } = await import('../src/handlers/consumer.mjs');

function donationEvent(overrides = {}) {
  return {
    id: 'event-id-1',
    source: 'ogf.donations',
    'detail-type': 'donation.completed',
    time: '2026-04-27T15:00:00Z',
    detail: {
      mode: 'one_time',
      amountCents: 5000,
      currency: 'usd',
      donorName: 'Olivia',
      donorEmail: 'olivia@example.com',
      anonymous: false,
      correlationId: 'corr-1',
      ...overrides
    }
  };
}

describe('consumer handler', () => {
  let fetchMock;

  beforeEach(() => {
    ddbSendMock.mockReset();
    process.env.ACTIVITY_EVENTS_TABLE_NAME = 'test-activity-events';
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.test/general';
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SLACK_WEBHOOK_URL;
    delete process.env.CONTACT_SLACK_WEBHOOK_URL;
    delete process.env.ACTIVITY_EVENTS_TABLE_NAME;
  });

  it('persists the event to DynamoDB and forwards a Slack notification', async () => {
    ddbSendMock.mockResolvedValue({});

    await handler(donationEvent());

    expect(ddbSendMock).toHaveBeenCalledTimes(1);
    const putItem = ddbSendMock.mock.calls[0][0].input.Item;
    expect(putItem.pk).toBe('ACTIVITY');
    expect(putItem.sk).toBe('2026-04-27T15:00:00Z#event-id-1');
    expect(putItem.eventId).toBe('event-id-1');
    expect(putItem.source).toBe('ogf.donations');
    expect(putItem.detailType).toBe('donation.completed');
    expect(putItem.summary).toContain('One-time donation');
    expect(putItem.expiresAt).toBeGreaterThan(Math.floor(Date.parse('2026-04-27T15:00:00Z') / 1000));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://hooks.slack.test/general');
  });

  it('routes contact events to the dedicated contact Slack webhook when configured', async () => {
    process.env.CONTACT_SLACK_WEBHOOK_URL = 'https://hooks.slack.test/contact';
    ddbSendMock.mockResolvedValue({});

    await handler({
      id: 'contact-1',
      source: 'ogf.contact',
      'detail-type': 'org-inquiry.received',
      time: '2026-04-27T16:00:00Z',
      detail: { contactName: 'Jordan', email: 'jordan@example.com', orgName: 'Harvest House' }
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://hooks.slack.test/contact');
  });

  it('skips DDB write and Slack for events with no registered renderer', async () => {
    await handler({
      id: 'evt-noop',
      source: 'okra.submissions',
      'detail-type': 'submission.edit_submitted',
      time: '2026-04-27T15:00:00Z',
      detail: {}
    });

    expect(ddbSendMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips Slack on duplicate delivery (ConditionalCheckFailed) to keep notifications idempotent', async () => {
    const conditionalError = new Error('conditional check failed');
    conditionalError.name = 'ConditionalCheckFailedException';
    ddbSendMock.mockRejectedValue(conditionalError);

    await handler(donationEvent());

    expect(ddbSendMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rethrows unexpected DDB errors so EventBridge can retry into the DLQ', async () => {
    const transientError = new Error('throttled');
    transientError.name = 'ProvisionedThroughputExceededException';
    ddbSendMock.mockRejectedValue(transientError);

    await expect(handler(donationEvent())).rejects.toThrow('throttled');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('discards malformed events missing source/detail-type/id', async () => {
    await handler({ source: 'ogf.donations', detail: {} });
    expect(ddbSendMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
