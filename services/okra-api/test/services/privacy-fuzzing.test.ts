import { describe, it, expect } from 'vitest';
import { fuzzCoordinates } from '../../src/services/privacy-fuzzing.mjs';

// Max radius values per privacy mode
const MAX_RADIUS = {
  nearby: 0.005,
  neighborhood: 0.02,
  city: 0.05,
};

function euclideanDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  return Math.sqrt((lat2 - lat1) ** 2 + (lng2 - lng1) ** 2);
}

// Validates: Requirements 3.6
describe('privacy fuzzing determinism', () => {
  it('same inputs produce same outputs', () => {
    const id = '550e8400-e29b-41d4-a716-446655440000';
    const lat = 34.052;
    const lng = -118.243;

    const result1 = fuzzCoordinates(id, lat, lng, 'nearby');
    const result2 = fuzzCoordinates(id, lat, lng, 'nearby');

    expect(result1.lat).toBe(result2.lat);
    expect(result1.lng).toBe(result2.lng);
  });

  it('deterministic across all non-exact modes', () => {
    const id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    for (const mode of ['nearby', 'neighborhood', 'city'] as const) {
      const r1 = fuzzCoordinates(id, 10, 20, mode);
      const r2 = fuzzCoordinates(id, 10, 20, mode);
      expect(r1.lat).toBe(r2.lat);
      expect(r1.lng).toBe(r2.lng);
    }
  });
});

// Validates: Requirements 3.1
describe('exact mode', () => {
  it('returns original coordinates unchanged', () => {
    const result = fuzzCoordinates('any-id', 34.052, -118.243, 'exact');
    expect(result.lat).toBe(34.052);
    expect(result.lng).toBe(-118.243);
  });

  it('returns original coordinates unchanged for zero coordinates', () => {
    const result = fuzzCoordinates('any-id', 0, 0, 'exact');
    expect(result.lat).toBe(0);
    expect(result.lng).toBe(0);
  });

  it('normalizes signed zero in exact mode', () => {
    const result = fuzzCoordinates('any-id', -0, -0, 'exact');
    expect(result.lat).toBe(0);
    expect(result.lng).toBe(0);
  });
});

// Validates: Requirements 3.2, 3.3, 3.4
describe('non-exact modes stay within maximum radius', () => {
  const testId = '550e8400-e29b-41d4-a716-446655440000';
  const lat = 34.052;
  const lng = -118.243;

  it('nearby mode stays within 0.005 degrees', () => {
    const result = fuzzCoordinates(testId, lat, lng, 'nearby');
    const dist = euclideanDistance(lat, lng, result.lat, result.lng);
    expect(dist).toBeLessThanOrEqual(MAX_RADIUS.nearby);
  });

  it('neighborhood mode stays within 0.02 degrees', () => {
    const result = fuzzCoordinates(testId, lat, lng, 'neighborhood');
    const dist = euclideanDistance(lat, lng, result.lat, result.lng);
    expect(dist).toBeLessThanOrEqual(MAX_RADIUS.neighborhood);
  });

  it('city mode stays within 0.05 degrees', () => {
    const result = fuzzCoordinates(testId, lat, lng, 'city');
    const dist = euclideanDistance(lat, lng, result.lat, result.lng);
    expect(dist).toBeLessThanOrEqual(MAX_RADIUS.city);
  });
});

// Validates: Requirements 3.1, 3.2, 3.3, 3.4
describe('boundary coordinates', () => {
  const testId = 'boundary-test-id-1234-5678-abcdef012345';

  it('handles max latitude (+90)', () => {
    for (const mode of ['nearby', 'neighborhood', 'city'] as const) {
      const result = fuzzCoordinates(testId, 90, 0, mode);
      const dist = euclideanDistance(90, 0, result.lat, result.lng);
      expect(dist).toBeLessThanOrEqual(MAX_RADIUS[mode]);
    }
  });

  it('handles min latitude (-90)', () => {
    for (const mode of ['nearby', 'neighborhood', 'city'] as const) {
      const result = fuzzCoordinates(testId, -90, 0, mode);
      const dist = euclideanDistance(-90, 0, result.lat, result.lng);
      expect(dist).toBeLessThanOrEqual(MAX_RADIUS[mode]);
    }
  });

  it('handles max longitude (+180)', () => {
    for (const mode of ['nearby', 'neighborhood', 'city'] as const) {
      const result = fuzzCoordinates(testId, 0, 180, mode);
      const dist = euclideanDistance(0, 180, result.lat, result.lng);
      expect(dist).toBeLessThanOrEqual(MAX_RADIUS[mode]);
    }
  });

  it('handles min longitude (-180)', () => {
    for (const mode of ['nearby', 'neighborhood', 'city'] as const) {
      const result = fuzzCoordinates(testId, 0, -180, mode);
      const dist = euclideanDistance(0, -180, result.lat, result.lng);
      expect(dist).toBeLessThanOrEqual(MAX_RADIUS[mode]);
    }
  });

  it('handles extreme corner (+90, +180)', () => {
    for (const mode of ['nearby', 'neighborhood', 'city'] as const) {
      const result = fuzzCoordinates(testId, 90, 180, mode);
      const dist = euclideanDistance(90, 180, result.lat, result.lng);
      expect(dist).toBeLessThanOrEqual(MAX_RADIUS[mode]);
    }
  });

  it('handles extreme corner (-90, -180)', () => {
    for (const mode of ['nearby', 'neighborhood', 'city'] as const) {
      const result = fuzzCoordinates(testId, -90, -180, mode);
      const dist = euclideanDistance(-90, -180, result.lat, result.lng);
      expect(dist).toBeLessThanOrEqual(MAX_RADIUS[mode]);
    }
  });
});
