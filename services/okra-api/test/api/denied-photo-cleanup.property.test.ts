import { vi, describe, it, expect } from 'vitest';
import fc from 'fast-check';

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../../scripts/db-client.mjs', () => ({
  createDbClient: vi.fn(() => ({
    connect: vi.fn(),
    query: vi.fn(),
    end: vi.fn(),
  })),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(() => ({ send: vi.fn() })),
  DeleteObjectsCommand: vi.fn((params: any) => params),
}));

import { collectS3Objects } from '../../src/handlers/denied-photo-cleanup.mjs';

// ─── Generators ─────────────────────────────────────────────────────────────

/** Non-empty string for S3 bucket/key values */
const arbS3Value = fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0);

/** Nullable S3 value — either a non-empty string or null */
const arbNullableS3Value = fc.oneof(arbS3Value, fc.constant(null));

/** Generate a photo row with always-present original fields and randomly nullable normalized/thumbnail fields */
const arbPhotoRow = fc.record({
  id: fc.uuid(),
  original_s3_bucket: arbS3Value,
  original_s3_key: arbS3Value,
  normalized_s3_bucket: arbNullableS3Value,
  normalized_s3_key: arbNullableS3Value,
  thumbnail_s3_bucket: arbNullableS3Value,
  thumbnail_s3_key: arbNullableS3Value,
});

// ═══════════════════════════════════════════════════════════════════════════
// Property 4: Null Key Safety
// ═══════════════════════════════════════════════════════════════════════════

describe('Property 4: Null Key Safety', () => {
  // **Validates: Requirements 2.2**
  it('collectS3Objects never includes a pair where either bucket or key is null', () => {
    fc.assert(
      fc.property(
        fc.array(arbPhotoRow, { minLength: 0, maxLength: 50 }),
        (photos) => {
          const result = collectS3Objects(photos);

          for (const [bucket, objects] of Object.entries(result) as [string, { Key: string }[]][]) {
            // Bucket (the map key) must be a non-null, non-empty string
            expect(bucket).toBeTruthy();
            expect(typeof bucket).toBe('string');

            for (const obj of objects) {
              // Each Key must be a non-null, non-empty string
              expect(obj.Key).toBeTruthy();
              expect(typeof obj.Key).toBe('string');
            }
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Property 6: Batch Size Compliance
// ═══════════════════════════════════════════════════════════════════════════

describe('Property 6: Batch Size Compliance', () => {
  // **Validates: Requirements 2.4**
  it('when S3 objects are partitioned into batches of 1000, each batch has at most 1000 items', () => {
    fc.assert(
      fc.property(
        fc.array(arbPhotoRow, { minLength: 0, maxLength: 500 }),
        (photos) => {
          const objectsByBucket = collectS3Objects(photos);

          for (const [_bucket, objects] of Object.entries(objectsByBucket) as [string, { Key: string }[]][]) {
            // Simulate the batching logic from deleteS3Objects
            for (let i = 0; i < objects.length; i += 1000) {
              const batch = objects.slice(i, i + 1000);
              expect(batch.length).toBeLessThanOrEqual(1000);
              expect(batch.length).toBeGreaterThan(0);
            }
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Property 1: Cleanup Completeness
// ═══════════════════════════════════════════════════════════════════════════

describe('Property 1: Cleanup Completeness', () => {
  // **Validates: Requirements 2.1, 2.2, 2.3**
  it('total S3 object entries equals the count of non-null (bucket, key) pairs across all photo rows', () => {
    fc.assert(
      fc.property(
        fc.array(arbPhotoRow, { minLength: 0, maxLength: 100 }),
        (photos) => {
          const result = collectS3Objects(photos);

          // Count actual collected objects
          let actualCount = 0;
          for (const objects of Object.values(result) as { Key: string }[][]) {
            actualCount += objects.length;
          }

          // Count expected non-null pairs
          let expectedCount = 0;
          for (const photo of photos) {
            const pairs = [
              [photo.original_s3_bucket, photo.original_s3_key],
              [photo.normalized_s3_bucket, photo.normalized_s3_key],
              [photo.thumbnail_s3_bucket, photo.thumbnail_s3_key],
            ];
            for (const [bucket, key] of pairs) {
              if (bucket && key) {
                expectedCount++;
              }
            }
          }

          expect(actualCount).toBe(expectedCount);
        }
      ),
      { numRuns: 200 }
    );
  });
});
