import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';

// ─── Mocks ──────────────────────────────────────────────────────────────────

let queryResponses: Record<string, any>;

const mockClient = {
  connect: vi.fn(),
  query: vi.fn((text: string, params?: any[]) => {
    for (const [pattern, response] of Object.entries(queryResponses)) {
      if (text.includes(pattern)) {
        if (typeof response === 'function') return response(text, params);
        return response;
      }
    }
    return { rows: [], rowCount: 0 };
  }),
  end: vi.fn(),
};

vi.mock('../../scripts/db-client.mjs', () => ({
  createDbClient: vi.fn(() => mockClient),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn((_client: any, command: any) =>
    Promise.resolve(`https://s3.example.com/signed/${command?.Key ?? 'unknown'}`)
  ),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(() => ({})),
  GetObjectCommand: vi.fn((params: any) => params),
}));

vi.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: vi.fn(() => ({ send: vi.fn(() => Promise.resolve({})) })),
  PutEventsCommand: vi.fn((params: any) => params),
}));

// handler import removed — GET /okra is no longer paginated

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeRestApiEvent(
  path: string,
  method = 'GET',
  options: {
    queryStringParameters?: Record<string, string> | null;
  } = {}
) {
  return {
    resource: '/{proxy+}',
    path,
    httpMethod: method,
    headers: {},
    multiValueHeaders: {},
    queryStringParameters: options.queryStringParameters ?? null,
    multiValueQueryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    requestContext: {
      requestId: 'req-prop-test',
      path,
      stage: 'api',
      identity: { sourceIp: '127.0.0.1', userAgent: 'vitest' },
    },
    body: null,
    isBase64Encoded: false,
  };
}

function parseRes(res: any) {
  return { statusCode: res.statusCode, body: JSON.parse(res.body) };
}

// ─── Generators ─────────────────────────────────────────────────────────────

// (Public endpoint generators removed — GET /okra is no longer paginated)

// ─── Setup / Teardown ───────────────────────────────────────────────────────

beforeEach(() => {
  process.env.MEDIA_CDN_DOMAIN = 'dtest123.cloudfront.net';
  queryResponses = {};
  vi.clearAllMocks();
});

afterEach(() => {
  delete process.env.MEDIA_CDN_DOMAIN;
});

// ─── Mock reset helper ──────────────────────────────────────────────────────

