import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLocationPicker } from '../useLocationPicker';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useLocationPicker', () => {
  it('initializes with empty state', () => {
    const { result } = renderHook(() => useLocationPicker());
    expect(result.current.location).toEqual({
      rawLocationText: '',
      displayLat: null,
      displayLng: null,
    });
    expect(result.current.geocodeError).toBeNull();
    expect(result.current.isGeocoding).toBe(false);
  });

  it('setRawText updates rawLocationText', () => {
    const { result } = renderHook(() => useLocationPicker());
    act(() => result.current.setRawText('Austin, TX'));
    expect(result.current.location.rawLocationText).toBe('Austin, TX');
  });

  it('setCoordinates sets lat/lng directly', () => {
    const { result } = renderHook(() => useLocationPicker());
    act(() => result.current.setCoordinates(30.2672, -97.7431));
    expect(result.current.location.displayLat).toBe(30.2672);
    expect(result.current.location.displayLng).toBe(-97.7431);
  });

  describe('geocode', () => {
    it('fetches from Nominatim and sets coordinates on success', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify([{ lat: '30.2672', lon: '-97.7431', display_name: 'Austin, TX' }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const { result } = renderHook(() => useLocationPicker());
      await act(async () => {
        await result.current.geocode('Austin, TX');
      });

      expect(fetch).toHaveBeenCalledWith(
        'https://nominatim.openstreetmap.org/search?format=json&q=Austin%2C%20TX&limit=1',
        { headers: { 'User-Agent': 'OkraProject/1.0' } },
      );
      expect(result.current.location.displayLat).toBe(30.2672);
      expect(result.current.location.displayLng).toBe(-97.7431);
      expect(result.current.geocodeError).toBeNull();
      expect(result.current.isGeocoding).toBe(false);
    });

    it('sets error when Nominatim returns empty results', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify([]), { status: 200 }),
      );

      const { result } = renderHook(() => useLocationPicker());
      await act(async () => {
        await result.current.geocode('xyznonexistent');
      });

      expect(result.current.geocodeError).toBe(
        'No location found. Try a different search or click the map to set your location.',
      );
      expect(result.current.location.displayLat).toBeNull();
    });

    it('sets error on network failure', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error('Failed to fetch'));

      const { result } = renderHook(() => useLocationPicker());
      await act(async () => {
        await result.current.geocode('Austin');
      });

      expect(result.current.geocodeError).toBe(
        'Location search unavailable. Click the map to set your location manually.',
      );
      expect(result.current.isGeocoding).toBe(false);
    });

    it('sets error on non-ok HTTP response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response('Server Error', { status: 500 }),
      );

      const { result } = renderHook(() => useLocationPicker());
      await act(async () => {
        await result.current.geocode('Austin');
      });

      expect(result.current.geocodeError).toBe(
        'Location search unavailable. Click the map to set your location manually.',
      );
    });

    it('rejects out-of-range geocoded latitude', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify([{ lat: '91.0', lon: '10.0' }]), { status: 200 }),
      );

      const { result } = renderHook(() => useLocationPicker());
      await act(async () => {
        await result.current.geocode('bad place');
      });

      expect(result.current.geocodeError).toBe(
        'No location found. Try a different search or click the map to set your location.',
      );
      expect(result.current.location.displayLat).toBeNull();
    });

    it('rejects out-of-range geocoded longitude', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify([{ lat: '45.0', lon: '-181.0' }]), { status: 200 }),
      );

      const { result } = renderHook(() => useLocationPicker());
      await act(async () => {
        await result.current.geocode('bad place');
      });

      expect(result.current.geocodeError).toBe(
        'No location found. Try a different search or click the map to set your location.',
      );
      expect(result.current.location.displayLat).toBeNull();
    });

    it('accepts boundary values (lat=90, lng=180)', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify([{ lat: '90', lon: '180' }]), { status: 200 }),
      );

      const { result } = renderHook(() => useLocationPicker());
      await act(async () => {
        await result.current.geocode('north pole');
      });

      expect(result.current.location.displayLat).toBe(90);
      expect(result.current.location.displayLng).toBe(180);
      expect(result.current.geocodeError).toBeNull();
    });

    it('accepts boundary values (lat=-90, lng=-180)', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify([{ lat: '-90', lon: '-180' }]), { status: 200 }),
      );

      const { result } = renderHook(() => useLocationPicker());
      await act(async () => {
        await result.current.geocode('south pole');
      });

      expect(result.current.location.displayLat).toBe(-90);
      expect(result.current.location.displayLng).toBe(-180);
      expect(result.current.geocodeError).toBeNull();
    });

    it('rejects NaN coordinates from geocoding', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify([{ lat: 'not-a-number', lon: 'also-nan' }]), { status: 200 }),
      );

      const { result } = renderHook(() => useLocationPicker());
      await act(async () => {
        await result.current.geocode('bad data');
      });

      expect(result.current.geocodeError).toBe(
        'No location found. Try a different search or click the map to set your location.',
      );
      expect(result.current.location.displayLat).toBeNull();
    });

    it('setCoordinates clears geocodeError', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error('network'));

      const { result } = renderHook(() => useLocationPicker());
      await act(async () => {
        await result.current.geocode('nowhere');
      });

      expect(result.current.geocodeError).not.toBeNull();

      act(() => result.current.setCoordinates(40, -74));
      expect(result.current.geocodeError).toBeNull();
    });
  });
});
