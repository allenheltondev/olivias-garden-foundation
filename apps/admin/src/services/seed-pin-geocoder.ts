import type { SeedRequestQueueItem } from '../api';

/**
 * Finds an approximate, city-level location for a mailed seed request so the
 * public okra map can show a "seeds sent" pin.
 *
 * Privacy: nothing is looked up for requests that may not have a pin, and
 * then only city, region, postal code, and country are sent to the
 * geocoder. Street lines, names, and emails never leave the admin app.
 */

export interface SeedPinLocation {
  lat: number;
  lng: number;
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Ordered structured queries, most to least specific — all city-level or coarser. */
export function buildSeedPinQueries(request: SeedRequestQueueItem): URLSearchParams[] {
  if (request.fulfillmentMethod !== 'mail' || !request.shippingAddress) return [];
  if ((request.pinVisibility ?? 'none') === 'none') return [];

  const address = request.shippingAddress;
  const city = clean(address.city);
  const region = clean(address.region);
  const postalCode = clean(address.postalCode);
  const country = clean(address.country);
  if (!country) return [];

  const queries: Record<string, string>[] = [];
  if (city) {
    queries.push({ city, ...(region ? { state: region } : {}), country });
  }
  if (postalCode) {
    queries.push({ postalcode: postalCode, country });
  }

  return queries.map(
    (fields) => new URLSearchParams({ ...fields, format: 'json', limit: '1' }),
  );
}

function parseResult(body: unknown): SeedPinLocation | null {
  if (!Array.isArray(body) || body.length === 0) return null;
  const lat = Number.parseFloat(body[0]?.lat);
  const lng = Number.parseFloat(body[0]?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

/**
 * Returns a city-level location, or null if nothing could be found. Never
 * throws — a missing pin should never block marking seeds as sent.
 */
export async function findSeedPinLocation(
  request: SeedRequestQueueItem,
  fetcher: Fetcher = (input, init) => fetch(input, init),
): Promise<SeedPinLocation | null> {
  for (const params of buildSeedPinQueries(request)) {
    try {
      const res = await fetcher(`${NOMINATIM_SEARCH_URL}?${params.toString()}`, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) continue;
      const location = parseResult(await res.json());
      if (location) return location;
    } catch {
      // Try the next, coarser query.
    }
  }
  return null;
}
