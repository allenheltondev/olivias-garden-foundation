import { createHash } from 'node:crypto';
import { fuzzCoordinates } from './privacy-fuzzing.mjs';

/**
 * Seed shipment pins put a marker on the public okra map for every place we
 * have mailed seeds. Seed requests hold full names and street addresses, so
 * this module is the single place that decides what is safe to publish:
 *
 *   - first name only, and only when the requester opted in to showing it
 *     (never the last name or email); otherwise the pin is anonymous
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
 * Version of the map notice shown on the seed request form when the request
 * was made. Stored on new mailed requests so later policy changes can't
 * reinterpret what someone agreed to.
 *   v2 (current): "an anonymous pin goes up at your city; check to add your
 *                 first name".
 *   (no version, showOnMap stored): the opt-in-only form, where leaving the
 *                 box unchecked meant no pin at all.
 *   (no version, no showOnMap): requests from before any map notice.
 */
export const MAP_DISCLOSURE_VERSION = 'anonymous-pin-v2';

/**
 * What kind of public pin a mailed request may have:
 *   'named'     - opted in to showing their first name
 *   'anonymous' - city/region, country and month only
 *   'none'      - must not appear on the map
 *
 * Requests made under the opt-in-only form that left the box unchecked were
 * told they'd get no pin, so they stay 'none'. Requests from before any map
 * notice may have anonymous pins (decided by the foundation).
 */
export function pinVisibility(seedRequest) {
  if (!seedRequest || seedRequest.fulfillmentMethod !== 'mail') return 'none';
  if (seedRequest.showOnMap === true) return 'named';
  if (seedRequest.mapDisclosure === MAP_DISCLOSURE_VERSION) return 'anonymous';
  if (seedRequest.showOnMap === undefined) return 'anonymous';
  return 'none';
}

/**
 * Build the public-safe pin row for a seed request at a given status
 * version, or null when the request must not produce a pin:
 *   - it isn't handled (the caller passes the state it just committed)
 *   - pinVisibility() says 'none' (in-person, or declined under the
 *     opt-in-only form)
 *   - no location was found
 *
 * The pin carries a first name only for 'named'; otherwise it's anonymous:
 * city/region, country and month only.
 */
export function buildSeedShipmentPin(seedRequest, mapLocation, sentAt, sourceVersion) {
  if (!seedRequest || !mapLocation) return null;
  if (seedRequest.requestStatus !== 'handled') return null;
  const visibility = pinVisibility(seedRequest);
  if (visibility === 'none') return null;
  if (!Number.isInteger(sourceVersion) || sourceVersion < 1) return null;

  return {
    requestId: String(seedRequest.requestId),
    firstName: visibility === 'named' ? getFirstName(seedRequest.name) : null,
    locality: getPublicLocality(seedRequest.shippingAddress),
    country: seedRequest.shippingAddress?.country ?? null,
    displayLat: roundCoordinate(mapLocation.lat),
    displayLng: roundCoordinate(mapLocation.lng),
    sentAt,
    sourceVersion
  };
}

/**
 * Show a pin, but only if no newer version (including a removal) has
 * already been written. Returns true when this write took effect.
 */
export async function upsertSeedShipmentPin(client, pin) {
  const result = await client.query(
    `INSERT INTO seed_shipment_pins
       (request_id, first_name, locality, country, display_lat, display_lng, sent_at, source_version, visible)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
     ON CONFLICT (request_id) DO UPDATE SET
       first_name = EXCLUDED.first_name,
       locality = EXCLUDED.locality,
       country = EXCLUDED.country,
       display_lat = EXCLUDED.display_lat,
       display_lng = EXCLUDED.display_lng,
       sent_at = EXCLUDED.sent_at,
       source_version = EXCLUDED.source_version,
       visible = true
     WHERE seed_shipment_pins.source_version < EXCLUDED.source_version`,
    [pin.requestId, pin.firstName, pin.locality, pin.country, pin.displayLat, pin.displayLng, pin.sentAt, pin.sourceVersion]
  );
  return (result?.rowCount ?? 0) > 0;
}

/**
 * Hide a request's pin as of `sourceVersion`. Writes a tombstone (public
 * fields cleared) so a stale, lower-versioned insert arriving later is
 * rejected. Ties go to the removal: a pin and a removal can only share a
 * version for rows written before versioning existed.
 *
 * Returns true if a visible pin was hidden, false otherwise.
 */
export async function hideSeedShipmentPin(client, requestId, sourceVersion) {
  const result = await client.query(
    // `prev` reads the statement's snapshot, i.e. the row before this write.
    // (FOR UPDATE here would make Postgres skip the row this same statement
    // updates and return NULL.) Ordering is enforced by the version check
    // below, not by this read; it only feeds the returned flag.
    `WITH prev AS MATERIALIZED (
       SELECT visible FROM seed_shipment_pins WHERE request_id = $1
     )
     INSERT INTO seed_shipment_pins (request_id, source_version, visible)
     VALUES ($1, $2, false)
     ON CONFLICT (request_id) DO UPDATE SET
       first_name = NULL,
       locality = NULL,
       country = NULL,
       display_lat = NULL,
       display_lng = NULL,
       source_version = EXCLUDED.source_version,
       visible = false
     WHERE seed_shipment_pins.source_version <= EXCLUDED.source_version
     RETURNING (SELECT visible FROM prev) AS was_visible`,
    [String(requestId), sourceVersion]
  );
  return result?.rows?.[0]?.was_visible === true;
}

export async function listSeedShipmentPins(client) {
  const res = await client.query(
    `SELECT request_id, first_name, locality, country, display_lat, display_lng, sent_at
       FROM seed_shipment_pins
      WHERE visible
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

/** Admin-only lookup: request_id → { locality, country } for visible pins. */
export async function getSeedShipmentPinsByRequestId(client, requestIds) {
  const map = new Map();
  if (!requestIds || requestIds.length === 0) return map;
  const res = await client.query(
    `SELECT request_id, locality, country
       FROM seed_shipment_pins
      WHERE request_id = ANY($1)
        AND visible`,
    [requestIds.map(String)]
  );
  for (const row of res.rows) {
    map.set(row.request_id, { locality: row.locality ?? null, country: row.country ?? null });
  }
  return map;
}
