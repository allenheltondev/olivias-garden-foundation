import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { encodeCursor, decodeCursor } from '../../src/services/pagination.mjs';

// ═══════════════════════════════════════════════════════════════════════════
// Property 14: Cursor Encoding Round Trip
// ═══════════════════════════════════════════════════════════════════════════

// Feature: paginated-endpoints, Property 14: Cursor Encoding Round Trip
describe('Property 14: Cursor Encoding Round Trip', () => {
  // **Validates: Requirements 7.10**
  it('encoding then decoding a valid (created_at, id) pair produces the original values', () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date('2000-01-01'), max: new Date('2099-12-31') }),
        fc.uuid(),
        (date, id) => {
          const created_at_raw = date.toISOString();

          const cursor = encodeCursor({ created_at_raw, id });
          const decoded = decodeCursor(cursor);

          expect(decoded).not.toBeNull();
          expect(decoded!.created_at).toBe(created_at_raw);
          expect(decoded!.id).toBe(id);
        }
      ),
      { numRuns: 100 }
    );
  });
});

import { fuzzCoordinates } from '../../src/services/privacy-fuzzing.mjs';

function normalizeZero(value: number) {
  return Object.is(value, -0) ? 0 : value;
}

// ═══════════════════════════════════════════════════════════════════════════
// Property 5: Privacy Fuzzing Bounds
// ═══════════════════════════════════════════════════════════════════════════

// Feature: paginated-endpoints, Property 5: Privacy Fuzzing Bounds
describe('Property 5: Privacy Fuzzing Bounds', () => {
  const MAX_RADIUS: Record<string, number> = {
    nearby: 0.005,
    neighborhood: 0.02,
    city: 0.05,
  };

  // **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
  it('exact mode returns original coordinates unchanged', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.double({ min: -90, max: 90, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        (id, lat, lng) => {
          const result = fuzzCoordinates(id, lat, lng, 'exact');
          expect(result.lat).toBe(normalizeZero(lat));
          expect(result.lng).toBe(normalizeZero(lng));
        }
      ),
      { numRuns: 100 }
    );
  });

  it.each(['nearby', 'neighborhood', 'city'] as const)(
    '%s mode fuzzed coordinates stay within max radius',
    (mode) => {
      fc.assert(
        fc.property(
          fc.uuid(),
          fc.double({ min: -90, max: 90, noNaN: true }),
          fc.double({ min: -180, max: 180, noNaN: true }),
          (id, lat, lng) => {
            const result = fuzzCoordinates(id, lat, lng, mode);
            const dLat = result.lat - lat;
            const dLng = result.lng - lng;
            const distance = Math.sqrt(dLat * dLat + dLng * dLng);
            expect(distance).toBeLessThanOrEqual(MAX_RADIUS[mode]);
          }
        ),
        { numRuns: 100 }
      );
    }
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// Property 6: Privacy Fuzzing Determinism
// ═══════════════════════════════════════════════════════════════════════════

// Feature: paginated-endpoints, Property 6: Privacy Fuzzing Determinism
describe('Property 6: Privacy Fuzzing Determinism', () => {
  const privacyModes = ['exact', 'nearby', 'neighborhood', 'city'] as const;

  // **Validates: Requirements 3.6**
  it('calling fuzzCoordinates twice with the same inputs produces identical output', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.double({ min: -90, max: 90, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        fc.constantFrom(...privacyModes),
        (id, lat, lng, mode) => {
          const result1 = fuzzCoordinates(id, lat, lng, mode);
          const result2 = fuzzCoordinates(id, lat, lng, mode);
          expect(result1.lat).toBe(result2.lat);
          expect(result1.lng).toBe(result2.lng);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Property 7: Privacy Fuzzing Never Produces Null Island
// ═══════════════════════════════════════════════════════════════════════════

// Feature: paginated-endpoints, Property 7: Privacy Fuzzing Never Produces Null Island
describe('Property 7: Privacy Fuzzing Never Produces Null Island', () => {
  const nonExactModes = ['nearby', 'neighborhood', 'city'] as const;

  // **Validates: Requirements 3.7**
  it('fuzzed coordinates are never both exactly 0 for non-exact modes', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.double({ min: -90, max: 90, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        fc.constantFrom(...nonExactModes),
        (id, lat, lng, mode) => {
          const result = fuzzCoordinates(id, lat, lng, mode);
          expect(result.lat === 0 && result.lng === 0).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