function resetMocks() {
  vi.clearAllMocks();
  mockClient.connect.mockImplementation(() => {});
  mockClient.end.mockImplementation(() => {});
  mockClient.query.mockImplementation((text: string, params?: any[]) => {
    for (const [pattern, response] of Object.entries(queryResponses)) {
      if (text.includes(pattern)) {
        if (typeof response === 'function') return response(text, params);
        return response;
      }
    }
    return { rows: [], rowCount: 0 };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Property 1: (Removed — GET /okra is no longer paginated; see okra-map spec)
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// Property 2: (Removed — GET /okra is no longer paginated; see okra-map spec)
// ═══════════════════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════════════════
// Property 3: (Removed — GET /okra is no longer paginated; see okra-map spec)
// ═══════════════════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════════════════
// Property 4: (Removed — GET /okra is no longer paginated; see okra-map spec)
// ═══════════════════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════════════════
// Property 8: (Removed — GET /okra no longer validates limit/cursor; see okra-map spec)
// ═══════════════════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════════════════
// Property 9: Invalid Cursor Rejection
// ═══════════════════════════════════════════════════════════════════════════

// Feature: paginated-endpoints, Property 9: Invalid Cursor Rejection

// Import admin handler for testing the review-queue endpoint
const { handler: adminHandler } = await import('../../src/handlers/admin-api.mjs');

describe('Property 9: Invalid Cursor Rejection', () => {
  // **Validates: Requirements 7.6**

  /** Generator for random strings that are NOT valid base64url */
  const arbRandomString = fc.stringOf(
    fc.char().filter((c) => /[^A-Za-z0-9_\-]/.test(c)),
    { minLength: 1, maxLength: 50 }
  ).filter((s) => s.trim().length > 0);

  /** Generator for valid base64url strings that decode to invalid JSON */
  const arbBase64urlInvalidJson = fc
    .stringOf(fc.char(), { minLength: 1, maxLength: 30 })
    .filter((s) => {
      try {
        JSON.parse(s);
        return false; // skip if it happens to be valid JSON
      } catch {
        return true;
      }
    })
    .map((s) => Buffer.from(s).toString('base64url'));

  /** Generator for valid base64url-encoded JSON but missing created_at or id fields */
  const arbBase64urlJsonMissingFields = fc.oneof(
    // Has id but no created_at
    fc.record({ id: fc.uuid() }).map((obj) =>
      Buffer.from(JSON.stringify(obj)).toString('base64url')
    ),
    // Has created_at but no id
    fc.record({
      created_at: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }).map((d) => d.toISOString()),
    }).map((obj) =>
      Buffer.from(JSON.stringify(obj)).toString('base64url')
    ),
    // Empty object
    fc.constant(Buffer.from(JSON.stringify({})).toString('base64url')),
    // Has both fields but they are null
    fc.constant(
      Buffer.from(JSON.stringify({ created_at: null, id: null })).toString('base64url')
    )
  );

  /** Generator for valid JSON with invalid timestamp for created_at */
  const arbBase64urlJsonInvalidTimestamp = fc
    .tuple(
      fc.stringOf(fc.char(), { minLength: 1, maxLength: 20 }).filter((s) => {
        const d = new Date(s);
        return isNaN(d.getTime()); // must be an unparseable timestamp
      }),
      fc.uuid()
    )
    .map(([badTs, id]) =>
      Buffer.from(JSON.stringify({ created_at: badTs, id })).toString('base64url')
    );

  /** Generator for valid JSON with non-UUID id */
  const arbBase64urlJsonNonUuidId = fc
    .tuple(
      fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }).map((d) => d.toISOString()),
      fc.oneof(
        fc.string({ minLength: 1, maxLength: 20 }).filter(
          (s) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)
        ),
        fc.constant('not-a-uuid'),
        fc.constant('12345'),
        fc.integer({ min: 1, max: 99999 }).map(String)
      )
    )
    .map(([ts, badId]) =>
      Buffer.from(JSON.stringify({ created_at: ts, id: badId })).toString('base64url')
    );

  /** Combined generator for all types of invalid cursors */
  const arbInvalidCursor = fc.oneof(
    arbRandomString,
    arbBase64urlInvalidJson,
    arbBase64urlJsonMissingFields,
    arbBase64urlJsonInvalidTimestamp,
    arbBase64urlJsonNonUuidId
  );

  it('invalid cursor values return 400 INVALID_CURSOR on GET /admin/submissions/review-queue', async () => {
    await fc.assert(
      fc.asyncProperty(arbInvalidCursor, async (invalidCursor) => {
        resetMocks();
        queryResponses = {};
        process.env.MEDIA_BUCKET_NAME = 'test-bucket';

        const res = await adminHandler(
          makeRestApiEvent('/submissions/review-queue', 'GET', {
            queryStringParameters: { cursor: invalidCursor },
          })
        );
        const { statusCode, body } = parseRes(res);
        expect(statusCode).toBe(400);
        expect(body.error.code).toBe('INVALID_CURSOR');
        expect(typeof body.error.message).toBe('string');
        expect(body.error.message.length).toBeGreaterThan(0);
      }),
      { numRuns: 75 }
    );
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// Property 10: Admin Review Queue Pagination Completeness with Photo Readiness Filter
// ═══════════════════════════════════════════════════════════════════════════

// Feature: paginated-endpoints, Property 10: Admin Review Queue Pagination Completeness with Photo Readiness Filter
describe('Property 10: Admin Review Queue Pagination Completeness with Photo Readiness Filter', () => {
  // **Validates: Requirements 5.1, 5.4, 8.1**

  const arbPhotoStatus = fc.constantFrom('ready', 'uploaded', 'processing', 'failed') as fc.Arbitrary<
    'ready' | 'uploaded' | 'processing' | 'failed'
  >;

  /** Generate a submission with random status, timestamps, and photos with varying statuses */
  const arbSubmissionWithPhotos = fc.record({
    id: fc.uuid(),
    status: fc.constantFrom('pending_review', 'approved', 'denied'),
    created_at: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }),
    photos: fc.array(
      fc.record({
        id: fc.uuid(),
        status: arbPhotoStatus,
        original_s3_key: fc.uuid().map((u) => `photos/${u}/original.jpg`),
        created_at: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }),
      }),
      { minLength: 0, maxLength: 4 }
    ),
  });

  it('iterating all pages yields exactly the pending_review submissions with ready photos, oldest first', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbSubmissionWithPhotos, { minLength: 0, maxLength: 25 }),
        fc.integer({ min: 1, max: 8 }),
        async (submissions, pageSize) => {
          // Determine expected set: pending_review AND has at least one ready photo
          const hasReadyPhoto = (s: typeof submissions[number]) =>
            s.photos.some((p) => p.status === 'ready');

          const expected = submissions
            .filter((s) => s.status === 'pending_review' && hasReadyPhoto(s))
            .sort((a, b) => {
              const timeDiff = a.created_at.getTime() - b.created_at.getTime();
              if (timeDiff !== 0) return timeDiff;
              return a.id.localeCompare(b.id); // ASC by id as tiebreaker
            });

          // Mock DB to simulate cursor-based pagination with ASC ordering
          queryResponses = {
            'FROM submissions': (_text: string, params: any[]) => {
              const limit = params[params.length - 1]; // last param is always limit

              let filtered = submissions
                .filter((s) => s.status === 'pending_review' && hasReadyPhoto(s))
                .sort((a, b) => {
                  const timeDiff = a.created_at.getTime() - b.created_at.getTime();
                  if (timeDiff !== 0) return timeDiff;
                  return a.id.localeCompare(b.id);
                });

              // Apply cursor if present (cursor query has 3 params: created_at, id, limit)
              if (params.length === 3) {
                const cursorDate = new Date(params[0]);
                const cursorId = params[1];
                filtered = filtered.filter((s) => {
                  const timeDiff = s.created_at.getTime() - cursorDate.getTime();
                  if (timeDiff > 0) return true; // later created_at → comes after in ASC
                  if (timeDiff === 0) return s.id > cursorId; // same time, larger id → after in ASC
                  return false;
                });
              }

              const rows = filtered.slice(0, limit).map((s) => ({
                id: s.id,
                contributor_name: `User-${s.id.slice(0, 4)}`,
                contributor_email: `user-${s.id.slice(0, 4)}@example.com`,
                story_text: 'Story',
                raw_location_text: 'Location',
                privacy_mode: 'exact',
                display_lat: 34.05,
                display_lng: -118.24,
                status: s.status,
                created_at: s.created_at,
                created_at_raw: s.created_at.toISOString().replace('T', ' ').replace('Z', '+00'),
              }));
              return { rows, rowCount: rows.length };
            },
            'FROM submission_photos': (_text: string, params: any[]) => {
              const requestedIds: string[] = params[0];
              const rows: any[] = [];
              for (const s of submissions) {
                if (!requestedIds.includes(s.id)) continue;
                for (const p of s.photos) {
                  if (p.status === 'ready') {
                    rows.push({
                      submission_id: s.id,
                      original_s3_key: p.original_s3_key,
                      created_at: p.created_at,
                    });
                  }
                }
              }
              // Sort by submission_id, created_at ASC (matching the real query)
              rows.sort((a, b) => {
                const subCmp = a.submission_id.localeCompare(b.submission_id);
                if (subCmp !== 0) return subCmp;
                return a.created_at.getTime() - b.created_at.getTime();
              });
              return { rows, rowCount: rows.length };
            },
          };

          // Iterate through all pages
          const collected: any[] = [];
          let cursor: string | null = null;
          let pageCount = 0;
          const maxPages = expected.length + 2; // safety limit

          process.env.MEDIA_BUCKET_NAME = 'test-bucket';

          do {
            resetMocks();

            const qsp: Record<string, string> = { limit: String(pageSize) };
            if (cursor) qsp.cursor = cursor;

            const res = await adminHandler(
              makeRestApiEvent('/submissions/review-queue', 'GET', {
                queryStringParameters: qsp,
              })
            );
            const { statusCode, body } = parseRes(res);
            expect(statusCode).toBe(200);

            collected.push(...body.data);
            cursor = body.cursor;
            pageCount++;
          } while (cursor !== null && pageCount < maxPages);

          // 1. Total count matches expected
          expect(collected.length).toBe(expected.length);

          // 2. Every expected submission appears exactly once, in correct order (by id)
          const collectedIds = collected.map((c: any) => c.id);
          const expectedIds = expected.map((e) => e.id);
          expect(collectedIds).toEqual(expectedIds);

          // 3. No duplicates
          const uniqueIds = new Set(collectedIds);
          expect(uniqueIds.size).toBe(collectedIds.length);

          // 4. Results are in created_at ASC order (oldest first)
          for (let i = 1; i < collected.length; i++) {
            const prev = new Date(collected[i - 1].created_at).getTime();
            const curr = new Date(collected[i].created_at).getTime();
            expect(curr).toBeGreaterThanOrEqual(prev);
          }

          // 5. Submissions without ready photos must NOT appear
          const pendingWithoutReadyPhotos = submissions
            .filter((s) => s.status === 'pending_review' && !hasReadyPhoto(s))
            .map((s) => s.id);
          for (const id of pendingWithoutReadyPhotos) {
            expect(collectedIds).not.toContain(id);
          }

          // 6. Non-pending submissions must NOT appear
          const nonPending = submissions
            .filter((s) => s.status !== 'pending_review')
            .map((s) => s.id);
          for (const id of nonPending) {
            expect(collectedIds).not.toContain(id);
          }
        }
      ),
      { numRuns: 40 }
    );
  });
});



