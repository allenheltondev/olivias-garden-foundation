import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn()
}));

vi.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: vi.fn(() => ({ send: mockSend })),
  PutEventsCommand: vi.fn((input) => input)
}));

import { publishSubmissionCreatedEvent } from '../../src/services/submission-notifications.mjs';

describe('submission notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('publishes the submission.created event', async () => {
    mockSend.mockResolvedValue({ FailedEntryCount: 0, Entries: [{ EventId: 'evt-123' }] });

    await publishSubmissionCreatedEvent({
      id: 'sub-123',
      status: 'pending_review',
      createdAt: '2026-04-21T12:00:00.000Z',
      contributorName: 'Okra Grower',
      contributorEmail: 'okra@example.com',
      storyText: 'Backyard patch',
      rawLocationText: 'Austin, TX',
      privacyMode: 'city',
      displayLat: 30.2672,
      displayLng: -97.7431,
      photoUrls: ['https://assets.example.com/photo-1']
    }, 'corr-123');

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0]).toEqual({
      Entries: [
        expect.objectContaining({
          Source: 'okra.submissions',
          DetailType: 'submission.created'
        })
      ]
    });
    expect(console.error).not.toHaveBeenCalled();
  });

  it('logs a warning when EventBridge rejects an entry', async () => {
    mockSend.mockResolvedValue({
      FailedEntryCount: 1,
      Entries: [
        {
          ErrorCode: 'ValidationError',
          ErrorMessage: 'Detail is too large'
        }
      ]
    });

    await publishSubmissionCreatedEvent({
      id: 'sub-123',
      rawLocationText: 'Austin, TX',
      privacyMode: 'city',
      photoUrls: []
    }, 'corr-123');

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Failed to publish okra submission notification event'));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('ValidationError'));
  });
});
