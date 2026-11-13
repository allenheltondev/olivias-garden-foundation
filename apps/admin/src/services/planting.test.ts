import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearHardinessZoneCache,
  lookupHardinessZone,
  okraPlantingWindow,
  usZipFromAddress,
} from './planting';

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: () => Promise.resolve(body) } as Response;
}

beforeEach(clearHardinessZoneCache);

describe('okraPlantingWindow', () => {
  it('maps zones, with or without the a/b half', () => {
    expect(okraPlantingWindow('7b')).toBe('mid April to late May');
    expect(okraPlantingWindow('9')).toBe('March to May');
    expect(okraPlantingWindow('11a')).toBe('any time the weather is warm');
  });

  it('returns null for unknown or malformed zones', () => {
    expect(okraPlantingWindow('2a')).toBeNull();
    expect(okraPlantingWindow('')).toBeNull();
    expect(okraPlantingWindow(null)).toBeNull();
    expect(okraPlantingWindow('warm')).toBeNull();
  });
});

describe('usZipFromAddress', () => {
  it('accepts US 5-digit and ZIP+4 postal codes', () => {
    expect(usZipFromAddress({ country: 'US', postalCode: '73301' })).toBe('73301');
    expect(usZipFromAddress({ country: 'US', postalCode: ' 73301-1234 ' })).toBe('73301');
  });

  it('rejects non-US, missing and malformed postal codes', () => {
    expect(usZipFromAddress({ country: 'CA', postalCode: '73301' })).toBeNull();
    expect(usZipFromAddress({ country: 'US', postalCode: 'K1A 0B1' })).toBeNull();
    expect(usZipFromAddress({ country: 'US' })).toBeNull();
    expect(usZipFromAddress(null)).toBeNull();
  });
});

describe('lookupHardinessZone', () => {
  it('sends only the zip and returns the trimmed zone', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ zone: ' 8b ' }));
    await expect(lookupHardinessZone('73301', fetcher)).resolves.toBe('8b');
    expect(fetcher.mock.calls[0][0]).toBe('https://phzmapi.org/73301.json');
  });

  it('caches successful lookups per zip', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ zone: '8b' }));
    await lookupHardinessZone('73301', fetcher);
    await lookupHardinessZone('73301', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('returns null on failures and lets a later call retry', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce(jsonResponse({ zone: '8b' }));
    await expect(lookupHardinessZone('73301', fetcher)).resolves.toBeNull();
    await expect(lookupHardinessZone('73301', fetcher)).resolves.toBe('8b');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('returns null for non-OK responses and missing zones', async () => {
    await expect(lookupHardinessZone('11111', vi.fn().mockResolvedValue(jsonResponse({}, false)))).resolves.toBeNull();
    await expect(lookupHardinessZone('22222', vi.fn().mockResolvedValue(jsonResponse({})))).resolves.toBeNull();
  });
});
