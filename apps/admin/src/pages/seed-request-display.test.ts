import { describe, expect, it } from 'vitest';
import type { SeedRequestQueueItem } from '../api';
import { describeCurrentPin, describePlannedPin, firstName, wantsMapPin } from './seed-request-display';

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

  it('says no pin when the requester did not opt in', () => {
    expect(describePlannedPin(makeRequest({ requestStatus: 'open', showOnMap: false }))).toBe(
      'They didn\u2019t opt in, so no map pin.',
    );
  });

  it('explains in-person requests get no pin', () => {
    expect(describePlannedPin(makeRequest({ fulfillmentMethod: 'in_person', shippingAddress: null }))).toBe(
      'No map pin for in-person exchanges.',
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
  it('requires mail, an address, and an explicit opt-in', () => {
    expect(wantsMapPin(makeRequest())).toBe(true);
    expect(wantsMapPin(makeRequest({ showOnMap: false }))).toBe(false);
    expect(wantsMapPin(makeRequest({ showOnMap: undefined }))).toBe(false);
    expect(wantsMapPin(makeRequest({ fulfillmentMethod: 'in_person' }))).toBe(false);
    expect(wantsMapPin(makeRequest({ shippingAddress: null }))).toBe(false);
  });

  it('describes a handled, not-opted-in request', () => {
    expect(describeCurrentPin(makeRequest({ showOnMap: false, mapPin: null }))).toBe('They didn\u2019t opt in, so no map pin.');
  });
});
