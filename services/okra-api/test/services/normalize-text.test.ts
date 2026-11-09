import { describe, expect, it } from 'vitest';
import {
  normalizeAddress,
  normalizeAddressText,
  normalizeName,
  normalizePostalCode,
  normalizeRegion
} from '../../src/services/normalize-text.mjs';

describe('normalizeName', () => {
  it.each([
    ['john smith', 'John Smith'],
    ['JOHN SMITH', 'John Smith'],
    ['  mary   jane  ', 'Mary Jane'],
    ['mary-jane o\'brien', 'Mary-Jane O\'Brien'],
    ['mcdonald', 'McDonald'],
    ['ludwig VAN beethoven', 'Ludwig van Beethoven'],
    ['john smith jr.', 'John Smith Jr.'],
    ['john smith iii', 'John Smith III'],
    ['j.r. smith', 'J.R. Smith'],
    ['anna le', 'Anna Le']
  ])('%s → %s', (input, expected) => {
    expect(normalizeName(input)).toBe(expected);
  });

  it('keeps deliberate mixed-case names as typed', () => {
    expect(normalizeName('DeShawn McDonald')).toBe('DeShawn McDonald');
    expect(normalizeName('Ana De La Cruz')).toBe('Ana De La Cruz');
  });

  it('never touches emails or non-strings', () => {
    expect(normalizeName('Jane@Example.com')).toBe('Jane@Example.com');
    expect(normalizeName(undefined)).toBeUndefined();
  });

  it('is idempotent', () => {
    for (const name of ['JOHN SMITH', 'mary-jane o\'brien', 'ludwig VAN beethoven']) {
      expect(normalizeName(normalizeName(name))).toBe(normalizeName(name));
    }
  });
});

describe('normalizeAddressText', () => {
  it.each([
    ['123 main st', '123 Main St'],
    ['456 N 1ST ave apt 4b', '456 N 1st Ave Apt 4B'],
    ['po box 12', 'PO Box 12'],
    ['st. mary\'s rd', 'St. Mary\'s Rd'],
    ['avenue OF the americas', 'Avenue of the Americas'],
    ['WINSTON-SALEM', 'Winston-Salem'],
    ['austin, tx', 'Austin, TX'],
    ['downtown austin, tx 78701', 'Downtown Austin, TX 78701']
  ])('%s → %s', (input, expected) => {
    expect(normalizeAddressText(input)).toBe(expected);
  });
});

describe('normalizeRegion / normalizePostalCode / normalizeAddress', () => {
  it('upper-cases state codes and title-cases full names', () => {
    expect(normalizeRegion('tx')).toBe('TX');
    expect(normalizeRegion('tx.')).toBe('TX');
    expect(normalizeRegion('british columbia')).toBe('British Columbia');
  });

  it('upper-cases and tidies postal codes', () => {
    expect(normalizePostalCode(' k1a  0b1 ')).toBe('K1A 0B1');
  });

  it('normalizes each field of an address and leaves other keys alone', () => {
    expect(normalizeAddress({ line1: '1 oak ST', line2: 'apt 2', city: 'new york', region: 'ny', postalCode: '10001', country: 'us', extra: 'kept' }))
      .toEqual({ line1: '1 Oak St', line2: 'Apt 2', city: 'New York', region: 'NY', postalCode: '10001', country: 'US', extra: 'kept' });
    expect(normalizeAddress(undefined)).toBeUndefined();
  });
});
