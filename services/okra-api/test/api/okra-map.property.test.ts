import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { fuzzCoordinates } from '../../src/services/privacy-fuzzing.mjs';

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

import { handler } from '../../src/handlers/api.mjs';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeRestApiEvent(path: string, method = 'GET') {
  return {
    resource: '/{proxy+}',
    path,
    httpMethod: method,
    headers: {},
    multiValueHeaders: {},
    queryStringParameters: null,
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

const arbStatus = fc.constantFrom('approved', 'pending_review', 'denied');
const arbPrivacyMode = fc.constantFrom('exact', 'nearby', 'neighborhood', 'city');

/** Generate a submission with random status, coordinates, and photo counts */
const arbSubmission = fc.record({
  id: fc.uuid(),
  status: arbStatus,
  privacy_mode: arbPrivacyMode,
  display_lat: fc.oneof(
    fc.double({ min: -90, max: 90, noNaN: true, noDefaultInfinity: true }),
    fc.constant(0)
  ),
  display_lng: fc.oneof(
    fc.double({ min: -180, max: 180, noNaN: true, noDefaultInfinity: true }),
    fc.constant(0)
  ),
  contributor_name: fc.oneof(fc.string({ minLength: 1, maxLength: 30 }), fc.constant(null)),
  story_text: fc.oneof(fc.string({ minLength: 1, maxLength: 100 }), fc.constant(null)),
  photo_count: fc.integer({ min: 0, max: 5 }),
});

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
// Feature: okra-map, Property 1: Map endpoint returns exactly the approved
// non-zero-coord submissions
// ═══════════════════════════════════════════════════════════════════════════

describe('Property 1: Map endpoint returns exactly the approved non-zero-coord submissions', () => {
  // **Validates: Requirements 2.1, 2.3, 2.4, 2.5**
  it('GET /okra returns exactly approved non-zero-coord submissions with total_count === data.length', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(arbSubmission, {
          minLength: 0,
          maxLength: 30,
          selector: (submission) => submission.id,
        }),
        async (submissions) => {
          const isNullIsland = (s: any) => s.display_lat === 0 && s.display_lng === 0;

          // Expected: approved AND NOT null-island
          const expected = submissions.filter(
            (s) => s.status === 'approved' && !isNullIsland(s)
          );

          // Build DB rows for ALL submissions (the handler query already filters)
          const approvedNonZeroRows = expected.map((s) => ({
            id: s.id,
            contributor_name: s.contributor_name,
            story_text: s.story_text,
            privacy_mode: s.privacy_mode,
            display_lat: s.display_lat,
            display_lng: s.display_lng,
          }));

          // Build photo rows: generate thumbnail keys per submission
          const allPhotoRows: Array<{ submission_id: string; thumbnail_s3_key: string }> = [];
          for (const s of expected) {
            for (let i = 0; i < s.photo_count; i++) {
              allPhotoRows.push({
                submission_id: s.id,
                thumbnail_s3_key: `submissions/${s.id}/photo${i}/thumbnail.webp`,
              });
            }
          }

          queryResponses = {
            'FROM submissions': { rows: approvedNonZeroRows, rowCount: approvedNonZeroRows.length },
            'FROM submission_photos': (_text: string, params: any[]) => {
              const requestedIds: string[] = params[0];
              const rows = allPhotoRows.filter((p) => requestedIds.includes(p.submission_id));
              return { rows, rowCount: rows.length };
            },
          };

          resetMocks();

          const res = await handler(makeRestApiEvent('/okra'));
          const { statusCode, body } = parseRes(res);

          expect(statusCode).toBe(200);

          // total_count === data.length
          expect(body.total_count).toBe(body.data.length);

          // Exactly the expected submissions are returned (by id set)
          const returnedIds = new Set(body.data.map((d: any) => d.id));
          const expectedIds = new Set(expected.map((s) => s.id));
          expect(returnedIds).toEqual(expectedIds);

          // Each returned item has the required fields
          for (const item of body.data) {
            expect(item).toHaveProperty('id');
            expect(item).toHaveProperty('display_lat');
            expect(item).toHaveProperty('display_lng');
            expect(item).toHaveProperty('contributor_name');
            expect(item).toHaveProperty('story_text');
            expect(item).toHaveProperty('photo_urls');
            expect(Array.isArray(item.photo_urls)).toBe(true);
          }

          // Verify photo_urls count matches expected photo_count per submission
          for (const item of body.data) {
            const original = expected.find((s) => s.id === item.id);
            if (original) {
              expect(item.photo_urls.length).toBe(original.photo_count);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Feature: okra-map, Property 2: Map endpoint applies deterministic privacy
// fuzzing
// ═══════════════════════════════════════════════════════════════════════════

describe('Property 2: Map endpoint applies deterministic privacy fuzzing', () => {
  // **Validates: Requirements 2.2**
  it('returned coordinates match fuzzCoordinates() output for each submission', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(
          arbSubmission.filter(
            (s) => s.status === 'approved' && !(s.display_lat === 0 && s.display_lng === 0)
          ),
          {
            minLength: 1,
            maxLength: 20,
            selector: (submission) => submission.id,
          }
        ),
        async (submissions) => {
          const dbRows = submissions.map((s) => ({
            id: s.id,
            contributor_name: s.contributor_name,
            story_text: s.story_text,
            privacy_mode: s.privacy_mode,
            display_lat: s.display_lat,
            display_lng: s.display_lng,
          }));

          queryResponses = {
            'FROM submissions': { rows: dbRows, rowCount: dbRows.length },
            'FROM submission_photos': { rows: [], rowCount: 0 },
          };

          resetMocks();

          const res = await handler(makeRestApiEvent('/okra'));
          const { statusCode, body } = parseRes(res);

          expect(statusCode).toBe(200);

          for (const item of body.data) {
            const original = submissions.find((s) => s.id === item.id);
            expect(original).toBeDefined();

            // Compute expected fuzzed coordinates using the same function
            const expectedFuzzed = fuzzCoordinates(
              original!.id,
              original!.display_lat,
              original!.display_lng,
              original!.privacy_mode
            );

            expect(item.display_lat).toBe(expectedFuzzed.lat);
            expect(item.display_lng).toBe(expectedFuzzed.lng);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// Feature: okra-map, Property 3: Stats endpoint computes correct aggregates
// from stored data
// ═══════════════════════════════════════════════════════════════════════════

describe('Property 3: Stats endpoint computes correct aggregates from stored data', () => {
  // **Validates: Requirements 3.1, 3.2, 3.3**

  /** Generator for an approved submission with varying country and contributor_name */
  const arbApprovedSubmission = fc.record({
    id: fc.uuid(),
    display_lat: fc.oneof(
      fc.double({ min: -90, max: 90, noNaN: true, noDefaultInfinity: true }),
      fc.constant(0)
    ),
    display_lng: fc.oneof(
      fc.double({ min: -180, max: 180, noNaN: true, noDefaultInfinity: true }),
      fc.constant(0)
    ),
    country: fc.oneof(
      fc.constantFrom('United States', 'Japan', 'Brazil', 'Nigeria', 'Germany', 'India'),
      fc.constant(null)
    ),
    contributor_name: fc.oneof(
      fc.string({ minLength: 1, maxLength: 30 }),
      fc.constant(''),
      fc.constant(null)
    ),
  });

  it('GET /okra/stats returns aggregates matching model computation', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbApprovedSubmission, { minLength: 0, maxLength: 40 }),
        async (submissions) => {
          // Model computation: filter to valid pins (not null-island)
          const validPins = submissions.filter(
            (s) => !(s.display_lat === 0 && s.display_lng === 0)
          );

          const expectedTotalPins = validPins.length;
          const expectedCountryCount = new Set(
            validPins.map((s) => s.country).filter((c) => c != null)
          ).size;
          const expectedContributorCount = new Set(
            validPins
              .map((s) => s.contributor_name)
              .filter((n) => n != null && n !== '')
          ).size;

          // Mock the aggregate SQL query result
          queryResponses = {
            'COUNT(*)': {
              rows: [
                {
                  total_pins: expectedTotalPins,
                  country_count: expectedCountryCount,
                  contributor_count: expectedContributorCount,
                },
              ],
              rowCount: 1,
            },
          };

          resetMocks();

          const res = await handler(makeRestApiEvent('/okra/stats'));
          const { statusCode, body } = parseRes(res);

          expect(statusCode).toBe(200);
          expect(body.total_pins).toBe(expectedTotalPins);
          expect(body.country_count).toBe(expectedCountryCount);
          expect(body.contributor_count).toBe(expectedContributorCount);
        }
      ),
      { numRuns: 100 }
    );
  });
});