// ═══════════════════════════════════════════════════════════════════════════
// Property 11: Admin Review Queue Response Shape
// ═══════════════════════════════════════════════════════════════════════════

// Feature: paginated-endpoints, Property 11: Admin Review Queue Response Shape
describe('Property 11: Admin Review Queue Response Shape', () => {
  // **Validates: Requirements 5.3**

  const REQUIRED_FIELDS = [
    'id',
    'contributor_name',
    'contributor_email',
    'story_text',
    'raw_location_text',
    'privacy_mode',
    'display_lat',
    'display_lng',
    'status',
    'created_at',
    'photo_count',
    'has_photos',
    'photos',
  ];

  const arbPhotoStatus = fc.constantFrom('ready', 'uploaded', 'processing', 'failed') as fc.Arbitrary<
    'ready' | 'uploaded' | 'processing' | 'failed'
  >;

  /** Generate a pending_review submission with at least one ready photo */
  const arbPendingSubmissionWithReadyPhotos = fc.record({
    id: fc.uuid(),
    created_at: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }),
    photos: fc
      .array(
        fc.record({
          id: fc.uuid(),
          status: arbPhotoStatus,
          original_s3_key: fc.uuid().map((u) => `photos/${u}/original.jpg`),
          created_at: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }),
        }),
        { minLength: 1, maxLength: 5 }
      )
      .filter((photos) => photos.some((p) => p.status === 'ready')),
  });

  it('each item has all required fields; photo_count equals photos.length; has_photos equals photo_count > 0', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbPendingSubmissionWithReadyPhotos, { minLength: 1, maxLength: 15 }),
        async (submissions) => {
          process.env.MEDIA_BUCKET_NAME = 'test-bucket';

          queryResponses = {
            'FROM submissions': (_text: string, params: any[]) => {
              const limit = params[params.length - 1];
              const rows = submissions
                .sort((a, b) => {
                  const timeDiff = a.created_at.getTime() - b.created_at.getTime();
                  if (timeDiff !== 0) return timeDiff;
                  return a.id.localeCompare(b.id);
                })
                .slice(0, limit)
                .map((s) => ({
                  id: s.id,
                  contributor_name: `User-${s.id.slice(0, 4)}`,
                  contributor_email: `user-${s.id.slice(0, 4)}@example.com`,
                  story_text: `Story for ${s.id}`,
                  raw_location_text: `Location for ${s.id}`,
                  privacy_mode: 'exact',
                  display_lat: 34.05,
                  display_lng: -118.24,
                  status: 'pending_review',
                  created_at: s.created_at,
                  created_at_raw: s.created_at.toISOString().replace('T', ' ').replace('Z', '+00'),
                }));
              return { rows, rowCount: rows.length };
            },
            'FROM submission_photos': (_text: string, params: any[]) => {
              const requestedIds: string[] = params[0];
              const rows: any[] = [];
              for (const s of submissions) {
                if (!requestedIds.includes(s.id)) continue;
                for (const p of s.photos) {
                  if (p.status === 'ready') {
                    rows.push({
                      submission_id: s.id,
                      original_s3_key: p.original_s3_key,
                      created_at: p.created_at,
                    });
                  }
                }
              }
              rows.sort((a, b) => {
                const subCmp = a.submission_id.localeCompare(b.submission_id);
                if (subCmp !== 0) return subCmp;
                return a.created_at.getTime() - b.created_at.getTime();
              });
              return { rows, rowCount: rows.length };
            },
          };

          resetMocks();

          const res = await adminHandler(
            makeRestApiEvent('/submissions/review-queue', 'GET', {
              queryStringParameters: { limit: '100' },
            })
          );
          const { statusCode, body } = parseRes(res);
          expect(statusCode).toBe(200);
          expect(body.data.length).toBeGreaterThan(0);

          for (const item of body.data) {
            // Verify all required fields are present
            for (const field of REQUIRED_FIELDS) {
              expect(item).toHaveProperty(field);
            }

            // Verify photos is an array
            expect(Array.isArray(item.photos)).toBe(true);

            // Verify photo_count equals photos.length
            expect(item.photo_count).toBe(item.photos.length);

            // Verify has_photos equals photo_count > 0
            expect(item.has_photos).toBe(item.photo_count > 0);

            // Verify photo_count is an integer
            expect(Number.isInteger(item.photo_count)).toBe(true);

            // Verify has_photos is a boolean
            expect(typeof item.has_photos).toBe('boolean');
          }
        }
      ),
      { numRuns: 75 }
    );
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// Property 12: Admin Review Queue Photo Ordering and Ready Filter
// ═══════════════════════════════════════════════════════════════════════════

