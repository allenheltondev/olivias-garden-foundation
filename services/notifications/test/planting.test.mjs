import { afterEach, describe, expect, it, vi } from 'vitest';
import { lookupHardinessZone, okraPlantingWindow } from '../src/services/planting.mjs';

describe('okraPlantingWindow', () => {
  it('maps zones, with or without a subzone letter', () => {
    expect(okraPlantingWindow('7b')).toBe('early May to early June');
    expect(okraPlantingWindow('10a')).toBe('February to April');
    expect(okraPlantingWindow('4')).toBe('late May to mid June');
  });

  it('returns null for unknown or missing zones', () => {
    expect(okraPlantingWindow(null)).toBeNull();
    expect(okraPlantingWindow('abc')).toBeNull();
    expect(okraPlantingWindow('1a')).toBeNull();
    expect(okraPlantingWindow('12b')).toBe('any time the weather is warm');
  });
});

describe('lookupHardinessZone', () => {
  afterEach(() => vi.unstubAllGlobals());

  const usAddress = { postalCode: '73301-1234', country: 'US' };

  it('fetches the zone for a US zip', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ zone: '9a' }) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(lookupHardinessZone(usAddress)).resolves.toBe('9a');
    expect(fetchMock.mock.calls[0][0]).toBe('https://phzmapi.org/73301.json');
  });

  it('skips non-US addresses without calling the API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(lookupHardinessZone({ postalCode: 'M5V 2T6', country: 'CA' })).resolves.toBeNull();
    await expect(lookupHardinessZone(undefined)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null on HTTP errors and network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    await expect(lookupHardinessZone(usAddress)).resolves.toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
    await expect(lookupHardinessZone(usAddress)).resolves.toBeNull();
  });
});
