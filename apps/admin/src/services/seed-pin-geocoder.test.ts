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

  it('looks nothing up for requesters who did not opt in', () => {
    expect(buildSeedPinQueries(makeRequest({ showOnMap: false }))).toEqual([]);
    expect(buildSeedPinQueries(makeRequest({ showOnMap: undefined }))).toEqual([]);
  });

  it('returns nothing for in-person requests or missing country', () => {
    expect(buildSeedPinQueries(makeRequest({ fulfillmentMethod: 'in_person' }))).toEqual([]);
    expect(
      buildSeedPinQueries(makeRequest({ shippingAddress: { city: 'Austin', region: 'TX' } })),
    ).toEqual([]);
  });
});

describe('findSeedPinLocation', () => {
  it('returns the first usable result', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse([{ lat: '30.2672', lon: '-97.7431' }]));
    await expect(findSeedPinLocation(makeRequest(), fetcher)).resolves.toEqual({
      lat: 30.2672,
      lng: -97.7431,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('falls back to the postal code when the city is not found', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([{ lat: '30.27', lon: '-97.74' }]));
    await expect(findSeedPinLocation(makeRequest(), fetcher)).resolves.toEqual({ lat: 30.27, lng: -97.74 });
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
