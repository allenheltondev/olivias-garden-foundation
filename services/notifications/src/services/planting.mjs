// Planting guidance for Clemson Spineless okra, keyed by USDA hardiness zone.
// Windows are for direct sowing once soil is reliably warm (65F+) and frost has
// passed. They are broad starting points; zone describes winter cold, not exact
// local frost dates.
const OKRA_WINDOWS_BY_ZONE = new Map([
  [3, 'start indoors in late April, transplant in early June'],
  [4, 'start indoors in late April, transplant in early June'],
  [5, 'late May to mid June'],
  [6, 'mid May to late June'],
  [7, 'mid May to late June'],
  [8, 'late April to early July'],
  [9, 'mid April to late June'],
  [10, 'early March to early June'],
  [11, 'early March to early June'],
  [12, 'early March to early June'],
  [13, 'early March to early June']
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
