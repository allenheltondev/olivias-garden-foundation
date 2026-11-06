import { createHash } from 'node:crypto';
import { fuzzCoordinates } from './privacy-fuzzing.mjs';

/**
 * Seed shipment pins put a marker on the public okra map for every place we
 * have mailed seeds. Seed requests hold full names and street addresses, so
 * this module is the single place that decides what is safe to publish:
 *
 *   - first name only (never the last name or email)
 *   - city + region and country (never street lines or postal code)
 *   - coordinates rounded to 2 decimals (~1 km) on write, then fuzzed
 *     deterministically within city radius on read
 */

const STORED_COORDINATE_DECIMALS = 2;

export function getFirstName(fullName) {
  if (typeof fullName !== 'string') return null;
  const first = fullName.trim().split(/\s+/)[0];
  return first ? first.slice(0, 60) : null;
}

export function getPublicLocality(shippingAddress) {
  if (!shippingAddress || typeof shippingAddress !== 'object') return null;
  const parts = [shippingAddress.city, shippingAddress.region]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean);
  return parts.length > 0 ? parts.join(', ').slice(0, 200) : null;
}

function roundCoordinate(value) {
  const factor = 10 ** STORED_COORDINATE_DECIMALS;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * Validate an admin-supplied `map_location`. Returns `{ ok: true, value }`
 * (value is null when no location was sent) or `{ ok: false, message }`.
 */
export function parseMapLocation(raw) {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, message: 'map_location must be an object with lat and lng' };
  }
  const { lat, lng } = raw;
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) {
    return { ok: false, message: 'map_location.lat must be a number between -90 and 90' };
  }
  if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    return { ok: false, message: 'map_location.lng must be a number between -180 and 180' };
  }
  if (lat === 0 && lng === 0) {
    return { ok: false, message: 'map_location cannot be 0,0' };
  }
  return { ok: true, value: { lat, lng } };
}

/**
 * Build the public-safe pin row for a handled seed request, or null when the
 * request should not produce a pin (in-person exchange, or no location).
 */
export function buildSeedShipmentPin(seedRequest, mapLocation, sentAt) {
  if (!seedRequest || !mapLocation) return null;
  if (seedRequest.fulfillmentMethod !== 'mail') return null;

  return {
    requestId: String(seedRequest.requestId),
    firstName: getFirstName(seedRequest.name),
    locality: getPublicLocality(seedRequest.shippingAddress),
    country: seedRequest.shippingAddress?.country ?? null,
    displayLat: roundCoordinate(mapLocation.lat),
    displayLng: roundCoordinate(mapLocation.lng),
    sentAt
  };
}

/**
 * Idempotent: replaying the same handled transition keeps the first pin.
 */
export async function insertSeedShipmentPin(client, pin) {
  const result = await client.query(
    `INSERT INTO seed_shipment_pins
       (request_id, first_name, locality, country, display_lat, display_lng, sent_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (request_id) DO NOTHING`,
    [pin.requestId, pin.firstName, pin.locality, pin.country, pin.displayLat, pin.displayLng, pin.sentAt]
  );
  return (result?.rowCount ?? 0) > 0;
}

export async function listSeedShipmentPins(client) {
  const res = await client.query(
    `SELECT request_id, first_name, locality, country, display_lat, display_lng, sent_at
       FROM seed_shipment_pins
      ORDER BY sent_at DESC, request_id DESC`
  );

  return res.rows.map((row) => {
    const fuzzed = fuzzCoordinates(row.request_id, Number(row.display_lat), Number(row.display_lng), 'city');
    const sentAt = row.sent_at instanceof Date ? row.sent_at.toISOString() : row.sent_at;
    return {
      // Don't leak the internal seed request id on the public map.
      id: `seeds-${createHash('sha256').update(String(row.request_id)).digest('hex').slice(0, 16)}`,
      display_lat: fuzzed.lat,
      display_lng: fuzzed.lng,
      first_name: row.first_name ?? null,
      locality: row.locality ?? null,
      country: row.country ?? null,
      // Month precision is plenty for "seeds sent" and avoids exposing
      // exactly when someone's mail went out.
      sent_month: typeof sentAt === 'string' ? sentAt.slice(0, 7) : null
    };
  });
}

/** Idempotent: returns true if a pin was removed, false if there was none. */
export async function deleteSeedShipmentPin(client, requestId) {
  const result = await client.query(
    'DELETE FROM seed_shipment_pins WHERE request_id = $1',
    [String(requestId)]
  );
  return (result?.rowCount ?? 0) > 0;
}

/** Admin-only lookup: request_id → { locality, country } for the given ids. */
export async function getSeedShipmentPinsByRequestId(client, requestIds) {
  const map = new Map();
  if (!requestIds || requestIds.length === 0) return map;
  const res = await client.query(
    `SELECT request_id, locality, country
       FROM seed_shipment_pins
      WHERE request_id = ANY($1)`,
    [requestIds.map(String)]
  );
  for (const row of res.rows) {
    map.set(row.request_id, { locality: row.locality ?? null, country: row.country ?? null });
  }
  return map;
}
