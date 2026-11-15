// ZIP code to USDA plant hardiness zone lookup for the zoneLookup guide block.
// The data files come from scripts/build-hardiness-zones.mjs. Lookups happen in
// the reader's browser: the ZIP is never sent to an API or stored, only the
// file for its first two digits is fetched from this site.

export const HARDINESS_ZONE_EDITION = '2023';

/** Attribution required by the PRISM terms of use: name, URL and access date. */
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

export function zoneShardPath(zip) {
  return `/data/hardiness-zones/${HARDINESS_ZONE_EDITION}/${zip.slice(0, 2)}.json`;
}

/**
 * Creates a lookup that caches each shard after the first fetch.
 * @param {typeof fetch} fetchImpl
 */
export function createZoneLookup(fetchImpl = (...args) => fetch(...args)) {
  const shards = new Map();

  const loadShard = (path) => {
    if (!shards.has(path)) {
      const request = fetchImpl(path, { headers: { Accept: 'application/json' } }).then(async (response) => {
        // A missing file falls back to the SPA's index.html with a 200, so
        // check the type too. Either way it means no ZIP codes start this way.
        const type = response.headers.get('content-type') ?? '';
        if (response.status === 404 || (response.ok && !type.includes('json'))) return {};
        if (!response.ok) throw new Error(`Zone lookup failed with ${response.status}`);
        return response.json();
      });
      // Don't cache failures, so the reader can retry once they're back online.
      request.catch(() => shards.delete(path));
      shards.set(path, request);
    }
    return shards.get(path);
  };

  /** @returns {Promise<{ status: 'found', zip: string, zone: string, zoneNumber: number } | { status: 'not-found', zip: string }>} */
  return async function lookupZone(zip) {
    const shard = await loadShard(zoneShardPath(zip));
    const zone = shard[zip];
    const number = zoneNumber(zone);
    return number === undefined ? { status: 'not-found', zip } : { status: 'found', zip, zone, zoneNumber: number };
  };
}

/** The zoneLookup block row that covers a zone number, if any. */
export function findZoneRow(block, number) {
  return block.rows.find((row) => row.zones.includes(number));
}
