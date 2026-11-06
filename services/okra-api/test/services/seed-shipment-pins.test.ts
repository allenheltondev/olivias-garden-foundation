import { describe, it, expect } from 'vitest';
import {
  MAP_DISCLOSURE_VERSION,
  buildSeedShipmentPin,
  pinVisibility,
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
  const handled = { ...mailRequest, requestStatus: 'handled', showOnMap: true };
  const at = '2026-11-01T00:00:00.000Z';

  it('never carries last name, street, postal code, or email', () => {
    const pin = buildSeedShipmentPin(handled, { lat: 30.26721, lng: -97.74309 }, at, 3);
    expect(pin).toEqual({
      requestId: 'req-1',
      firstName: 'Jane',
      locality: 'Austin, TX',
      country: 'US',
      displayLat: 30.27,
      displayLng: -97.74,
      sentAt: at,
      sourceVersion: 3,
    });
    const serialized = JSON.stringify(pin);
    for (const secret of ['Gardener', 'Okra Lane', 'Apt 4', '78701', 'jane@example.com']) {
      expect(serialized).not.toContain(secret);
    }
  });

  it.each([
    ['made under the current notice and not opted in', { ...handled, showOnMap: false, mapDisclosure: MAP_DISCLOSURE_VERSION }],
    ['from before any map notice', { ...handled, showOnMap: undefined }],
  ])('is anonymous (no first name) when %s', (_label, request) => {
    const pin = buildSeedShipmentPin(request, { lat: 30.26721, lng: -97.74309 }, at, 2);
    expect(pin).toMatchObject({ firstName: null, locality: 'Austin, TX', country: 'US', displayLat: 30.27, sourceVersion: 2 });
    expect(JSON.stringify(pin)).not.toMatch(/Jane|Gardener|Okra Lane|78701|jane@example.com/);
  });

  it('never publishes a request that declined under the opt-in-only form', () => {
    // showOnMap stored as false with no disclosure version: they were told
    // leaving the box unchecked meant no pin at all.
    expect(buildSeedShipmentPin({ ...handled, showOnMap: false }, { lat: 1, lng: 1 }, at, 1)).toBeNull();
    expect(buildSeedShipmentPin({ ...handled, showOnMap: 'yes' }, { lat: 1, lng: 1 }, at, 1)).toBeNull();
  });

  it.each([
    ['not handled', { ...handled, requestStatus: 'open' }],
    ['in-person', { ...handled, fulfillmentMethod: 'in_person' }],
  ])('returns null when %s', (_label, request) => {
    expect(buildSeedShipmentPin(request, { lat: 1, lng: 1 }, at, 1)).toBeNull();
  });

  it('returns null without a location, request, or valid version', () => {
    expect(buildSeedShipmentPin(handled, null, at, 1)).toBeNull();
    expect(buildSeedShipmentPin(null, { lat: 1, lng: 1 }, at, 1)).toBeNull();
    expect(buildSeedShipmentPin(handled, { lat: 1, lng: 1 }, at, 0)).toBeNull();
    expect(buildSeedShipmentPin(handled, { lat: 1, lng: 1 }, at, undefined)).toBeNull();
  });
});

describe('pinVisibility', () => {
  const mail = { fulfillmentMethod: 'mail' };
  it.each([
    ['opted in to their name', { ...mail, showOnMap: true }, 'named'],
    ['opted in under the current notice', { ...mail, showOnMap: true, mapDisclosure: MAP_DISCLOSURE_VERSION }, 'named'],
    ['current notice, not opted in', { ...mail, showOnMap: false, mapDisclosure: MAP_DISCLOSURE_VERSION }, 'anonymous'],
    ['legacy, before any notice', { ...mail }, 'anonymous'],
    ['declined under the opt-in-only form', { ...mail, showOnMap: false }, 'none'],
    ['in-person', { fulfillmentMethod: 'in_person', showOnMap: true }, 'none'],
    ['missing', null, 'none'],
  ])('%s → %s', (_label, request, expected) => {
    expect(pinVisibility(request)).toBe(expected);
  });
});

