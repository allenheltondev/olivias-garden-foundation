import { createHash } from 'crypto';

const RADIUS_BY_MODE = {
  nearby: 0.005,
  neighborhood: 0.02,
  city: 0.05,
};

/**
 * Compute fuzzed coordinates from a SHA-256 hash buffer.
 * Extracts two 32-bit unsigned integers from the first 8 bytes,
 * derives an angle and distance, and returns the offset lat/lng.
 */
function computeFromHash(hash, displayLat, displayLng, maxRadius) {
  const int1 = hash.readUInt32BE(0);
  const int2 = hash.readUInt32BE(4);

  const angle = (int1 / 0xFFFFFFFF) * 2 * Math.PI;
  const distance = (int2 / 0xFFFFFFFF) * maxRadius;

  const latOffset = distance * Math.cos(angle);
  const lngOffset = distance * Math.sin(angle);

  return {
    lat: displayLat + latOffset,
    lng: displayLng + lngOffset,
  };
}

/**
 * Apply deterministic privacy fuzzing to coordinates based on privacy_mode.
 * Returns { lat, lng } with the fuzzed values.
 * For 'exact' mode, returns the original coordinates unchanged.
 *
 * @param {string} submissionId - The submission UUID
 * @param {number} displayLat - Original latitude
 * @param {number} displayLng - Original longitude
 * @param {string} privacyMode - One of 'exact', 'nearby', 'neighborhood', 'city'
 * @returns {{ lat: number, lng: number }}
 */
export function fuzzCoordinates(submissionId, displayLat, displayLng, privacyMode) {
  if (privacyMode === 'exact') {
    return { lat: displayLat, lng: displayLng };
  }

  const maxRadius = RADIUS_BY_MODE[privacyMode];

  // First attempt: hash the raw id
  let seed = String(submissionId);
  let counter = 0;

  while (true) {
    const hash = createHash('sha256').update(seed).digest();
    const result = computeFromHash(hash, displayLat, displayLng, maxRadius);

    if (result.lat !== 0 || result.lng !== 0) {
      return result;
    }

    // Re-derive with incremented counter to avoid null-island
    counter++;
    seed = String(submissionId) + String(counter);
  }
}
