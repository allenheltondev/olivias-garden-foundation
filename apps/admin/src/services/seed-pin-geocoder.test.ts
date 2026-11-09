import { describe, expect, it, vi } from 'vitest';
import type { SeedRequestQueueItem } from '../api';
import { buildSeedPinQueries, findSeedPinLocation } from './seed-pin-geocoder';

function makeRequest(overrides: Partial<SeedRequestQueueItem> = {}): SeedRequestQueueItem {
  return {
    id: 'req-1',
    name: 'Jane Gardener',
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
    visitDetails: null,
    message: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    requestStatus: 'open',
    showOnMap: true,
    pinVisibility: 'named',
    ...overrides,
  };
}

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: () => Promise.resolve(body) } as Response;
}

describe('buildSeedPinQueries', () => {
  it('queries by city first, then postal code, never the street or name', () => {
    const queries = buildSeedPinQueries(makeRequest()).map((q) => Object.fromEntries(q));
    expect(queries).toEqual([
      { city: 'Austin', state: 'TX', country: 'US', format: 'json', limit: '1' },
      { postalcode: '78701', country: 'US', format: 'json', limit: '1' },
    ]);
    const serialized = JSON.stringify(queries);
    for (const secret of ['Okra Lane', 'Apt 4', 'Jane', 'Gardener', 'jane@example.com']) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('geocodes anonymous-pin requests, but nothing for requests that may not have a pin', () => {
    expect(buildSeedPinQueries(makeRequest({ showOnMap: false, pinVisibility: 'anonymous' }))).toHaveLength(2);
    expect(buildSeedPinQueries(makeRequest({ showOnMap: false, pinVisibility: 'none' }))).toEqual([]);
    expect(buildSeedPinQueries(makeRequest({ pinVisibility: undefined }))).toEqual([]);
  });

  it('returns nothing for in-person requests or missing country', () => {
    expect(buildSeedPinQueries(makeRequest({ fulfillmentMethod: 'in_person' }))).toEqual([]);
    expect(
      buildSeedPinQueries(makeRequest({ shippingAddress: { city: 'Austin', region: 'TX' } })),
    ).toEqual([]);
  });
});

describe('buildSeedPinQueries for in-person requests', () => {
  const inPerson = (overrides: Partial<SeedRequestQueueItem> = {}) =>
    makeRequest({
      fulfillmentMethod: 'in_person',
      shippingAddress: null,
      showOnMap: false,
      pinVisibility: 'anonymous',
      pinAddress: { line1: '12 Oak St', city: 'Austin', region: 'TX', postalCode: '78701', country: 'US' },
      ...overrides,
    });

  it('tries the street address first, then falls back to city and postal code, never sending the name', () => {
    const queries = buildSeedPinQueries(inPerson()).map((q) => Object.fromEntries(q));
    expect(queries).toEqual([
      { street: '12 Oak St', city: 'Austin', state: 'TX', postalcode: '78701', country: 'US', format: 'json', limit: '1' },
      { city: 'Austin', state: 'TX', country: 'US', format: 'json', limit: '1' },
      { postalcode: '78701', country: 'US', format: 'json', limit: '1' },
    ]);
    const serialized = JSON.stringify(queries);
    for (const secret of ['Jane', 'Gardener', 'jane@example.com']) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('stays at city level when no street was entered', () => {
    const queries = buildSeedPinQueries(inPerson({ pinAddress: { city: 'Austin', region: 'TX', country: 'US' } }));
    expect(queries).toHaveLength(1);
    expect(queries[0].has('street')).toBe(false);
  });

  it('reports nearby precision only when the street query matched', async () => {
    const hit = { ok: true, json: () => Promise.resolve([{ lat: '30.2671', lon: '-97.7432' }]) } as Response;
    const miss = { ok: true, json: () => Promise.resolve([]) } as Response;
    expect(await findSeedPinLocation(inPerson(), () => Promise.resolve(hit))).toEqual({ lat: 30.2671, lng: -97.7432, precision: 'nearby' });
    const fetcher = vi.fn().mockResolvedValueOnce(miss).mockResolvedValueOnce(hit);
    expect(await findSeedPinLocation(inPerson(), fetcher)).toMatchObject({ precision: 'city' });
  });

  it('never sends a mailed request\'s street line', () => {
    const serialized = JSON.stringify(buildSeedPinQueries(makeRequest()).map((q) => Object.fromEntries(q)));
    expect(serialized).not.toContain('street');
    expect(serialized).not.toContain('Okra Lane');
  });

  it('does nothing without a map address', () => {
    expect(buildSeedPinQueries(inPerson({ pinAddress: null }))).toEqual([]);
    expect(buildSeedPinQueries(inPerson({ pinAddress: undefined }))).toEqual([]);
  });
});

describe('findSeedPinLocation', () => {
  it('returns the first usable result', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse([{ lat: '30.2672', lon: '-97.7431' }]));
    await expect(findSeedPinLocation(makeRequest(), fetcher)).resolves.toEqual({
      lat: 30.2672,
      lng: -97.7431,
      precision: 'city',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('falls back to the postal code when the city is not found', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([{ lat: '30.27', lon: '-97.74' }]));
    await expect(findSeedPinLocation(makeRequest(), fetcher)).resolves.toEqual({ lat: 30.27, lng: -97.74, precision: 'city' });
    expect(String(fetcher.mock.calls[1][0])).toContain('postalcode=78701');
  });

  it('returns null instead of throwing when the geocoder is unavailable', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(jsonResponse({}, false));
    await expect(findSeedPinLocation(makeRequest(), fetcher)).resolves.toBeNull();
  });

  it('ignores null-island results', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse([{ lat: '0', lon: '0' }]));
    await expect(findSeedPinLocation(makeRequest(), fetcher)).resolves.toBeNull();
  });
});
