/**
 * Locating a seed request for its public "seeds sent" map pin, as the admin
 * app does (apps/admin/src/services/seed-pin-geocoder.ts and
 * pages/seed-request-display.ts). Kept rule for rule the same, so marking a
 * request done here pins it exactly where the admin app's button would.
 *
 * Privacy: nothing is looked up for a request that may not have a pin. Mailed
 * requests are located at city level only: city, region, postal code and
 * country go to the geocoder; street lines, names and emails never do. The one
 * exception is an in-person exchange where an admin entered a map address:
 * that street is looked up so the pin can sit nearby, and the okra API still
 * rounds and fuzzes it before it goes public.
 */

const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
// Nominatim's usage policy asks every client to identify itself.
const USER_AGENT = 'olivias-garden-foundation-operator-mcp/1.0';
const QUERY_TIMEOUT_MS = 4000;

function clean(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || null;
}

/** The address a request's pin is placed from, or null. */
export function pinAddressOf(request) {
  if (request?.fulfillmentMethod === 'mail') return request.shippingAddress ?? null;
  if (request?.fulfillmentMethod === 'in_person') return request.pinAddress ?? null;
  return null;
}

/** Whether this request may have a pin at all: the API's verdict, and an address to place it from. */
export function wantsMapPin(request) {
  if (!pinAddressOf(request)) return false;
  return (request.pinVisibility ?? 'none') !== 'none';
}

/** Ordered structured queries, most to least specific. Empty when the request may not have a pin. */
export function buildSeedPinQueries(request) {
  if (!wantsMapPin(request)) return [];
  const address = pinAddressOf(request);
  const city = clean(address.city);
  const region = clean(address.region);
  const postalCode = clean(address.postalCode);
  const country = clean(address.country);
  if (!country) return [];

  const steps = [];
  const street = request.fulfillmentMethod === 'in_person' ? clean(address.line1) : null;
  if (street && city) {
    steps.push({
      fields: { street, city, ...(region ? { state: region } : {}), ...(postalCode ? { postalcode: postalCode } : {}), country },
      precision: 'nearby'
    });
  }
  if (city) steps.push({ fields: { city, ...(region ? { state: region } : {}), country }, precision: 'city' });
  if (postalCode) steps.push({ fields: { postalcode: postalCode, country }, precision: 'city' });

  return steps.map(({ fields, precision }) => ({
    params: new URLSearchParams({ ...fields, format: 'json', limit: '1' }),
    precision
  }));
}

function parseResult(body, precision) {
  if (!Array.isArray(body) || body.length === 0) return null;
  const lat = Number.parseFloat(body[0]?.lat);
  const lng = Number.parseFloat(body[0]?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng, precision };
}

/**
 * `locate(request)`: the most precise location found, or null. Never throws:
 * a missing pin never blocks recording that seeds were sent.
 */
export function createSeedPinLocator(fetcher = (url, init) => fetch(url, init)) {
  return async function locate(request) {
    for (const { params, precision } of buildSeedPinQueries(request)) {
      try {
        const res = await fetcher(`${NOMINATIM_SEARCH_URL}?${params.toString()}`, {
          headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
          signal: AbortSignal.timeout(QUERY_TIMEOUT_MS)
        });
        if (!res.ok) continue;
        const location = parseResult(await res.json(), precision);
        if (location) return location;
      } catch {
        // Try the next, coarser query.
      }
    }
    return null;
  };
}
