import { describe, expect, it } from 'vitest';
import type { SeedRequestQueueItem } from '../api';
import {
  canAddToMap,
  describeCurrentPin,
  describePlannedPin,
  firstName,
  formatPinAddress,
  pinAddressOf,
  wantsMapPin,
} from './seed-request-display';

function makeRequest(overrides: Partial<SeedRequestQueueItem> = {}): SeedRequestQueueItem {
  return {
    id: 'req-1',
    name: 'Jane Gardener',
    email: 'jane@example.com',
    fulfillmentMethod: 'mail',
    shippingAddress: { line1: '1 Okra Ln', city: 'Austin', region: 'TX', postalCode: '78701', country: 'US' },
    visitDetails: null,
    message: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    requestStatus: 'handled',
    showOnMap: true,
    pinVisibility: 'named',
    ...overrides,
  };
}

describe('firstName', () => {
  it('uses the first word, with a friendly fallback', () => {
    expect(firstName('Jane Gardener')).toBe('Jane');
    expect(firstName(null)).toBe('this grower');
    expect(firstName('  ')).toBe('this grower');
  });
});

describe('describePlannedPin', () => {
  it('previews first name and city only', () => {
    const text = describePlannedPin(makeRequest({ requestStatus: 'open' }));
    expect(text).toBe('Will show as Jane in Austin, TX. No street address or last name.');
    expect(text).not.toContain('Okra Ln');
    expect(text).not.toContain('Gardener');
  });

  it('previews an anonymous pin when the requester did not opt in to their name', () => {
    expect(describePlannedPin(makeRequest({ requestStatus: 'open', showOnMap: false, pinVisibility: 'anonymous' }))).toBe(
      'Will show as an anonymous pin in Austin, TX. No street address or last name.',
    );
  });

  it('explains in-person requests get no pin', () => {
    expect(describePlannedPin(makeRequest({ fulfillmentMethod: 'in_person', shippingAddress: null }))).toBe(
      'No map pin. Set a map address to add this exchange to the map.',
    );
  });
});

describe('describeCurrentPin', () => {
  it('distinguishes on-map, not-on-map, and unknown', () => {
    expect(describeCurrentPin(makeRequest({ mapPin: { locality: 'Austin, TX', country: 'US' } }))).toBe(
      'On the map as Jane in Austin, TX.',
    );
    expect(describeCurrentPin(makeRequest({ mapPin: null }))).toBe('Not on the map.');
    expect(describeCurrentPin(makeRequest({ mapPin: undefined }))).toBe('Couldn’t check the map pin right now.');
  });
});

describe('wantsMapPin', () => {
  it('follows the API verdict for mailed requests', () => {
    expect(wantsMapPin(makeRequest())).toBe(true);
    expect(wantsMapPin(makeRequest({ showOnMap: false, pinVisibility: 'anonymous' }))).toBe(true);
    expect(wantsMapPin(makeRequest({ showOnMap: false, pinVisibility: 'none' }))).toBe(false);
    expect(wantsMapPin(makeRequest({ pinVisibility: undefined }))).toBe(false);
    expect(wantsMapPin(makeRequest({ fulfillmentMethod: 'in_person' }))).toBe(false);
    expect(wantsMapPin(makeRequest({ shippingAddress: null }))).toBe(false);
  });

  it('describes anonymous and declined requests', () => {
    expect(describeCurrentPin(makeRequest({ pinVisibility: 'anonymous', mapPin: { locality: 'Austin, TX', country: 'US' } }))).toBe(
      'On the map as an anonymous pin in Austin, TX.',
    );
    expect(describeCurrentPin(makeRequest({ pinVisibility: 'anonymous', mapPin: null }))).toBe('Not on the map.');
    expect(describePlannedPin(makeRequest({ requestStatus: 'open', pinVisibility: 'none' }))).toBe(
      'No map pin \u2014 they were told they wouldn\u2019t get one.',
    );
  });
});

describe('canAddToMap', () => {
  it('offers Add to map only for done requests allowed a pin and known to have none', () => {
    expect(canAddToMap(makeRequest({ mapPin: null }))).toBe(true);
    expect(canAddToMap(makeRequest({ mapPin: null, pinVisibility: 'anonymous' }))).toBe(true);
    expect(canAddToMap(makeRequest({ mapPin: null, pinVisibility: 'none' }))).toBe(false);
    expect(canAddToMap(makeRequest({ mapPin: { locality: 'Austin, TX', country: 'US' } }))).toBe(false);
    expect(canAddToMap(makeRequest({ mapPin: undefined }))).toBe(false);
    expect(canAddToMap(makeRequest({ mapPin: null, requestStatus: 'open' }))).toBe(false);
    expect(canAddToMap(makeRequest({ mapPin: null, fulfillmentMethod: 'in_person', shippingAddress: null }))).toBe(false);
  });
});

describe('in-person map address', () => {
  const inPerson = (overrides: Partial<SeedRequestQueueItem> = {}) =>
    makeRequest({
      fulfillmentMethod: 'in_person',
      shippingAddress: null,
      showOnMap: false,
      pinVisibility: 'none',
      requestStatus: 'open',
      ...overrides,
    });

  it('has no pin until a map address is set, and says how to get one', () => {
    const request = inPerson();
    expect(wantsMapPin(request)).toBe(false);
    expect(describePlannedPin(request)).toContain('Set a map address');
  });

  it('plans an anonymous pin at the saved city, without the street or name', () => {
    const request = inPerson({
      pinVisibility: 'anonymous',
      pinAddress: { line1: '12 Oak St', city: 'Austin', region: 'TX', country: 'US' },
    });
    expect(pinAddressOf(request)).toMatchObject({ city: 'Austin' });
    expect(wantsMapPin(request)).toBe(true);
    const text = describePlannedPin(request);
    expect(text).toBe('Will show as an anonymous pin in Austin, TX. No street address or last name.');
    expect(text).not.toContain('Oak St');
    expect(text).not.toContain('Jane');
  });

  it('offers "Add to map" for a done in-person request with an address and no pin', () => {
    const request = inPerson({
      requestStatus: 'handled',
      pinVisibility: 'anonymous',
      pinAddress: { city: 'Austin', country: 'US' },
      mapPin: null,
    });
    expect(canAddToMap(request)).toBe(true);
    expect(canAddToMap({ ...request, pinAddress: null, pinVisibility: 'none' })).toBe(false);
  });

  it('ignores a map address on a mailed request', () => {
    expect(pinAddressOf(makeRequest({ pinAddress: { city: 'Elsewhere', country: 'US' } }))).toMatchObject({ city: 'Austin' });
  });

  it('formats an address on one line', () => {
    expect(formatPinAddress({ line1: '12 Oak St', line2: 'Apt 2', city: 'Austin', region: 'TX', postalCode: '78701', country: 'US' }))
      .toBe('12 Oak St, Apt 2 · Austin TX 78701 · US');
  });
});
