import { useState, useCallback } from 'react';

export interface LocationData {
  rawLocationText: string;
  displayLat: number | null;
  displayLng: number | null;
}

export interface UseLocationPickerReturn {
  location: LocationData;
  setRawText: (text: string) => void;
  setCoordinates: (lat: number, lng: number) => void;
  geocode: (text: string) => Promise<void>;
  geocodeError: string | null;
  isGeocoding: boolean;
  reset: () => void;
}

const INITIAL_LOCATION: LocationData = {
  rawLocationText: '',
  displayLat: null,
  displayLng: null,
};

function isValidLat(lat: number): boolean {
  return Number.isFinite(lat) && lat >= -90 && lat <= 90;
}

function isValidLng(lng: number): boolean {
  return Number.isFinite(lng) && lng >= -180 && lng <= 180;
}

export function useLocationPicker(): UseLocationPickerReturn {
  const [location, setLocation] = useState<LocationData>(INITIAL_LOCATION);
  const [geocodeError, setGeocodeError] = useState<string | null>(null);
  const [isGeocoding, setIsGeocoding] = useState(false);

  const setRawText = useCallback((text: string) => {
    setLocation((prev) => ({ ...prev, rawLocationText: text }));
  }, []);

  const setCoordinates = useCallback((lat: number, lng: number) => {
    setGeocodeError(null);
    setLocation((prev) => ({ ...prev, displayLat: lat, displayLng: lng }));
  }, []);

  const geocode = useCallback(async (text: string): Promise<void> => {
    setGeocodeError(null);
    setIsGeocoding(true);

    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(text)}&limit=1`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'OkraProject/1.0' },
      });

      if (!res.ok) {
        setGeocodeError('Location search unavailable. Click the map to set your location manually.');
        return;
      }

      const results = await res.json();

      if (!Array.isArray(results) || results.length === 0) {
        setGeocodeError('No location found. Try a different search or click the map to set your location.');
        return;
      }

      const { lat: latStr, lon: lonStr } = results[0];
      const lat = parseFloat(latStr);
      const lng = parseFloat(lonStr);

      if (!isValidLat(lat) || !isValidLng(lng)) {
        setGeocodeError('No location found. Try a different search or click the map to set your location.');
        return;
      }

      setLocation((prev) => ({ ...prev, displayLat: lat, displayLng: lng }));
    } catch {
      setGeocodeError('Location search unavailable. Click the map to set your location manually.');
    } finally {
      setIsGeocoding(false);
    }
  }, []);

  const reset = useCallback(() => {
    setLocation(INITIAL_LOCATION);
    setGeocodeError(null);
    setIsGeocoding(false);
  }, []);

  return {
    location,
    setRawText,
    setCoordinates,
    geocode,
    geocodeError,
    isGeocoding,
    reset,
  };
}