// Feature: paginated-endpoints, Property 12: Admin Review Queue Photo Ordering and Ready Filter
describe('Property 12: Admin Review Queue Photo Ordering and Ready Filter', () => {
  // **Validates: Requirements 5.5**

  const arbPhotoStatus = fc.constantFrom('ready', 'uploaded', 'processing', 'failed') as fc.Arbitrary<
    'ready' | 'uploaded' | 'processing' | 'failed'
  >;

  /** Generate a pending_review submission with photos of mixed statuses */
  const arbPendingSubmissionWithMixedPhotos = fc.record({
    id: fc.uuid(),
    created_at: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }),
    photos: fc
      .array(
        fc.record({
          id: fc.uuid(),
          status: arbPhotoStatus,
          original_s3_key: fc.uuid().map((u) => `photos/${u}/original.jpg`),
          created_at: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }),
        }),
        { minLength: 1, maxLength: 6 }
      )
      .filter((photos) => photos.some((p) => p.status === 'ready')),
  });

  it('photos array contains pre-signed URLs for exactly the ready photos, ordered by created_at ASC', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbPendingSubmissionWithMixedPhotos, { minLength: 1, maxLength: 10 }),
        async (submissions) => {
          process.env.MEDIA_BUCKET_NAME = 'test-bucket';

          // Compute expected ready photos per submission, sorted by created_at ASC
          const expectedPhotosPerSubmission = new Map<
            string,
            Array<{ original_s3_key: string; created_at: Date }>
          >();
          for (const s of submissions) {
            const readyPhotos = s.photos
              .filter((p) => p.status === 'ready')
              .sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
            expectedPhotosPerSubmission.set(s.id, readyPhotos);
          }

          queryResponses = {
            'FROM submissions': (_text: string, params: any[]) => {
              const limit = params[params.length - 1];
              const rows = submissions
                .sort((a, b) => {
                  const timeDiff = a.created_at.getTime() - b.created_at.getTime();
                  if (timeDiff !== 0) return timeDiff;
                  return a.id.localeCompare(b.id);
                })
                .slice(0, limit)
                .map((s) => ({
                  id: s.id,
                  contributor_name: `User-${s.id.slice(0, 4)}`,
                  contributor_email: `user-${s.id.slice(0, 4)}@example.com`,
                  story_text: `Story for ${s.id}`,
                  raw_location_text: `Location for ${s.id}`,
                  privacy_mode: 'exact',
                  display_lat: 34.05,
                  display_lng: -118.24,
                  status: 'pending_review',
                  created_at: s.created_at,
                  created_at_raw: s.created_at.toISOString().replace('T', ' ').replace('Z', '+00'),
                }));
              return { rows, rowCount: rows.length };
            },
            'FROM submission_photos': (_text: string, params: any[]) => {
              const requestedIds: string[] = params[0];
              const rows: any[] = [];
              for (const s of submissions) {
                if (!requestedIds.includes(s.id)) continue;
                for (const p of s.photos) {
                  if (p.status === 'ready') {
                    rows.push({
                      submission_id: s.id,
                      original_s3_key: p.original_s3_key,
                      created_at: p.created_at,
                    });
                  }
                }
              }
              // Sort by submission_id, created_at ASC (matching the real query)
              rows.sort((a, b) => {
                const subCmp = a.submission_id.localeCompare(b.submission_id);
                if (subCmp !== 0) return subCmp;
                return a.created_at.getTime() - b.created_at.getTime();
              });
              return { rows, rowCount: rows.length };
            },
          };

          resetMocks();

          const res = await adminHandler(
            makeRestApiEvent('/submissions/review-queue', 'GET', {
              queryStringParameters: { limit: '100' },
            })
          );
          const { statusCode, body } = parseRes(res);
          expect(statusCode).toBe(200);
          expect(body.data.length).toBeGreaterThan(0);

          for (const item of body.data) {
            const expectedReady = expectedPhotosPerSubmission.get(item.id) ?? [];

            // Build expected pre-signed URLs in created_at ASC order
            const expectedUrls = expectedReady.map(
              (p) => `https://s3.example.com/signed/${p.original_s3_key}`
            );

            // Completeness: photos array contains exactly the ready photos
            expect(item.photos.length).toBe(expectedUrls.length);

            // Ordering: photos are in created_at ASC order (matching expected)
            expect(item.photos).toEqual(expectedUrls);

            // Verify non-ready photos are excluded
            const nonReadyCount = submissions
              .find((s) => s.id === item.id)
              ?.photos.filter((p) => p.status !== 'ready').length ?? 0;
            if (nonReadyCount > 0) {
              // If there were non-ready photos, the photos array should be shorter than total photos
              const totalPhotos = submissions.find((s) => s.id === item.id)?.photos.length ?? 0;
              expect(item.photos.length).toBeLessThan(totalPhotos);
            }
          }
        }
      ),
      { numRuns: 60 }
    );
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// Property 13: Error Response Shape Consistency
// ═══════════════════════════════════════════════════════════════════════════

