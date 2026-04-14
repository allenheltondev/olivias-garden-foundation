import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { resolveCountry } from '../../src/services/reverse-geocoder.mjs';

// ═══════════════════════════════════════════════════════════════════════════
// Property 4: Reverse geocoder resolves land coordinates to countries
// ═══════════════════════════════════════════════════════════════════════════

// Feature: okra-map, Property 4: Reverse geocoder resolves land coordinates to countries
describe('Property 4: Reverse geocoder resolves land coordinates to countries', () => {

  // Known country bounding boxes — deep interior regions to avoid coastal
  // edge cases where the low-resolution Natural Earth 110m dataset may have
  // polygon gaps near coastlines, islands, or narrow land features.
  const countryBounds = [
    { name: 'United States', latMin: 33, latMax: 42, lngMin: -105, lngMax: -85 },
    { name: 'Brazil', latMin: -18, latMax: -8, lngMin: -52, lngMax: -42 },
    { name: 'France', latMin: 45, latMax: 47, lngMin: 1, lngMax: 4 },
    { name: 'China', latMin: 28, latMax: 38, lngMin: 103, lngMax: 113 },
    { name: 'Australia', latMin: -28, latMax: -22, lngMin: 135, lngMax: 145 },
    { name: 'India', latMin: 18, latMax: 26, lngMin: 77, lngMax: 83 },
    { name: 'Russia', latMin: 55, latMax: 60, lngMin: 50, lngMax: 70 },
    { name: 'Nigeria', latMin: 8, latMax: 11, lngMin: 5, lngMax: 9 },
  ];

  // Ocean regions (well away from any land)
  const oceanRegions = [
    { name: 'Mid-Atlantic', latMin: -35, latMax: -20, lngMin: -20, lngMax: -5 },
    { name: 'South Pacific', latMin: -50, latMax: -38, lngMin: -135, lngMax: -115 },
    { name: 'Southern Indian Ocean', latMin: -44, latMax: -36, lngMin: 60, lngMax: 80 },
    { name: 'Central Pacific', latMin: 5, latMax: 15, lngMin: -175, lngMax: -165 },
  ];

  const landCoordArb = fc.constantFrom(...countryBounds).chain((bounds) =>
    fc.tuple(
      fc.double({ min: bounds.latMin, max: bounds.latMax, noNaN: true }),
      fc.double({ min: bounds.lngMin, max: bounds.lngMax, noNaN: true })
    )
  );

  const oceanCoordArb = fc.constantFrom(...oceanRegions).chain((region) =>
    fc.tuple(
      fc.double({ min: region.latMin, max: region.latMax, noNaN: true }),
      fc.double({ min: region.lngMin, max: region.lngMax, noNaN: true })
    )
  );

  // **Validates: Requirements 4.1, 4.2, 4.3**
  it('returns non-null country name for coordinates within known land boundaries', () => {
    fc.assert(
      fc.property(landCoordArb, ([lat, lng]) => {
        const result = resolveCountry(lat, lng);
        expect(result).not.toBeNull();
        expect(typeof result).toBe('string');
        expect(result!.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 4.1, 4.2, 4.3**
  it('returns null for coordinates in the ocean', () => {
    fc.assert(
      fc.property(oceanCoordArb, ([lat, lng]) => {
        const result = resolveCountry(lat, lng);
        expect(result).toBeNull();
      }),
      { numRuns: 100 }
    );
  });
});
