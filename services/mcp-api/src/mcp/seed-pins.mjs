/**
 * Locating a seed request for its public "seeds sent" map pin, with the admin
 * app's rules (apps/admin/src/services/seed-pin-geocoder.ts and
 * pages/seed-request-display.ts): which requests may have a pin, which fields
 * are looked up, and in what order.
 *
 * Privacy: nothing is looked up for a request that may not have a pin. Mailed
 * requests are located at city level only: city, region, postal code and
 * country are sent; street lines, names and emails never are. The one
 * exception is an in-person exchange where an admin entered a map address:
 * that street is looked up so the pin can sit nearby, and the okra API still
 * rounds and fuzzes it before it goes public.
 *
 * Provider: Amazon Location Service (Geo Places `Geocode`), not the public
 * Nominatim the admin app calls from the browser. Nominatim's usage policy
 * allows one request per second across the whole application and expects
 * bulk users to cache, which a server that agents call in parallel cannot
 * promise; this way the MCP server adds no load to it at all. Amazon Location
 * is called with IntendedUse "Storage", which its terms require because the
 * okra API stores the pin's coordinates. Within one container, identical
 * lookups are shared and cached, and lookups run one at a time, so marking a
 * batch of requests from the same town costs one call.
 */

import { GeoPlacesClient, GeocodeCommand } from '@aws-sdk/client-geo-places';

const CACHE_LIMIT = 500;

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

/**
 * Ordered Geocode queries, most to least specific, as the admin app orders
 * them. Empty when the request may not have a pin.
 */
export function buildSeedPinQueries(request) {
  if (!wantsMapPin(request)) return [];
  const address = pinAddressOf(request);
  const city = clean(address.city);
  const region = clean(address.region);
  const postalCode = clean(address.postalCode);
  const country = clean(address.country)?.toUpperCase() ?? null;
  if (!country) return [];

  const steps = [];
  const street = request.fulfillmentMethod === 'in_person' ? clean(address.line1) : null;
  if (street && city) {
    steps.push({
      query: { QueryText: [street, city, [region, postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', '), Filter: { IncludeCountries: [country] } },
      precision: 'nearby'
    });
  }
  if (city) {
    steps.push({ query: { QueryComponents: { Locality: city, ...(region ? { Region: region } : {}), Country: country } }, precision: 'city' });
  }
  if (postalCode) {
    steps.push({ query: { QueryComponents: { PostalCode: postalCode, Country: country } }, precision: 'city' });
  }
  return steps;
}

/** Amazon Location returns Position as [longitude, latitude]. */
export function parseGeocodeResult(out, precision) {
  const position = out?.ResultItems?.[0]?.Position;
  if (!Array.isArray(position) || position.length < 2) return null;
  const [lng, lat] = position.map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng, precision };
}

/** `geocode(query)` → the provider's raw response. The default calls Amazon Location. */
function amazonLocationGeocoder(client = new GeoPlacesClient({})) {
  return (query) => client.send(new GeocodeCommand({ ...query, MaxResults: 1, IntendedUse: 'Storage' }));
}

/**
 * `locate(request)`: the most precise location found, or null. Never throws:
 * a missing pin never blocks recording that seeds were sent. Identical
 * queries share one call (in flight or cached, misses included), and calls run
 * one at a time.
 */
export function createSeedPinLocator(geocode = amazonLocationGeocoder(), { logger = console } = {}) {
  const cache = new Map();
  let queue = Promise.resolve();

  const serially = (fn) => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

  function lookup(step) {
    const key = JSON.stringify(step.query);
    if (cache.has(key)) return cache.get(key);
    const pending = serially(async () => {
      try {
        return parseGeocodeResult(await geocode(step.query), step.precision);
      } catch (error) {
        // A failed call is not cached: the next lookup may succeed.
        cache.delete(key);
        logger.warn?.(JSON.stringify({ level: 'WARN', msg: 'Seed pin geocode failed', error: error?.name ?? String(error) }));
        return null;
      }
    });
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
    cache.set(key, pending);
    return pending;
  }

  return async function locate(request) {
    for (const step of buildSeedPinQueries(request)) {
      const location = await lookup(step);
      if (location) return location;
    }
    return null;
  };
}
