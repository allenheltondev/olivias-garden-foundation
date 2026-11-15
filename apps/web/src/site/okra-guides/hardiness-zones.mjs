// ZIP code to USDA plant hardiness zone lookup for the zoneLookup guide block.
// Uses phzmapi.org, the public 2023 USDA hardiness zone dataset that the GRN
// onboarding, the admin seed requests page and the Slack seed request
// notification already use. Only the 5-digit ZIP is sent, and nothing is stored.

export const PHZMAPI_URL = 'https://phzmapi.org';

/** Attribution: PRISM's terms ask for their name, URL and the access date. */
export const HARDINESS_ZONE_SOURCE = {
  name: 'PRISM Group, Oregon State University',
  url: 'https://prism.oregonstate.edu/phzm/',
  mapName: '2023 USDA Plant Hardiness Zone Map',
  accessed: '2026-11-15',
};

const US_ZIP = /^(\d{5})(?:[-\s]?\d{4})?$/;
const CANADIAN_POSTAL_CODE = /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][\s-]?\d[ABCEGHJ-NPRSTV-Z]\d$/i;

/**
 * Classifies what the reader typed.
 * @returns {{ kind: 'zip', zip: string } | { kind: 'canada' } | { kind: 'invalid' }}
 */
export function parsePostalInput(input) {
  const value = String(input ?? '').trim();
  const zip = US_ZIP.exec(value);
  if (zip) return { kind: 'zip', zip: zip[1] };
  if (CANADIAN_POSTAL_CODE.test(value)) return { kind: 'canada' };
  return { kind: 'invalid' };
}

/** "8b" -> 8. Returns undefined for anything that isn't a zone. */
export function zoneNumber(zone) {
  const match = /^(1[0-3]|[1-9])[ab]$/.exec(String(zone ?? ''));
  return match ? Number(match[1]) : undefined;
}

export function zoneLookupUrl(zip) {
  return `${PHZMAPI_URL}/${zip}.json`;
}

/**
 * Creates a lookup that remembers each ZIP for the life of the page. Failed
 * lookups aren't remembered, so the reader can retry once they're back online.
 * @param {typeof fetch} fetchImpl
 */
export function createZoneLookup(fetchImpl = (...args) => fetch(...args), { timeoutMs = 5000 } = {}) {
  const cache = new Map();

  const load = async (zip) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(zoneLookupUrl(zip), {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      // phzmapi has no file for ZIP codes outside the map data (PO boxes, for example).
      if (response.status === 404) return { status: 'not-found', zip };
      if (!response.ok) throw new Error(`Zone lookup failed with ${response.status}`);
      const data = await response.json();
      const zone = typeof data?.zone === 'string' ? data.zone.trim() : '';
      const number = zoneNumber(zone);
      return number === undefined ? { status: 'not-found', zip } : { status: 'found', zip, zone, zoneNumber: number };
    } finally {
      clearTimeout(timeoutId);
    }
  };

  /** @returns {Promise<{ status: 'found', zip: string, zone: string, zoneNumber: number } | { status: 'not-found', zip: string }>} */
  return function lookupZone(zip) {
    if (!cache.has(zip)) {
      const request = load(zip);
      request.catch(() => cache.delete(zip));
      cache.set(zip, request);
    }
    return cache.get(zip);
  };
}

/** The zoneLookup block row that covers a zone number, if any. */
export function findZoneRow(block, number) {
  return block.rows.find((row) => row.zones.includes(number));
}
