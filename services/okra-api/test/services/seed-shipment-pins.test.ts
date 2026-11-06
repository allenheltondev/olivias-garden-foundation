import { describe, it, expect } from 'vitest';
import {
  buildSeedShipmentPin,
  getFirstName,
  getPublicLocality,
  parseMapLocation,
} from '../../src/services/seed-shipment-pins.mjs';

const mailRequest = {
  requestId: 'req-1',
  name: '  Jane Q. Gardener ',
  email: 'jane@example.com',
  fulfillmentMethod: 'mail',
  shippingAddress: {
    line1: '123 Okra Lane',
    line2: 'Apt 4',
    city: 'Austin',
    region: 'TX',
    postalCode: '78701',
    country: 'US',
  },
};

describe('getFirstName', () => {
  it('keeps only the first word', () => {
    expect(getFirstName('Jane Q. Gardener')).toBe('Jane');
    expect(getFirstName('  Cher  ')).toBe('Cher');
  });
  it('returns null for empty or missing names', () => {
    expect(getFirstName('   ')).toBeNull();
    expect(getFirstName(undefined)).toBeNull();
  });
});

describe('getPublicLocality', () => {
  it('uses city and region only', () => {
    expect(getPublicLocality(mailRequest.shippingAddress)).toBe('Austin, TX');
  });
  it('handles partial or missing addresses', () => {
    expect(getPublicLocality({ region: 'ON' })).toBe('ON');
    expect(getPublicLocality(null)).toBeNull();
  });
});

describe('parseMapLocation', () => {
  it('accepts a missing location', () => {
    expect(parseMapLocation(undefined)).toEqual({ ok: true, value: null });
    expect(parseMapLocation(null)).toEqual({ ok: true, value: null });
  });
  it('accepts valid coordinates', () => {
    expect(parseMapLocation({ lat: 30.2672, lng: -97.7431 })).toEqual({
      ok: true,
      value: { lat: 30.2672, lng: -97.7431 },
    });
  });
  it.each([
    ['string', 'Austin'],
    ['array', [1, 2]],
    ['lat out of range', { lat: 91, lng: 0 }],
    ['lng out of range', { lat: 0, lng: -181 }],
    ['non-numeric', { lat: '30', lng: '-97' }],
    ['NaN', { lat: Number.NaN, lng: 1 }],
    ['null island', { lat: 0, lng: 0 }],
  ])('rejects %s', (_label, value) => {
    expect(parseMapLocation(value).ok).toBe(false);
  });
});

describe('buildSeedShipmentPin', () => {
  it('never carries last name, street, postal code, or email', () => {
    const pin = buildSeedShipmentPin(mailRequest, { lat: 30.26721, lng: -97.74309 }, '2026-11-01T00:00:00.000Z');
    expect(pin).toEqual({
      requestId: 'req-1',
      firstName: 'Jane',
      locality: 'Austin, TX',
      country: 'US',
      displayLat: 30.27,
      displayLng: -97.74,
      sentAt: '2026-11-01T00:00:00.000Z',
    });
    const serialized = JSON.stringify(pin);
    for (const secret of ['Gardener', 'Okra Lane', 'Apt 4', '78701', 'jane@example.com']) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('skips in-person exchanges and requests without a location', () => {
    expect(buildSeedShipmentPin({ ...mailRequest, fulfillmentMethod: 'in_person' }, { lat: 1, lng: 1 }, 'x')).toBeNull();
    expect(buildSeedShipmentPin(mailRequest, null, 'x')).toBeNull();
    expect(buildSeedShipmentPin(null, { lat: 1, lng: 1 }, 'x')).toBeNull();
  });
});
