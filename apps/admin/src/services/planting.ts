import type { SeedRequestAddress } from '../api';

/**
 * Hardiness zone and okra planting window for a mailed seed request, shown to
 * admins the same way the Slack "new seed request" message shows them.
 *
 * Keep OKRA_WINDOWS_BY_ZONE in step with services/notifications/src/services/planting.mjs.
 *
 * Privacy: only a US 5-digit zip is sent to phzmapi.org (never names, emails or
 * street lines), and only for mailed requests.
 */

const WARM_WEATHER = 'any time the weather is warm';

// Spring outdoor planting windows for Clemson Spineless okra, by USDA zone.
// Approximate only: zone describes winter cold, not local frost dates.
const OKRA_WINDOWS_BY_ZONE = new Map<number, string>([
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
  [13, WARM_WEATHER],
]);

export function okraPlantingWindow(zone: string | null | undefined): string | null {
  const match = String(zone ?? '').trim().match(/^(\d{1,2})[ab]?$/i);
  if (!match) return null;
  return OKRA_WINDOWS_BY_ZONE.get(Number(match[1])) ?? null;
}

/** The 5-digit zip of a US shipping address, or null (non-US, missing, malformed). */
export function usZipFromAddress(address: SeedRequestAddress | null | undefined): string | null {
  if (!address || address.country !== 'US') return null;
  const match = /^(\d{5})(?:-\d{4})?$/.exec(String(address.postalCode ?? '').trim());
  return match ? match[1] : null;
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

// Zones don't change, so remember each zip for the life of the page. Failed
// lookups aren't cached, so a Refresh can retry them.
const zoneCache = new Map<string, Promise<string | null>>();

/**
 * USDA hardiness zone for a US zip via phzmapi.org (public 2023 USDA map).
 * Resolves null on any failure; a flaky lookup should never break the list.
 */
export function lookupHardinessZone(
  zip: string,
  fetcher: Fetcher = (input, init) => fetch(input, init),
  timeoutMs = 5000,
): Promise<string | null> {
  const cached = zoneCache.get(zip);
  if (cached) return cached;

  const lookup = (async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(`https://phzmapi.org/${zip}.json`, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const data = (await response.json()) as { zone?: unknown };
      return typeof data?.zone === 'string' && data.zone.trim() ? data.zone.trim() : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  })();

  zoneCache.set(zip, lookup);
  void lookup.then((zone) => {
    if (zone === null) zoneCache.delete(zip);
  });
  return lookup;
}

/** Test hook. */
export function clearHardinessZoneCache(): void {
  zoneCache.clear();
}
