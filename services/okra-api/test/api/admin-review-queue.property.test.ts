import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';

// ─── Mocks ──────────────────────────────────────────────────────────────────

let queryResponses: Record<string, any>;
let queryCalls: Array<{ text: string; params: any[] }>;

const mockClient = {
  connect: vi.fn(),
  query: vi.fn((text: string, params?: any[]) => {
    queryCalls.push({ text, params: params || [] });
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
  getSignedUrl: vi.fn(() => Promise.resolve('https://s3.example.com/signed-url')),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(() => ({})),
  GetObjectCommand: vi.fn((params: any) => params),
}));

vi.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: vi.fn(() => ({ send: vi.fn(() => Promise.resolve({})) })),
  PutEventsCommand: vi.fn((params: any) => params),
}));

import { handler } from '../../src/handlers/admin-api.mjs';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeRestApiEvent(
  path: string,
  method = 'GET',
  options: {
    queryStringParameters?: Record<string, string> | null;
    pathParameters?: Record<string, string> | null;
    body?: any;
    requestContext?: any;
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
    pathParameters: options.pathParameters ?? null,
    stageVariables: null,
    requestContext: options.requestContext ?? {
      requestId: 'req-test',
      path,
      stage: 'api',
      identity: { sourceIp: '127.0.0.1', userAgent: 'vitest' },
      authorizer: { sub: 'admin-cognito-sub-1' },
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : null,
    isBase64Encoded: false,
  };
}

function parseRes(res: any) {
  return { statusCode: res.statusCode, body: JSON.parse(res.body) };
}

const ADMIN_USER_ROW = { id: 'admin-uuid-1' };


// ─── Generators ─────────────────────────────────────────────────────────────

/** Generate a submission row with a given status and sequential created_at */
function genSubmissionRow(id: string, status: string, createdAt: Date, photoKeys: string[] = []) {
  return {
    id,
    contributor_name: `User-${id.slice(0, 4)}`,
    story_text: `Story for ${id}`,
    raw_location_text: `Location ${id}`,
    privacy_mode: 'public',
    display_lat: 34.05,
    display_lng: -118.24,
    status,
    created_at: createdAt,
    reviewed_by: null,
    reviewed_at: null,
    review_notes: null,
    photoKeys,
  };
}

/** Arbitrary for a valid submission status */
const arbStatus = fc.constantFrom('pending_review', 'approved', 'denied');

/** Arbitrary for a valid denial reason */
const arbValidReason = fc.constantFrom('spam', 'invalid_location', 'inappropriate', 'other');

/** Arbitrary for valid latitude [-90, 90] */
const arbValidLat = fc.double({ min: -90, max: 90, noNaN: true, noDefaultInfinity: true });

/** Arbitrary for valid longitude [-180, 180] */
const arbValidLng = fc.double({ min: -180, max: 180, noNaN: true, noDefaultInfinity: true });

// ─── Setup / Teardown ───────────────────────────────────────────────────────

beforeEach(() => {
  process.env.DATABASE_URL = 'postgres://localhost:5432/test';
  process.env.MEDIA_BUCKET_NAME = 'test-media-bucket';
  queryResponses = {};
  queryCalls = [];
  vi.clearAllMocks();
});

afterEach(() => {
  delete process.env.DATABASE_URL;
  delete process.env.MEDIA_BUCKET_NAME;
});

// ═══════════════════════════════════════════════════════════════════════════
// Property 1: Pagination Completeness
// ═══════════════════════════════════════════════════════════════════════════

// Feature: admin-review-queue, Property 1: Pagination Completeness
describe('Property 1: Pagination Completeness', () => {
  // **Validates: Requirements 1.1, 1.4, 1.5, 1.10**
  it('iterating all pages yields every matching submission exactly once in created_at ascending order', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate 0-50 submissions with random statuses and timestamps
        fc.array(
          fc.record({
            id: fc.uuid(),
            status: arbStatus,
            created_at: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }),
          }),
          { minLength: 0, maxLength: 50 }
        ),
        fc.constantFrom('pending_review', 'approved', 'denied'),
        fc.integer({ min: 1, max: 20 }),
        async (submissions, filterStatus, pageSize) => {
          // Build the full set of matching submissions sorted by (created_at, id)
          const matching = submissions
            .filter((s) => s.status === filterStatus)
            .sort((a, b) => {
              const timeDiff = a.created_at.getTime() - b.created_at.getTime();
              if (timeDiff !== 0) return timeDiff;
              return a.id.localeCompare(b.id);
            });

          // Mock DB to simulate cursor-based pagination
          queryResponses = {
            'FROM submissions': (_text: string, params: any[]) => {
              const status = params[0];
              const limit = params[params.length - 1]; // last param is always limit
              let filtered = submissions
                .filter((s) => s.status === status)
                .sort((a, b) => {
                  const timeDiff = a.created_at.getTime() - b.created_at.getTime();
                  if (timeDiff !== 0) return timeDiff;
                  return a.id.localeCompare(b.id);
                });

              // Apply cursor if present (params length > 2 means cursor is provided)
              if (params.length === 4) {
                const cursorDate = new Date(params[1]);
                const cursorId = params[2];
                filtered = filtered.filter((s) => {
                  const timeDiff = s.created_at.getTime() - cursorDate.getTime();
                  if (timeDiff > 0) return true;
                  if (timeDiff === 0) return s.id > cursorId;
                  return false;
                });
              }

              const rows = filtered.slice(0, limit).map((s) => ({
                ...s,
                contributor_name: `User-${s.id.slice(0, 4)}`,
                story_text: `Story`,
                raw_location_text: `Loc`,
                privacy_mode: 'public',
                display_lat: 34.05,
                display_lng: -118.24,
                created_at_raw: s.created_at.toISOString().replace('T', ' ').replace('Z', '+00'),
              }));
              return { rows, rowCount: rows.length };
            },
            'FROM submission_photos': { rows: [], rowCount: 0 },
          };

          // Iterate through all pages
          const collected: any[] = [];
          let cursor: string | null = null;
          let pageCount = 0;
          const maxPages = matching.length + 2; // safety limit

          do {
            queryCalls = [];
            vi.clearAllMocks();
            // Re-set mocks after clearAllMocks
            mockClient.connect.mockImplementation(() => {});
            mockClient.end.mockImplementation(() => {});
            mockClient.query.mockImplementation((text: string, params?: any[]) => {
              queryCalls.push({ text, params: params || [] });
              for (const [pattern, response] of Object.entries(queryResponses)) {
                if (text.includes(pattern)) {
                  if (typeof response === 'function') return response(text, params);
                  return response;
                }
              }
              return { rows: [], rowCount: 0 };
            });

            const qsp: Record<string, string> = {
              status: filterStatus,
              limit: String(pageSize),
            };
            if (cursor) qsp.cursor = cursor;

            const res = await handler(
              makeRestApiEvent('/submissions', 'GET', {
                queryStringParameters: qsp,
              })
            );
            const { statusCode, body } = parseRes(res);
            expect(statusCode).toBe(200);

            collected.push(...body.data);
            cursor = body.cursor;
            pageCount++;
          } while (cursor !== null && pageCount < maxPages);

          // Verify: every matching submission appears exactly once
          expect(collected.length).toBe(matching.length);

          const collectedIds = collected.map((c: any) => c.id);
          const matchingIds = matching.map((m) => m.id);
          expect(collectedIds).toEqual(matchingIds);

          // Verify ascending created_at order
          for (let i = 1; i < collected.length; i++) {
            const prev = new Date(collected[i - 1].created_at).getTime();
            const curr = new Date(collected[i].created_at).getTime();
            expect(curr).toBeGreaterThanOrEqual(prev);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});



// ═══════════════════════════════════════════════════════════════════════════
// Property 2: Limit Parameter Validation
// ═══════════════════════════════════════════════════════════════════════════

// Feature: admin-review-queue, Property 2: Limit Parameter Validation
describe('Property 2: Limit Parameter Validation', () => {
  // **Validates: Requirements 1.3**

  function setupListMocks() {
    queryResponses = {
      'FROM submissions': { rows: [], rowCount: 0 },
      'FROM submission_photos': { rows: [], rowCount: 0 },
    };
  }

  it('valid limits 1-100 return 200', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 100 }),
        async (limit) => {
          setupListMocks();
          queryCalls = [];
          vi.clearAllMocks();
          mockClient.connect.mockImplementation(() => {});
          mockClient.end.mockImplementation(() => {});
          mockClient.query.mockImplementation((text: string, params?: any[]) => {
            queryCalls.push({ text, params: params || [] });
            for (const [pattern, response] of Object.entries(queryResponses)) {
              if (text.includes(pattern)) {
                if (typeof response === 'function') return response(text, params);
                return response;
              }
            }
            return { rows: [], rowCount: 0 };
          });

          const res = await handler(
            makeRestApiEvent('/submissions', 'GET', {
              queryStringParameters: { limit: String(limit) },
            })
          );
          const { statusCode } = parseRes(res);
          expect(statusCode).toBe(200);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('limits above 100 return 200 (clamped)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 101, max: 10000 }),
        async (limit) => {
          setupListMocks();
          queryCalls = [];
          vi.clearAllMocks();
          mockClient.connect.mockImplementation(() => {});
          mockClient.end.mockImplementation(() => {});
          mockClient.query.mockImplementation((text: string, params?: any[]) => {
            queryCalls.push({ text, params: params || [] });
            for (const [pattern, response] of Object.entries(queryResponses)) {
              if (text.includes(pattern)) {
                if (typeof response === 'function') return response(text, params);
                return response;
              }
            }
            return { rows: [], rowCount: 0 };
          });

          const res = await handler(
            makeRestApiEvent('/submissions', 'GET', {
              queryStringParameters: { limit: String(limit) },
            })
          );
          const { statusCode } = parseRes(res);
          expect(statusCode).toBe(200);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('zero and negative limits return 400 INVALID_LIMIT', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: -10000, max: 0 }),
        async (limit) => {
          queryCalls = [];
          const res = await handler(
            makeRestApiEvent('/submissions', 'GET', {
              queryStringParameters: { limit: String(limit) },
            })
          );
          const { statusCode, body } = parseRes(res);
          expect(statusCode).toBe(400);
          expect(body.error.code).toBe('INVALID_LIMIT');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('non-numeric limit strings return 400 INVALID_LIMIT', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }).filter((s) => isNaN(Number(s))),
        async (limit) => {
          queryCalls = [];
          const res = await handler(
            makeRestApiEvent('/submissions', 'GET', {
              queryStringParameters: { limit },
            })
          );
          const { statusCode, body } = parseRes(res);
          expect(statusCode).toBe(400);
          expect(body.error.code).toBe('INVALID_LIMIT');
        }
      ),
      { numRuns: 100 }
    );
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// Property 3: Invalid Query Parameter Rejection
// ═══════════════════════════════════════════════════════════════════════════

// Feature: admin-review-queue, Property 3: Invalid Query Parameter Rejection
describe('Property 3: Invalid Query Parameter Rejection', () => {
  // **Validates: Requirements 1.8, 1.9**

  it('invalid status strings return 400 INVALID_STATUS', async () => {
    const validStatuses = ['pending_review', 'approved', 'denied'];
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }).filter((s) => !validStatuses.includes(s)),
        async (status) => {
          queryCalls = [];
          const res = await handler(
            makeRestApiEvent('/submissions', 'GET', {
              queryStringParameters: { status },
            })
          );
          const { statusCode, body } = parseRes(res);
          expect(statusCode).toBe(400);
          expect(body.error.code).toBe('INVALID_STATUS');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('malformed cursor tokens return 400 INVALID_CURSOR', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          // Random garbage strings
          fc.string({ minLength: 1 }).filter((s) => {
            // Filter out strings that happen to be valid cursors
            try {
              const decoded = JSON.parse(Buffer.from(s, 'base64url').toString());
              return !(decoded.created_at && decoded.id);
            } catch {
              return true;
            }
          }),
          // Base64 of invalid JSON
          fc.string({ minLength: 1 }).map((s) => Buffer.from(s).toString('base64url')),
          // Base64 of JSON missing required fields
          fc.record({ foo: fc.string() }).map((obj) =>
            Buffer.from(JSON.stringify(obj)).toString('base64url')
          )
        ),
        async (cursor) => {
          queryCalls = [];
          // Set up list mocks in case cursor passes validation
          queryResponses = {
            'FROM submissions': { rows: [], rowCount: 0 },
            'FROM submission_photos': { rows: [], rowCount: 0 },
          };
          vi.clearAllMocks();
          mockClient.connect.mockImplementation(() => {});
          mockClient.end.mockImplementation(() => {});
          mockClient.query.mockImplementation((text: string, params?: any[]) => {
            queryCalls.push({ text, params: params || [] });
            for (const [pattern, response] of Object.entries(queryResponses)) {
              if (text.includes(pattern)) {
                if (typeof response === 'function') return response(text, params);
                return response;
              }
            }
            return { rows: [], rowCount: 0 };
          });

          const res = await handler(
            makeRestApiEvent('/submissions', 'GET', {
              queryStringParameters: { cursor },
            })
          );
          const { statusCode, body } = parseRes(res);
          expect(statusCode).toBe(400);
          expect(body.error.code).toBe('INVALID_CURSOR');
        }
      ),
      { numRuns: 100 }
    );
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// Property 4: List Response Shape Completeness
// ═══════════════════════════════════════════════════════════════════════════

// Feature: admin-review-queue, Property 4: List Response Shape Completeness
describe('Property 4: List Response Shape Completeness', () => {
  // **Validates: Requirements 1.5, 1.6**
  it('every returned object has all required fields and photo_count === photos.length and has_photos === photo_count > 0', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            id: fc.uuid(),
            photoCount: fc.integer({ min: 0, max: 5 }),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        async (items) => {
          const submissionRows = items.map((item, i) => ({
            id: item.id,
            contributor_name: `User-${i}`,
            story_text: `Story ${i}`,
            raw_location_text: `Loc ${i}`,
            privacy_mode: 'public',
            display_lat: 34.05,
            display_lng: -118.24,
            status: 'pending_review',
            created_at: new Date(2024, 0, 1 + i),
            created_at_raw: `2024-01-${String(1 + i).padStart(2, '0')} 00:00:00.000000+00`,
          }));

          const photoRows: any[] = [];
          for (const item of items) {
            for (let p = 0; p < item.photoCount; p++) {
              photoRows.push({
                submission_id: item.id,
                original_s3_key: `photos/${item.id}/${p}.jpg`,
              });
            }
          }

          queryResponses = {
            'FROM submissions': { rows: submissionRows, rowCount: submissionRows.length },
            'FROM submission_photos': { rows: photoRows, rowCount: photoRows.length },
          };
          queryCalls = [];
          vi.clearAllMocks();
          mockClient.connect.mockImplementation(() => {});
          mockClient.end.mockImplementation(() => {});
          mockClient.query.mockImplementation((text: string, params?: any[]) => {
            queryCalls.push({ text, params: params || [] });
            for (const [pattern, response] of Object.entries(queryResponses)) {
              if (text.includes(pattern)) {
                if (typeof response === 'function') return response(text, params);
                return response;
              }
            }
            return { rows: [], rowCount: 0 };
          });

          const res = await handler(makeRestApiEvent('/submissions'));
          const { statusCode, body } = parseRes(res);
          expect(statusCode).toBe(200);

          const requiredFields = [
            'id', 'contributor_name', 'story_text', 'raw_location_text',
            'privacy_mode', 'display_lat', 'display_lng', 'status',
            'created_at', 'photo_count', 'has_photos', 'photos',
          ];

          for (const entry of body.data) {
            for (const field of requiredFields) {
              expect(entry).toHaveProperty(field);
            }
            expect(typeof entry.photo_count).toBe('number');
            expect(typeof entry.has_photos).toBe('boolean');
            expect(Array.isArray(entry.photos)).toBe(true);
            expect(entry.photo_count).toBe(entry.photos.length);
            expect(entry.has_photos).toBe(entry.photo_count > 0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// Property 5: Transactional Review Integrity
// ═══════════════════════════════════════════════════════════════════════════

// Feature: admin-review-queue, Property 5: Transactional Review Integrity
describe('Property 5: Transactional Review Integrity', () => {
  // **Validates: Requirements 2.1, 2.6, 3.1, 3.6, 4.4**
  it('successful reviews issue BEGIN, UPDATE, INSERT, COMMIT; failures issue ROLLBACK', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('approve', 'deny'),
        fc.boolean(), // true = success (pending_review), false = failure (already reviewed)
        async (action, shouldSucceed) => {
          queryCalls = [];
          vi.clearAllMocks();

          const submissionId = '550e8400-e29b-41d4-a716-446655440002';
          const updatedRow = {
            id: submissionId,
            contributor_name: 'Alice',
            story_text: 'Story',
            raw_location_text: 'Loc',
            privacy_mode: 'public',
            display_lat: 34.05,
            display_lng: -118.24,
            status: action === 'approve' ? 'approved' : 'denied',
            created_at: new Date('2024-01-15'),
            reviewed_by: 'admin-uuid-1',
            reviewed_at: new Date(),
            review_notes: null,
          };

          if (action === 'approve') {
            queryResponses = {
              'SELECT id, status FROM submissions': shouldSucceed
                ? { rows: [{ id: submissionId, status: 'pending_review' }] }
                : { rows: [{ id: submissionId, status: 'approved' }] },
              'COUNT(*)': { rows: [{ count: 2 }] },
              'admin_users': { rows: [ADMIN_USER_ROW] },
              'BEGIN': { rows: [] },
              'UPDATE submissions': shouldSucceed
                ? { rows: [updatedRow], rowCount: 1 }
                : { rows: [], rowCount: 0 },
              'INSERT INTO submission_reviews': { rows: [] },
              'COMMIT': { rows: [] },
              'ROLLBACK': { rows: [] },
            };
          } else {
            queryResponses = {
              'admin_users': { rows: [ADMIN_USER_ROW] },
              'BEGIN': { rows: [] },
              'UPDATE submissions': shouldSucceed
                ? { rows: [updatedRow], rowCount: 1 }
                : { rows: [], rowCount: 0 },
              'INSERT INTO submission_reviews': { rows: [] },
              'COMMIT': { rows: [] },
              'SELECT id, status FROM submissions': shouldSucceed
                ? { rows: [] }
                : { rows: [{ id: submissionId, status: 'denied' }] },
              'ROLLBACK': { rows: [] },
            };
          }

          mockClient.connect.mockImplementation(() => {});
          mockClient.end.mockImplementation(() => {});
          mockClient.query.mockImplementation((text: string, params?: any[]) => {
            queryCalls.push({ text, params: params || [] });
            for (const [pattern, response] of Object.entries(queryResponses)) {
              if (text.includes(pattern)) {
                if (typeof response === 'function') return response(text, params);
                return response;
              }
            }
            return { rows: [], rowCount: 0 };
          });

          const statusValue = action === 'approve' ? 'approved' : 'denied';
          const path = `/submissions/${submissionId}/statuses`;
          const body =
            action === 'deny'
              ? { status: 'denied', reason: 'spam', review_notes: 'test' }
              : { status: 'approved' };

          const res = await handler(
            makeRestApiEvent(path, 'POST', {
              pathParameters: { id: submissionId },
              body,
            })
          );
          const parsed = parseRes(res);

          const queryTexts = queryCalls.map((c) => c.text);

          if (shouldSucceed) {
            expect(parsed.statusCode).toBe(200);
            // Verify transaction sequence: BEGIN -> UPDATE -> INSERT -> COMMIT
            const beginIdx = queryTexts.findIndex((t) => t.includes('BEGIN'));
            const updateIdx = queryTexts.findIndex((t) => t.includes('UPDATE submissions'));
            const insertIdx = queryTexts.findIndex((t) => t.includes('INSERT INTO submission_reviews'));
            const commitIdx = queryTexts.findIndex((t) => t.includes('COMMIT'));

            expect(beginIdx).toBeGreaterThanOrEqual(0);
            expect(updateIdx).toBeGreaterThan(beginIdx);
            expect(insertIdx).toBeGreaterThan(updateIdx);
            expect(commitIdx).toBeGreaterThan(insertIdx);
          } else {
            expect(parsed.statusCode).toBe(409);
            if (action === 'deny') {
              // Denial path still uses UPDATE + fallback, so ROLLBACK is expected
              const rollbackIdx = queryTexts.findIndex((t) => t.includes('ROLLBACK'));
              expect(rollbackIdx).toBeGreaterThanOrEqual(0);
            }
            // Approval path catches non-pending status early, before BEGIN
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// Property 6: State Conflict Detection
// ═══════════════════════════════════════════════════════════════════════════

// Feature: admin-review-queue, Property 6: State Conflict Detection
describe('Property 6: State Conflict Detection', () => {
  // **Validates: Requirements 2.2, 3.2**
  it('returns 404 for missing, 409 for non-pending, 200 for pending submissions', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('approve', 'deny'),
        fc.constantFrom('missing', 'pending_review', 'approved', 'denied'),
        async (action, submissionState) => {
          queryCalls = [];
          vi.clearAllMocks();

          const submissionId = '550e8400-e29b-41d4-a716-446655440002';
          const updatedRow = {
            id: submissionId,
            contributor_name: 'Alice',
            story_text: 'Story',
            raw_location_text: 'Loc',
            privacy_mode: 'public',
            display_lat: 34.05,
            display_lng: -118.24,
            status: action === 'approve' ? 'approved' : 'denied',
            created_at: new Date('2024-01-15'),
            reviewed_by: 'admin-uuid-1',
            reviewed_at: new Date(),
            review_notes: null,
          };

          const isPending = submissionState === 'pending_review';
          const isMissing = submissionState === 'missing';

          if (action === 'approve') {
            queryResponses = {
              'SELECT id, status FROM submissions': isMissing
                ? { rows: [] }
                : { rows: [{ id: submissionId, status: submissionState }] },
              'COUNT(*)': { rows: [{ count: 2 }] },
              'admin_users': { rows: [ADMIN_USER_ROW] },
              'BEGIN': { rows: [] },
              'UPDATE submissions': isPending
                ? { rows: [updatedRow], rowCount: 1 }
                : { rows: [], rowCount: 0 },
              'INSERT INTO submission_reviews': { rows: [] },
              'COMMIT': { rows: [] },
              'ROLLBACK': { rows: [] },
            };
          } else {
            queryResponses = {
              'admin_users': { rows: [ADMIN_USER_ROW] },
              'BEGIN': { rows: [] },
              'UPDATE submissions': isPending
                ? { rows: [updatedRow], rowCount: 1 }
                : { rows: [], rowCount: 0 },
              'INSERT INTO submission_reviews': { rows: [] },
              'COMMIT': { rows: [] },
              'SELECT id, status FROM submissions': isMissing
                ? { rows: [] }
                : { rows: [{ id: submissionId, status: submissionState }] },
              'ROLLBACK': { rows: [] },
            };
          }

          mockClient.connect.mockImplementation(() => {});
          mockClient.end.mockImplementation(() => {});
          mockClient.query.mockImplementation((text: string, params?: any[]) => {
            queryCalls.push({ text, params: params || [] });
            for (const [pattern, response] of Object.entries(queryResponses)) {
              if (text.includes(pattern)) {
                if (typeof response === 'function') return response(text, params);
                return response;
              }
            }
            return { rows: [], rowCount: 0 };
          });

          const path = `/submissions/${submissionId}/statuses`;
          const body =
            action === 'deny'
              ? { status: 'denied', reason: 'spam', review_notes: 'test' }
              : { status: 'approved' };

          const res = await handler(
            makeRestApiEvent(path, 'POST', {
              pathParameters: { id: submissionId },
              body,
            })
          );
          const parsed = parseRes(res);

          if (isPending) {
            expect(parsed.statusCode).toBe(200);
          } else if (isMissing) {
            expect(parsed.statusCode).toBe(404);
            expect(parsed.body.error.code).toBe('NOT_FOUND');
          } else {
            // already approved or denied
            expect(parsed.statusCode).toBe(409);
            expect(parsed.body.error.code).toBe('INVALID_STATE');
          }

          // For non-pending states, verify no INSERT into submission_reviews
          if (!isPending) {
            const insertCalls = queryCalls.filter((c) =>
              c.text.includes('INSERT INTO submission_reviews')
            );
            expect(insertCalls.length).toBe(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// Property 7: Review Notes Round-Trip
// ═══════════════════════════════════════════════════════════════════════════

// Feature: admin-review-queue, Property 7: Review Notes Round-Trip
describe('Property 7: Review Notes Round-Trip', () => {
  // **Validates: Requirements 2.3, 3.5**
  it('review_notes string appears in both UPDATE and INSERT query parameters', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('approve', 'deny'),
        fc.string({ minLength: 1, maxLength: 500 }),
        async (action, notes) => {
          queryCalls = [];
          vi.clearAllMocks();

          const submissionId = '550e8400-e29b-41d4-a716-446655440002';
          const updatedRow = {
            id: submissionId,
            contributor_name: 'Alice',
            story_text: 'Story',
            raw_location_text: 'Loc',
            privacy_mode: 'public',
            display_lat: 34.05,
            display_lng: -118.24,
            status: action === 'approve' ? 'approved' : 'denied',
            created_at: new Date('2024-01-15'),
            reviewed_by: 'admin-uuid-1',
            reviewed_at: new Date(),
            review_notes: notes,
          };

          if (action === 'approve') {
            queryResponses = {
              'SELECT id, status FROM submissions': { rows: [{ id: submissionId, status: 'pending_review' }] },
              'COUNT(*)': { rows: [{ count: 2 }] },
              'admin_users': { rows: [ADMIN_USER_ROW] },
              'BEGIN': { rows: [] },
              'UPDATE submissions': { rows: [updatedRow], rowCount: 1 },
              'INSERT INTO submission_reviews': { rows: [] },
              'COMMIT': { rows: [] },
            };
          } else {
            queryResponses = {
              'admin_users': { rows: [ADMIN_USER_ROW] },
              'BEGIN': { rows: [] },
              'UPDATE submissions': { rows: [updatedRow], rowCount: 1 },
              'INSERT INTO submission_reviews': { rows: [] },
              'COMMIT': { rows: [] },
            };
          }

          mockClient.connect.mockImplementation(() => {});
          mockClient.end.mockImplementation(() => {});
          mockClient.query.mockImplementation((text: string, params?: any[]) => {
            queryCalls.push({ text, params: params || [] });
            for (const [pattern, response] of Object.entries(queryResponses)) {
              if (text.includes(pattern)) {
                if (typeof response === 'function') return response(text, params);
                return response;
              }
            }
            return { rows: [], rowCount: 0 };
          });

          const path = `/submissions/${submissionId}/statuses`;
          const body =
            action === 'deny'
              ? { status: 'denied', reason: 'spam', review_notes: notes }
              : { status: 'approved', review_notes: notes };

          const res = await handler(
            makeRestApiEvent(path, 'POST', {
              pathParameters: { id: submissionId },
              body,
            })
          );
          const parsed = parseRes(res);
          expect(parsed.statusCode).toBe(200);

          // Verify notes appear in UPDATE params
          const updateCall = queryCalls.find((c) => c.text.includes('UPDATE submissions'));
          expect(updateCall).toBeDefined();
          expect(updateCall!.params).toContain(notes);

          // Verify notes appear in INSERT params
          const insertCall = queryCalls.find((c) =>
            c.text.includes('INSERT INTO submission_reviews')
          );
          expect(insertCall).toBeDefined();
          expect(insertCall!.params).toContain(notes);
        }
      ),
      { numRuns: 100 }
    );
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// Property 8: Coordinate Validation
// ═══════════════════════════════════════════════════════════════════════════

// Feature: admin-review-queue, Property 8: Coordinate Validation
describe('Property 8: Coordinate Validation', () => {
  // **Validates: Requirements 2.4, 2.5**

  it('partial coordinates (only lat or only lng) return INVALID_COORDINATES', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          // Only lat provided
          fc.record({ display_lat: fc.double({ min: -90, max: 90, noNaN: true, noDefaultInfinity: true }) }),
          // Only lng provided
          fc.record({ display_lng: fc.double({ min: -180, max: 180, noNaN: true, noDefaultInfinity: true }) })
        ),
        async (coords) => {
          queryCalls = [];
          const res = await handler(
            makeRestApiEvent('/submissions/550e8400-e29b-41d4-a716-446655440003/statuses', 'POST', {
              pathParameters: { id: '550e8400-e29b-41d4-a716-446655440003' },
              body: { status: 'approved', ...coords },
            })
          );
          const { statusCode, body } = parseRes(res);
          expect(statusCode).toBe(400);
          expect(body.error.code).toBe('INVALID_COORDINATES');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('out-of-bounds coordinates return INVALID_COORDINATES', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          // lat out of bounds (too high)
          fc.record({
            display_lat: fc.double({ min: 90.001, max: 1000, noNaN: true, noDefaultInfinity: true }),
            display_lng: arbValidLng,
          }),
          // lat out of bounds (too low)
          fc.record({
            display_lat: fc.double({ min: -1000, max: -90.001, noNaN: true, noDefaultInfinity: true }),
            display_lng: arbValidLng,
          }),
          // lng out of bounds (too high)
          fc.record({
            display_lat: arbValidLat,
            display_lng: fc.double({ min: 180.001, max: 1000, noNaN: true, noDefaultInfinity: true }),
          }),
          // lng out of bounds (too low)
          fc.record({
            display_lat: arbValidLat,
            display_lng: fc.double({ min: -1000, max: -180.001, noNaN: true, noDefaultInfinity: true }),
          })
        ),
        async (coords) => {
          queryCalls = [];
          const res = await handler(
            makeRestApiEvent('/submissions/550e8400-e29b-41d4-a716-446655440003/statuses', 'POST', {
              pathParameters: { id: '550e8400-e29b-41d4-a716-446655440003' },
              body: { status: 'approved', ...coords },
            })
          );
          const { statusCode, body } = parseRes(res);
          expect(statusCode).toBe(400);
          expect(body.error.code).toBe('INVALID_COORDINATES');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('valid coordinate pairs are accepted (not rejected with INVALID_COORDINATES)', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbValidLat,
        arbValidLng,
        async (lat, lng) => {
          queryCalls = [];
          vi.clearAllMocks();

          // Set up mocks for a successful approval path
          queryResponses = {
            'SELECT id, status FROM submissions': { rows: [{ id: '550e8400-e29b-41d4-a716-446655440003', status: 'pending_review' }] },
            'COUNT(*)': { rows: [{ count: 2 }] },
            'admin_users': { rows: [ADMIN_USER_ROW] },
            'BEGIN': { rows: [] },
            'UPDATE submissions': {
              rows: [{
                id: '550e8400-e29b-41d4-a716-446655440003',
                contributor_name: 'Alice',
                story_text: 'Story',
                raw_location_text: 'Loc',
                privacy_mode: 'public',
                display_lat: lat,
                display_lng: lng,
                status: 'approved',
                created_at: new Date('2024-01-15'),
                reviewed_by: 'admin-uuid-1',
                reviewed_at: new Date(),
                review_notes: null,
              }],
              rowCount: 1,
            },
            'INSERT INTO submission_reviews': { rows: [] },
            'COMMIT': { rows: [] },
          };

          mockClient.connect.mockImplementation(() => {});
          mockClient.end.mockImplementation(() => {});
          mockClient.query.mockImplementation((text: string, params?: any[]) => {
            queryCalls.push({ text, params: params || [] });
            for (const [pattern, response] of Object.entries(queryResponses)) {
              if (text.includes(pattern)) {
                if (typeof response === 'function') return response(text, params);
                return response;
              }
            }
            return { rows: [], rowCount: 0 };
          });

          const res = await handler(
            makeRestApiEvent('/submissions/550e8400-e29b-41d4-a716-446655440003/statuses', 'POST', {
              pathParameters: { id: '550e8400-e29b-41d4-a716-446655440003' },
              body: { status: 'approved', display_lat: lat, display_lng: lng },
            })
          );
          const { statusCode, body } = parseRes(res);
          // Should NOT be INVALID_COORDINATES
          if (statusCode === 400) {
            expect(body.error.code).not.toBe('INVALID_COORDINATES');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('boundary values (-90, 90, -180, 180) are accepted', async () => {
    const boundaryPairs = [
      { display_lat: -90, display_lng: -180 },
      { display_lat: -90, display_lng: 180 },
      { display_lat: 90, display_lng: -180 },
      { display_lat: 90, display_lng: 180 },
      { display_lat: 0, display_lng: 0 },
    ];

    for (const coords of boundaryPairs) {
      queryCalls = [];
      vi.clearAllMocks();

      queryResponses = {
        'SELECT id, status FROM submissions': { rows: [{ id: '550e8400-e29b-41d4-a716-446655440003', status: 'pending_review' }] },
        'COUNT(*)': { rows: [{ count: 2 }] },
        'admin_users': { rows: [ADMIN_USER_ROW] },
        'BEGIN': { rows: [] },
        'UPDATE submissions': {
          rows: [{
            id: '550e8400-e29b-41d4-a716-446655440003',
            contributor_name: 'Alice',
            story_text: 'Story',
            raw_location_text: 'Loc',
            privacy_mode: 'public',
            display_lat: coords.display_lat,
            display_lng: coords.display_lng,
            status: 'approved',
            created_at: new Date('2024-01-15'),
            reviewed_by: 'admin-uuid-1',
            reviewed_at: new Date(),
            review_notes: null,
          }],
          rowCount: 1,
        },
        'INSERT INTO submission_reviews': { rows: [] },
        'COMMIT': { rows: [] },
      };

      mockClient.connect.mockImplementation(() => {});
      mockClient.end.mockImplementation(() => {});
      mockClient.query.mockImplementation((text: string, params?: any[]) => {
        queryCalls.push({ text, params: params || [] });
        for (const [pattern, response] of Object.entries(queryResponses)) {
          if (text.includes(pattern)) {
            if (typeof response === 'function') return response(text, params);
            return response;
          }
        }
        return { rows: [], rowCount: 0 };
      });

      const res = await handler(
        makeRestApiEvent('/submissions/550e8400-e29b-41d4-a716-446655440003/statuses', 'POST', {
          pathParameters: { id: '550e8400-e29b-41d4-a716-446655440003' },
          body: { status: 'approved', ...coords },
        })
      );
      const { statusCode, body } = parseRes(res);
      expect(statusCode).toBe(200);
      if (body.error) {
        expect(body.error.code).not.toBe('INVALID_COORDINATES');
      }
    }
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// Property 9: Denial Reason Validation
// ═══════════════════════════════════════════════════════════════════════════

// Feature: admin-review-queue, Property 9: Denial Reason Validation
describe('Property 9: Denial Reason Validation', () => {
  // **Validates: Requirements 3.3, 3.4**

  it('invalid reason values return INVALID_REASON', async () => {
    const validReasons = ['spam', 'invalid_location', 'inappropriate', 'other'];
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.string({ minLength: 1 }).filter((s) => !validReasons.includes(s)),
          fc.constant(undefined),
          fc.constant(null),
          fc.constant('')
        ),
        async (reason) => {
          queryCalls = [];
          const res = await handler(
            makeRestApiEvent('/submissions/550e8400-e29b-41d4-a716-446655440003/statuses', 'POST', {
              pathParameters: { id: '550e8400-e29b-41d4-a716-446655440003' },
              body: { status: 'denied', reason, review_notes: 'some notes' },
            })
          );
          const { statusCode, body } = parseRes(res);
          expect(statusCode).toBe(400);
          expect(body.error.code).toBe('INVALID_REASON');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('reason=other with empty or missing notes returns MISSING_NOTES', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.constant(undefined),
          fc.constant(null),
          fc.constant(''),
          fc.constant('   '), // whitespace-only
          fc.constant('\t\n')
        ),
        async (notes) => {
          queryCalls = [];
          const body: any = { status: 'denied', reason: 'other' };
          if (notes !== undefined) {
            body.review_notes = notes;
          }
          const res = await handler(
            makeRestApiEvent('/submissions/550e8400-e29b-41d4-a716-446655440003/statuses', 'POST', {
              pathParameters: { id: '550e8400-e29b-41d4-a716-446655440003' },
              body,
            })
          );
          const { statusCode, body: resBody } = parseRes(res);
          expect(statusCode).toBe(400);
          expect(resBody.error.code).toBe('MISSING_NOTES');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('valid reasons with proper notes are accepted', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbValidReason,
        fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
        async (reason, notes) => {
          queryCalls = [];
          vi.clearAllMocks();

          const deniedRow = {
            id: '550e8400-e29b-41d4-a716-446655440003',
            contributor_name: 'Alice',
            story_text: 'Story',
            raw_location_text: 'Loc',
            privacy_mode: 'public',
            display_lat: 34.05,
            display_lng: -118.24,
            status: 'denied',
            created_at: new Date('2024-01-15'),
            reviewed_by: 'admin-uuid-1',
            reviewed_at: new Date(),
            review_notes: notes,
          };

          queryResponses = {
            'admin_users': { rows: [ADMIN_USER_ROW] },
            'BEGIN': { rows: [] },
            'UPDATE submissions': { rows: [deniedRow], rowCount: 1 },
            'INSERT INTO submission_reviews': { rows: [] },
            'COMMIT': { rows: [] },
          };

          mockClient.connect.mockImplementation(() => {});
          mockClient.end.mockImplementation(() => {});
          mockClient.query.mockImplementation((text: string, params?: any[]) => {
            queryCalls.push({ text, params: params || [] });
            for (const [pattern, response] of Object.entries(queryResponses)) {
              if (text.includes(pattern)) {
                if (typeof response === 'function') return response(text, params);
                return response;
              }
            }
            return { rows: [], rowCount: 0 };
          });

          const res = await handler(
            makeRestApiEvent('/submissions/550e8400-e29b-41d4-a716-446655440003/statuses', 'POST', {
              pathParameters: { id: '550e8400-e29b-41d4-a716-446655440003' },
              body: { status: 'denied', reason, review_notes: notes },
            })
          );
          const { statusCode, body } = parseRes(res);
          expect(statusCode).toBe(200);
          expect(body.status).toBe('denied');
        }
      ),
      { numRuns: 100 }
    );
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// Property 10: Photo Requirement for Approval
// ═══════════════════════════════════════════════════════════════════════════

// Feature: admin-review-queue, Property 10: Photo Requirement for Approval
describe('Property 10: Photo Requirement for Approval', () => {
  // **Validates: Requirements 5.1**
  it('zero photos returns MISSING_PHOTOS; non-zero photos allows approval', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 10 }),
        async (photoCount) => {
          queryCalls = [];
          vi.clearAllMocks();

          const submissionId = '550e8400-e29b-41d4-a716-446655440002';
          const approvedRow = {
            id: submissionId,
            contributor_name: 'Alice',
            story_text: 'Story',
            raw_location_text: 'Loc',
            privacy_mode: 'public',
            display_lat: 34.05,
            display_lng: -118.24,
            status: 'approved',
            created_at: new Date('2024-01-15'),
            reviewed_by: 'admin-uuid-1',
            reviewed_at: new Date(),
            review_notes: null,
          };

          queryResponses = {
            'SELECT id, status FROM submissions': { rows: [{ id: submissionId, status: 'pending_review' }] },
            'COUNT(*)': { rows: [{ count: photoCount }] },
            'admin_users': { rows: [ADMIN_USER_ROW] },
            'BEGIN': { rows: [] },
            'UPDATE submissions': { rows: [approvedRow], rowCount: 1 },
            'INSERT INTO submission_reviews': { rows: [] },
            'COMMIT': { rows: [] },
          };

          mockClient.connect.mockImplementation(() => {});
          mockClient.end.mockImplementation(() => {});
          mockClient.query.mockImplementation((text: string, params?: any[]) => {
            queryCalls.push({ text, params: params || [] });
            for (const [pattern, response] of Object.entries(queryResponses)) {
              if (text.includes(pattern)) {
                if (typeof response === 'function') return response(text, params);
                return response;
              }
            }
            return { rows: [], rowCount: 0 };
          });

          const res = await handler(
            makeRestApiEvent(`/submissions/${submissionId}/statuses`, 'POST', {
              pathParameters: { id: submissionId },
              body: { status: 'approved' },
            })
          );
          const { statusCode, body } = parseRes(res);

          if (photoCount === 0) {
            expect(statusCode).toBe(400);
            expect(body.error.code).toBe('MISSING_PHOTOS');
          } else {
            expect(statusCode).toBe(200);
            expect(body.status).toBe('approved');
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// Property 11: Suspicious Coordinates Warning
// ═══════════════════════════════════════════════════════════════════════════

// Feature: admin-review-queue, Property 11: Suspicious Coordinates Warning
describe('Property 11: Suspicious Coordinates Warning', () => {
  // **Validates: Requirements 5.2**
  it('warnings array present only when final coords are both exactly 0', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbValidLat,
        arbValidLng,
        async (lat, lng) => {
          queryCalls = [];
          vi.clearAllMocks();

          const submissionId = '550e8400-e29b-41d4-a716-446655440002';
          const approvedRow = {
            id: submissionId,
            contributor_name: 'Alice',
            story_text: 'Story',
            raw_location_text: 'Loc',
            privacy_mode: 'public',
            display_lat: lat,
            display_lng: lng,
            status: 'approved',
            created_at: new Date('2024-01-15'),
            reviewed_by: 'admin-uuid-1',
            reviewed_at: new Date(),
            review_notes: null,
          };

          queryResponses = {
            'SELECT id, status FROM submissions': { rows: [{ id: submissionId, status: 'pending_review' }] },
            'COUNT(*)': { rows: [{ count: 2 }] },
            'admin_users': { rows: [ADMIN_USER_ROW] },
            'BEGIN': { rows: [] },
            'UPDATE submissions': { rows: [approvedRow], rowCount: 1 },
            'INSERT INTO submission_reviews': { rows: [] },
            'COMMIT': { rows: [] },
          };

          mockClient.connect.mockImplementation(() => {});
          mockClient.end.mockImplementation(() => {});
          mockClient.query.mockImplementation((text: string, params?: any[]) => {
            queryCalls.push({ text, params: params || [] });
            for (const [pattern, response] of Object.entries(queryResponses)) {
              if (text.includes(pattern)) {
                if (typeof response === 'function') return response(text, params);
                return response;
              }
            }
            return { rows: [], rowCount: 0 };
          });

          const res = await handler(
            makeRestApiEvent(`/submissions/${submissionId}/statuses`, 'POST', {
              pathParameters: { id: submissionId },
              body: { status: 'approved', display_lat: lat, display_lng: lng },
            })
          );
          const { statusCode, body } = parseRes(res);
          expect(statusCode).toBe(200);

          if (lat === 0 && lng === 0) {
            expect(body.warnings).toBeDefined();
            expect(body.warnings.length).toBeGreaterThanOrEqual(1);
            const suspiciousWarning = body.warnings.find(
              (w: any) => w.code === 'SUSPICIOUS_COORDINATES'
            );
            expect(suspiciousWarning).toBeDefined();
          } else {
            expect(body.warnings).toBeUndefined();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// Property 12: Error Response Shape Consistency
// ═══════════════════════════════════════════════════════════════════════════

// Feature: admin-review-queue, Property 12: Error Response Shape Consistency
describe('Property 12: Error Response Shape Consistency', () => {
  // **Validates: Requirements 6.1, 6.2**
  it('every error response matches { error: { code, message } } with non-empty strings', async () => {
    const validStatuses = ['pending_review', 'approved', 'denied'];
    const validReasons = ['spam', 'invalid_location', 'inappropriate', 'other'];

    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          // Invalid status
          fc.string({ minLength: 1 }).filter((s) => !validStatuses.includes(s)).map((s) => ({
            path: '/submissions',
            method: 'GET' as const,
            options: { queryStringParameters: { status: s } },
          })),
          // Invalid limit (zero/negative)
          fc.integer({ min: -1000, max: 0 }).map((n) => ({
            path: '/submissions',
            method: 'GET' as const,
            options: { queryStringParameters: { limit: String(n) } },
          })),
          // Invalid limit (non-numeric)
          fc.string({ minLength: 1 }).filter((s) => isNaN(Number(s))).map((s) => ({
            path: '/submissions',
            method: 'GET' as const,
            options: { queryStringParameters: { limit: s } },
          })),
          // Partial coordinates
          fc.constant({
            path: '/submissions/550e8400-e29b-41d4-a716-446655440003/statuses',
            method: 'POST' as const,
            options: {
              pathParameters: { id: '550e8400-e29b-41d4-a716-446655440003' },
              body: { status: 'approved', display_lat: 10 },
            },
          }),
          // Out-of-bounds coordinates
          fc.constant({
            path: '/submissions/550e8400-e29b-41d4-a716-446655440003/statuses',
            method: 'POST' as const,
            options: {
              pathParameters: { id: '550e8400-e29b-41d4-a716-446655440003' },
              body: { status: 'approved', display_lat: 999, display_lng: 999 },
            },
          }),
          // Invalid reason
          fc.string({ minLength: 1 }).filter((s) => !validReasons.includes(s)).map((s) => ({
            path: '/submissions/550e8400-e29b-41d4-a716-446655440003/statuses',
            method: 'POST' as const,
            options: {
              pathParameters: { id: '550e8400-e29b-41d4-a716-446655440003' },
              body: { status: 'denied', reason: s },
            },
          })),
          // Missing notes for reason=other
          fc.constant({
            path: '/submissions/550e8400-e29b-41d4-a716-446655440003/statuses',
            method: 'POST' as const,
            options: {
              pathParameters: { id: '550e8400-e29b-41d4-a716-446655440003' },
              body: { status: 'denied', reason: 'other' },
            },
          })
        ),
        async (testCase) => {
          queryCalls = [];
          const res = await handler(
            makeRestApiEvent(testCase.path, testCase.method, testCase.options as any)
          );
          const { statusCode, body } = parseRes(res);

          expect(statusCode).toBeGreaterThanOrEqual(400);
          expect(body).toHaveProperty('error');
          expect(body.error).toHaveProperty('code');
          expect(body.error).toHaveProperty('message');
          expect(typeof body.error.code).toBe('string');
          expect(typeof body.error.message).toBe('string');
          expect(body.error.code.length).toBeGreaterThan(0);
          expect(body.error.message.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});
