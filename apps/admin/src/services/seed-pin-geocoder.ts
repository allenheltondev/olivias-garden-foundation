import type { SeedRequestQueueItem } from '../api';
import { pinAddressOf } from '../pages/seed-request-display';

/**
 * Finds a location for a seed request so the public okra map can show a
 * "seeds sent" pin.
 *
 * Privacy: nothing is looked up for requests that may not have a pin. Mailed
 * requests are located at city level only (city, region, postal code and
 * country go to the geocoder; street lines, names and emails never do). The one
 * exception is an in-person exchange where an admin deliberately entered a
 * street address: that street is looked up so the pin can sit nearby, and the
 * API still rounds and fuzzes it before it goes public.
 */

export type SeedPinPrecision = 'city' | 'nearby';

export interface SeedPinLocation {
  lat: number;
  lng: number;
  /** 'nearby' only when a street address was matched; the API double-checks. */
  precision: SeedPinPrecision;
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

interface QueryStep {
  params: URLSearchParams;
  precision: SeedPinPrecision;
}

/** Ordered structured queries, most to least specific. */
function buildSeedPinSteps(request: SeedRequestQueueItem): QueryStep[] {
  const address = pinAddressOf(request);
  if (!address) return [];
  if ((request.pinVisibility ?? 'none') === 'none') return [];

  const city = clean(address.city);
  const region = clean(address.region);
  const postalCode = clean(address.postalCode);
  const country = clean(address.country);
  if (!country) return [];

  const steps: { fields: Record<string, string>; precision: SeedPinPrecision }[] = [];
  const street = request.fulfillmentMethod === 'in_person' ? clean(address.line1) : null;
  if (street && city) {
    steps.push({
      fields: { street, city, ...(region ? { state: region } : {}), ...(postalCode ? { postalcode: postalCode } : {}), country },
      precision: 'nearby',
    });
  }
  if (city) {
    steps.push({ fields: { city, ...(region ? { state: region } : {}), country }, precision: 'city' });
  }
  if (postalCode) {
    steps.push({ fields: { postalcode: postalCode, country }, precision: 'city' });
  }

  return steps.map(({ fields, precision }) => ({
    params: new URLSearchParams({ ...fields, format: 'json', limit: '1' }),
    precision,
  }));
}

export function buildSeedPinQueries(request: SeedRequestQueueItem): URLSearchParams[] {
  return buildSeedPinSteps(request).map((step) => step.params);
}

function parseResult(body: unknown, precision: SeedPinPrecision): SeedPinLocation | null {
  if (!Array.isArray(body) || body.length === 0) return null;
  const lat = Number.parseFloat(body[0]?.lat);
  const lng = Number.parseFloat(body[0]?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng, precision };
}

/**
 * Returns the most precise location found, or null if nothing could be found. Never
 * throws — a missing pin should never block marking seeds as sent.
 */
export async function findSeedPinLocation(
  request: SeedRequestQueueItem,
  fetcher: Fetcher = (input, init) => fetch(input, init),
): Promise<SeedPinLocation | null> {
  for (const { params, precision } of buildSeedPinSteps(request)) {
    try {
      const res = await fetcher(`${NOMINATIM_SEARCH_URL}?${params.toString()}`, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) continue;
      const location = parseResult(await res.json(), precision);
      if (location) return location;
    } catch {
      // Try the next, coarser query.
    }
  }
  return null;
}
