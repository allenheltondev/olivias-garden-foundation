import whichPolygon from 'which-polygon';
import { feature } from 'topojson-client';
import topology from 'world-atlas/countries-110m.json';

let query = null;

try {
  const geojson = feature(topology, topology.objects.countries);
  query = whichPolygon(geojson);
} catch (err) {
  console.error('Failed to load country boundaries GeoJSON dataset:', err.message);
}

/**
 * Resolve lat/lng to a country name using offline point-in-polygon lookup.
 * @param {number} lat
 * @param {number} lng
 * @returns {string | null} Country name, or null if coordinates fall outside all boundaries
 */
export function resolveCountry(lat, lng) {
  if (!query) {
    return null;
  }

  const result = query([lng, lat]);
  return result?.name ?? null;
}
