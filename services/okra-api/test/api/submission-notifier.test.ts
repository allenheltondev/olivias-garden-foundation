import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handler } from '../../src/handlers/submission-notifier.mjs';

describe('submission notifier', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.test/services/okra';
    process.env.OKRA_ADMIN_FRONTEND_URL = 'https://admin.oliviasgarden.test';
  });

  it('posts a rich Slack payload with image previews and review link', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    await handler({
      id: 'evt-123',
      detail: {
        submissionId: 'sub-123',
        contributorName: 'Okra Grower',
        contributorEmail: 'okra@example.com',
        storyText: 'A beautiful patch in the backyard.',
        rawLocationText: 'Austin, TX',
        privacyMode: 'city',
        displayLat: 30.2672,
        displayLng: -97.7431,
        createdAt: '2026-04-21T12:00:00.000Z',
        photoUrls: [
          'https://assets.oliviasgarden.test/temp-photos/photo-1/original',
          'https://assets.oliviasgarden.test/temp-photos/photo-2/original'
        ],
        correlationId: 'corr-123'
      }
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://hooks.slack.test/services/okra',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' }
      })
    );

    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.text).toContain('Okra Grower');
    expect(payload.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'header' }),
        expect.objectContaining({ type: 'image', image_url: 'https://assets.oliviasgarden.test/temp-photos/photo-1/original' }),
        expect.objectContaining({
          type: 'actions',
          elements: [
            expect.objectContaining({
              text: expect.objectContaining({ text: 'Open review queue' }),
              url: 'https://admin.oliviasgarden.test/?submission=sub-123'
            })
          ]
        })
      ])
    );
  });

  it('returns without calling Slack when the webhook is not configured', async () => {
    delete process.env.SLACK_WEBHOOK_URL;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await handler({
      id: 'evt-123',
      detail: {
        submissionId: 'sub-123',
        rawLocationText: 'Austin, TX'
      }
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