// Feature: paginated-endpoints, Property 13: Error Response Shape Consistency
describe('Property 13: Error Response Shape Consistency', () => {
  // **Validates: Requirements 9.1, 9.3**

  /** Generator for invalid limit strings that trigger 400 INVALID_LIMIT */
  const arbInvalidLimitForError = fc.oneof(
    // Non-numeric strings
    fc.stringOf(fc.char().filter((c) => !/^[0-9]$/.test(c)), { minLength: 1, maxLength: 10 }).filter(
      (s) => s.trim().length > 0 && !/^[0-9]+$/.test(s.trim())
    ),
    // Decimal numbers
    fc.tuple(
      fc.integer({ min: 0, max: 999 }),
      fc.integer({ min: 1, max: 99 })
    ).map(([whole, frac]) => `${whole}.${frac}`),
    // Zero
    fc.constant('0'),
    // Negative integers
    fc.integer({ min: -1000, max: -1 }).map(String)
  );

  /** Generator for invalid cursor strings that trigger 400 INVALID_CURSOR */
  const arbInvalidCursorForError = fc.oneof(
    // Random non-base64url strings
    fc.stringOf(
      fc.char().filter((c) => /[^A-Za-z0-9_\-]/.test(c)),
      { minLength: 1, maxLength: 30 }
    ).filter((s) => s.trim().length > 0),
    // Valid base64url but invalid JSON inside
    fc.stringOf(fc.char(), { minLength: 1, maxLength: 20 })
      .filter((s) => {
        try { JSON.parse(s); return false; } catch { return true; }
      })
      .map((s) => Buffer.from(s).toString('base64url')),
    // Valid JSON but missing required fields
    fc.constant(Buffer.from(JSON.stringify({})).toString('base64url')),
    fc.constant(Buffer.from(JSON.stringify({ id: 'not-a-uuid' })).toString('base64url')),
    // Non-UUID id with valid timestamp
    fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') })
      .map((d) => Buffer.from(JSON.stringify({ created_at: d.toISOString(), id: 'bad-id' })).toString('base64url'))
  );

  /** Combined generator: pick an error trigger type and produce the corresponding query params */
  const arbErrorTrigger = fc.oneof(
    arbInvalidLimitForError.map((limit) => ({
      queryStringParameters: { limit } as Record<string, string>,
      expectedCode: 'INVALID_LIMIT',
    })),
    arbInvalidCursorForError.map((cursor) => ({
      queryStringParameters: { cursor } as Record<string, string>,
      expectedCode: 'INVALID_CURSOR',
    }))
  );

  /**
   * Verify the error response shape: { error: { code: string, message: string } }
   * where both code and message are non-empty strings.
   */
  function assertErrorShape(body: any) {
    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('object');
    expect(body.error).not.toBeNull();
    expect(body.error).toHaveProperty('code');
    expect(body.error).toHaveProperty('message');
    expect(typeof body.error.code).toBe('string');
    expect(typeof body.error.message).toBe('string');
    expect(body.error.code.length).toBeGreaterThan(0);
    expect(body.error.message.length).toBeGreaterThan(0);
  }

  it('error responses from GET /admin/submissions/review-queue have shape { error: { code, message } } with non-empty strings', async () => {
    await fc.assert(
      fc.asyncProperty(arbErrorTrigger, async ({ queryStringParameters, expectedCode }) => {
        resetMocks();
        queryResponses = {};
        process.env.MEDIA_BUCKET_NAME = 'test-bucket';

        const res = await adminHandler(
          makeRestApiEvent('/submissions/review-queue', 'GET', { queryStringParameters })
        );
        const { statusCode, body } = parseRes(res);

        // Should be a 400 error
        expect(statusCode).toBe(400);
        expect(body.error.code).toBe(expectedCode);

        // Verify the shape
        assertErrorShape(body);
      }),
      { numRuns: 75 }
    );
  });

  it('database error responses (500) have shape { error: { code, message } } with non-empty strings on GET /admin/submissions/review-queue', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constant(null),
        async () => {
          resetMocks();
          queryResponses = {};
          process.env.MEDIA_BUCKET_NAME = 'test-bucket';
          mockClient.query.mockImplementation(() => {
            throw new Error('relation "submissions" does not exist');
          });

          const res = await adminHandler(
            makeRestApiEvent('/submissions/review-queue', 'GET', { queryStringParameters: null })
          );
          const { statusCode, body } = parseRes(res);

          expect(statusCode).toBe(500);
          expect(body.error.code).toBe('INTERNAL_ERROR');

          // Verify the shape
          assertErrorShape(body);
        }
      ),
      { numRuns: 10 }
    );
  });
});
