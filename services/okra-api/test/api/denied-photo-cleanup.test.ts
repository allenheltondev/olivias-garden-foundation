import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const { mockClient, mockSend } = vi.hoisted(() => ({
  mockClient: {
    connect: vi.fn(),
    query: vi.fn(),
    end: vi.fn(),
  },
  mockSend: vi.fn(),
}));

vi.mock('../../scripts/db-client.mjs', () => ({
  createDbClient: vi.fn(() => mockClient),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(() => ({ send: mockSend })),
  DeleteObjectsCommand: vi.fn((params: any) => params),
}));

import { handler, collectS3Objects } from '../../src/handlers/denied-photo-cleanup.mjs';

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeEventBridgeEvent(submissionId: string) {
  return {
    version: '0',
    id: 'event-id-123',
    source: 'okra.api',
    'detail-type': 'SubmissionDenied',
    account: '123456789012',
    time: '2024-01-15T10:30:00Z',
    region: 'us-east-1',
    detail: { submissionId },
  };
}

function makePhotoRow(overrides: Record<string, any> = {}) {
  return {
    id: 'photo-uuid-1',
    original_s3_bucket: 'media-bucket',
    original_s3_key: 'photos/original/abc.jpg',
    normalized_s3_bucket: 'media-bucket',
    normalized_s3_key: 'photos/normalized/abc.jpg',
    thumbnail_s3_bucket: 'media-bucket',
    thumbnail_s3_key: 'photos/thumb/abc.jpg',
    ...overrides,
  };
}

// ─── Setup / Teardown ───────────────────────────────────────────────────────

beforeEach(() => {
  process.env.DATABASE_URL = 'postgres://localhost:5432/test';
  vi.clearAllMocks();
});

afterEach(() => {
  delete process.env.DATABASE_URL;
});


// ═══════════════════════════════════════════════════════════════════════════
// handler — happy path
// ═══════════════════════════════════════════════════════════════════════════

describe('handler — happy path', () => {
  it('queries photos, deletes S3 objects, then deletes DB rows', async () => {
    const photo = makePhotoRow();
    mockClient.query
      .mockResolvedValueOnce({ rows: [photo] }) // SELECT submission_photos
      .mockResolvedValueOnce({ rowCount: 1 });   // DELETE submission_photos

    mockSend.mockResolvedValueOnce({ Errors: [] });

    await handler(makeEventBridgeEvent('sub-uuid-1'), {});

    // Verify SELECT query
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM submission_photos'),
      ['sub-uuid-1'],
    );

    // Verify S3 DeleteObjects was called with all 3 keys
    expect(mockSend).toHaveBeenCalledTimes(1);
    const deleteCmd = mockSend.mock.calls[0][0];
    expect(deleteCmd.Bucket).toBe('media-bucket');
    expect(deleteCmd.Delete.Objects).toHaveLength(3);
    expect(deleteCmd.Delete.Objects).toEqual(
      expect.arrayContaining([
        { Key: 'photos/original/abc.jpg' },
        { Key: 'photos/normalized/abc.jpg' },
        { Key: 'photos/thumb/abc.jpg' },
      ]),
    );

    // Verify DB delete after S3
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM submission_photos'),
      ['sub-uuid-1'],
    );

    // Verify connection closed
    expect(mockClient.end).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// handler — no photos (idempotent no-op)
// ═══════════════════════════════════════════════════════════════════════════

describe('handler — no photos', () => {
  it('returns without S3 or DB delete calls when no photos exist', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [] });

    await handler(makeEventBridgeEvent('sub-uuid-1'), {});

    // Only the SELECT query should have been made
    expect(mockClient.query).toHaveBeenCalledTimes(1);
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM submission_photos'),
      ['sub-uuid-1'],
    );

    // No S3 calls
    expect(mockSend).not.toHaveBeenCalled();

    // Connection still closed
    expect(mockClient.end).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// handler — partial S3 failure
// ═══════════════════════════════════════════════════════════════════════════

describe('handler — partial S3 failure', () => {
  it('throws and does not delete DB rows when S3 returns errors', async () => {
    const photo = makePhotoRow();
    mockClient.query.mockResolvedValueOnce({ rows: [photo] });

    mockSend.mockResolvedValueOnce({
      Errors: [{ Key: 'photos/original/abc.jpg', Code: 'InternalError', Message: 'oops' }],
    });

    await expect(handler(makeEventBridgeEvent('sub-uuid-1'), {})).rejects.toThrow(
      /Failed to delete S3 objects/,
    );

    // Only the SELECT query — no DELETE query
    expect(mockClient.query).toHaveBeenCalledTimes(1);

    // Connection still closed despite error
    expect(mockClient.end).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// handler — null S3 keys skipped
// ═══════════════════════════════════════════════════════════════════════════

describe('handler — null S3 keys skipped', () => {
  it('only includes non-null bucket/key pairs in DeleteObjects', async () => {
    const photo = makePhotoRow({
      normalized_s3_bucket: null,
      normalized_s3_key: null,
      thumbnail_s3_bucket: null,
      thumbnail_s3_key: null,
    });
    mockClient.query
      .mockResolvedValueOnce({ rows: [photo] })
      .mockResolvedValueOnce({ rowCount: 1 });

    mockSend.mockResolvedValueOnce({ Errors: [] });

    await handler(makeEventBridgeEvent('sub-uuid-1'), {});

    // Only the original key should be in the delete call
    const deleteCmd = mockSend.mock.calls[0][0];
    expect(deleteCmd.Delete.Objects).toHaveLength(1);
    expect(deleteCmd.Delete.Objects).toEqual([{ Key: 'photos/original/abc.jpg' }]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DB connection closed on success and failure
// ═══════════════════════════════════════════════════════════════════════════

describe('DB connection cleanup', () => {
  it('closes connection after successful cleanup', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [makePhotoRow()] })
      .mockResolvedValueOnce({ rowCount: 1 });
    mockSend.mockResolvedValueOnce({ Errors: [] });

    await handler(makeEventBridgeEvent('sub-uuid-1'), {});

    expect(mockClient.end).toHaveBeenCalledTimes(1);
  });

  it('closes connection even when S3 deletion throws', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [makePhotoRow()] });
    mockSend.mockResolvedValueOnce({
      Errors: [{ Key: 'photos/original/abc.jpg', Code: 'InternalError', Message: 'fail' }],
    });

    await expect(handler(makeEventBridgeEvent('sub-uuid-1'), {})).rejects.toThrow();

    expect(mockClient.end).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// collectS3Objects — unit tests
// ═══════════════════════════════════════════════════════════════════════════

describe('collectS3Objects', () => {
  it('groups objects by bucket for a photo with all fields', () => {
    const result = collectS3Objects([makePhotoRow()]);
    expect(result).toEqual({
      'media-bucket': [
        { Key: 'photos/original/abc.jpg' },
        { Key: 'photos/normalized/abc.jpg' },
        { Key: 'photos/thumb/abc.jpg' },
      ],
    });
  });

  it('skips null bucket/key pairs', () => {
    const result = collectS3Objects([
      makePhotoRow({ normalized_s3_bucket: null, normalized_s3_key: null }),
    ]);
    expect(result['media-bucket']).toHaveLength(2);
    expect(result['media-bucket']).toEqual([
      { Key: 'photos/original/abc.jpg' },
      { Key: 'photos/thumb/abc.jpg' },
    ]);
  });

  it('returns empty object for empty photos array', () => {
    expect(collectS3Objects([])).toEqual({});
  });
});

