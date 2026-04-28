import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const eventBridgeSendMock = vi.fn();

vi.mock('@aws-sdk/client-eventbridge', async () => {
  const actual = await vi.importActual('@aws-sdk/client-eventbridge');
  return {
    ...actual,
    EventBridgeClient: class {
      send = eventBridgeSendMock;
    }
  };
});

const { handler } = await import('../src/handlers/api.mjs');

function createEvent(body) {
  return {
    version: '2.0',
    routeKey: 'POST /contact',
    rawPath: '/contact',
    rawQueryString: '',
    headers: {},
    requestContext: {
      http: {
        method: 'POST',
        path: '/contact',
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'vitest'
      },
      requestId: 'request-id'
    },
    isBase64Encoded: false,
    body: body === undefined ? undefined : JSON.stringify(body)
  };
}

describe('POST /contact', () => {
  beforeEach(() => {
    eventBridgeSendMock.mockReset();
    eventBridgeSendMock.mockResolvedValue({ FailedEntryCount: 0, Entries: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts a valid organization inquiry and publishes a contact event', async () => {
    const response = await handler(createEvent({
      kind: 'organization_inquiry',
      orgName: 'Harvest House',
      contactName: 'Jordan Rivers',
      email: 'jordan@harvesthouse.org',
      orgType: 'food-pantry',
      city: 'McKinney',
      state: 'TX',
      message: 'We feed 200 families a week.'
    }));

    expect(response.statusCode).toBe(204);
    expect(eventBridgeSendMock).toHaveBeenCalledTimes(1);
    const command = eventBridgeSendMock.mock.calls[0][0];
    const entry = command.input.Entries[0];
    expect(entry.Source).toBe('ogf.contact');
    expect(entry.DetailType).toBe('org-inquiry.received');
    const detail = JSON.parse(entry.Detail);
    expect(detail.orgName).toBe('Harvest House');
    expect(detail.contactName).toBe('Jordan Rivers');
    expect(detail.email).toBe('jordan@harvesthouse.org');
    expect(detail.city).toBe('McKinney');
  });

  it('returns 422 when required fields are missing', async () => {
    const response = await handler(createEvent({
      kind: 'organization_inquiry',
      email: 'jordan@harvesthouse.org'
    }));

    expect(response.statusCode).toBe(422);
    expect(eventBridgeSendMock).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid email', async () => {
    const response = await handler(createEvent({
      kind: 'organization_inquiry',
      contactName: 'Jordan Rivers',
      email: 'not-an-email'
    }));

    expect(response.statusCode).toBe(400);
    expect(eventBridgeSendMock).not.toHaveBeenCalled();
  });
});
