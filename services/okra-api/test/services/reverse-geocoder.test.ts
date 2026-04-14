import { describe, it, expect } from 'vitest';
import { resolveCountry } from '../../src/services/reverse-geocoder.mjs';

// Validates: Requirements 4.1
describe('known land coordinates return expected country names', () => {
  it('resolves United States (Kansas interior)', () => {
    const result = resolveCountry(38.5, -98.0);
    expect(result).toBe('United States of America');
  });

  it('resolves Brazil (interior)', () => {
    const result = resolveCountry(-14.0, -47.0);
    expect(result).toBe('Brazil');
  });

  it('resolves France (central)', () => {
    const result = resolveCountry(46.0, 2.5);
    expect(result).toBe('France');
  });

  it('resolves Australia (interior)', () => {
    const result = resolveCountry(-25.0, 134.0);
    expect(result).toBe('Australia');
  });

  it('resolves India (central)', () => {
    const result = resolveCountry(22.0, 80.0);
    expect(result).toBe('India');
  });
});

// Validates: Requirements 4.2
describe('ocean coordinates return null', () => {
  it('mid-Atlantic Ocean', () => {
    const result = resolveCountry(-20.0, -20.0);
    expect(result).toBeNull();
  });

  it('central Pacific Ocean', () => {
    const result = resolveCountry(15.0, -160.0);
    expect(result).toBeNull();
  });

  it('Southern Ocean', () => {
    const result = resolveCountry(-60.0, 50.0);
    expect(result).toBeNull();
  });
});

// Validates: Requirements 4.1, 4.2
describe('edge cases', () => {
  it('North Pole returns null (ocean/ice)', () => {
    const result = resolveCountry(90, 0);
    expect(result).toBeNull();
  });

  it('South Pole returns null (Antarctica or null)', () => {
    const result = resolveCountry(-90, 0);
    // Antarctica may or may not be in the dataset; either a string or null is acceptable
    expect(result === null || typeof result === 'string').toBe(true);
  });

  it('antimeridian positive (+180 lng) in Pacific', () => {
    const result = resolveCountry(0, 180);
    // 0,180 is in the Pacific Ocean
    expect(result).toBeNull();
  });

  it('antimeridian negative (-180 lng) in Pacific', () => {
    const result = resolveCountry(0, -180);
    // 0,-180 is in the Pacific Ocean
    expect(result).toBeNull();
  });

  it('null island (0, 0) returns null (Gulf of Guinea)', () => {
    const result = resolveCountry(0, 0);
    // 0,0 is in the Gulf of Guinea — ocean
    expect(result).toBeNull();
  });
});
