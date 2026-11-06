// Spring outdoor planting windows for Clemson Spineless okra, keyed by USDA
// hardiness zone. Approximate only: zone describes winter cold, not local frost
// dates or soil temperature (okra wants soil of 70F+, 2-3 weeks after last frost).
const WARM_WEATHER = 'any time the weather is warm';
const OKRA_WINDOWS_BY_ZONE = new Map([
  [3, 'late May to mid June'],
  [4, 'late May to mid June'],
  [5, 'mid May to mid June'],
  [6, 'early May to early June'],
  [7, 'mid April to late May'],
  [8, 'early April to early June'],
  [9, 'March to May'],
  [10, 'February to April'],
  [11, WARM_WEATHER],
  [12, WARM_WEATHER],
  [13, WARM_WEATHER]
]);

export function okraPlantingWindow(zone) {
  const match = String(zone ?? '').trim().match(/^(\d{1,2})[ab]?$/i);
  if (!match) return null;
  return OKRA_WINDOWS_BY_ZONE.get(Number(match[1])) ?? null;
}

function usZipFromAddress(address) {
  if (!address || address.country !== 'US') return null;
  const match = /^(\d{5})(?:-\d{4})?$/.exec(String(address.postalCode ?? '').trim());
  return match ? match[1] : null;
}

/**
 * Look up the USDA hardiness zone for a US shipping address via phzmapi.org
 * (public 2023 USDA map). Returns null for non-US addresses or any failure so
 * a flaky lookup never blocks the Slack notification.
 */
export async function lookupHardinessZone(address, { timeoutMs = 3000 } = {}) {
  const zip = usZipFromAddress(address);
  if (!zip) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`https://phzmapi.org/${zip}.json`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });
    if (!response.ok) return null;
    const data = await response.json();
    return typeof data?.zone === 'string' && data.zone.trim() ? data.zone.trim() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
