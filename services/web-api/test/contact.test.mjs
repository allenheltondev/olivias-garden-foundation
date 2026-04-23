import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handler } from '../src/handlers/api.mjs';

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
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.CONTACT_SLACK_WEBHOOK_URL;
  });

  it('accepts a valid organization inquiry and posts to Slack', async () => {
    process.env.CONTACT_SLACK_WEBHOOK_URL = 'https://slack.example.com/hook';

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
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://slack.example.com/hook');
    const payload = JSON.parse(init.body);
    expect(payload.text).toContain('Harvest House');
    expect(payload.text).toContain('Food pantry');
    expect(payload.text).toContain('Jordan Rivers');
    expect(payload.text).toContain('jordan@harvesthouse.org');
    expect(payload.text).toContain('McKinney, TX');
  });

  it('succeeds without Slack when webhook is not configured', async () => {
    const response = await handler(createEvent({
      kind: 'organization_inquiry',
      contactName: 'Jordan Rivers',
      email: 'jordan@harvesthouse.org'
    }));

    expect(response.statusCode).toBe(204);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 422 when required fields are missing', async () => {
    const response = await handler(createEvent({
      kind: 'organization_inquiry',
      email: 'jordan@harvesthouse.org'
    }));

    expect(response.statusCode).toBe(422);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid email', async () => {
    const response = await handler(createEvent({
      kind: 'organization_inquiry',
      contactName: 'Jordan Rivers',
      email: 'not-an-email'
    }));

    expect(response.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
