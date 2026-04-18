import { useState, useEffect, useCallback, useRef } from 'react';
import L from 'leaflet';
import { MapShell } from './MapShell';
import { type StatsData } from './StatsBar';
import { PinLayer, type PinData } from './PinLayer';
import { PinPopup } from './PinPopup';
import { BottomSheet } from './BottomSheet';
import { okraMapUrl } from '../api';
import './MapView.css';

export type { PinData } from './PinLayer';
export type { StatsData } from './StatsBar';

export function computeViewportBounds(pins: PinData[]): L.LatLngBounds | null {
  if (pins.length < 3) return null;

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  for (const pin of pins) {
    if (pin.display_lat < minLat) minLat = pin.display_lat;
    if (pin.display_lat > maxLat) maxLat = pin.display_lat;
    if (pin.display_lng < minLng) minLng = pin.display_lng;
    if (pin.display_lng > maxLng) maxLng = pin.display_lng;
  }

  const latPad = (maxLat - minLat) * 0.1 || 0.5;
  const lngPad = (maxLng - minLng) * 0.1 || 0.5;

  return L.latLngBounds([minLat - latPad, minLng - lngPad], [maxLat + latPad, maxLng + lngPad]);
}

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 899px)').matches : false,
  );

  useEffect(() => {
    const mql = window.matchMedia('(max-width: 899px)');
    const handler = (event: MediaQueryListEvent) => setIsMobile(event.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return isMobile;
}

export interface MapViewProps {
  externalSelectedPin?: PinData | null;
  onPinsLoaded?: (pins: PinData[]) => void;
  onStatsLoaded?: (stats: StatsData) => void;
  onPinSelected?: (pin: PinData | null) => void;
  onOpenSubmission?: () => void;
}

export function MapView({
  externalSelectedPin,
  onPinsLoaded,
  onStatsLoaded,
  onPinSelected,
  onOpenSubmission,
}: MapViewProps) {
  const [pins, setPins] = useState<PinData[] | null>(null);
  const [pinError, setPinError] = useState<Error | null>(null);
  const [pinsLoading, setPinsLoading] = useState(true);
  const [selectedPin, setSelectedPin] = useState<PinData | null>(null);

  const mapRef = useRef<L.Map | null>(null);
  const isMobile = useIsMobile();

  const fetchData = useCallback(async () => {
    setPinsLoading(true);
    setPinError(null);
    setSelectedPin(null);

    const pinPromise = fetch(okraMapUrl())
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load pins: ${res.status}`);
        const body = await res.json();
        return Array.isArray(body?.data) ? (body.data as PinData[]) : [];
      })
      .then((data) => {
        setPins(data);
        setPinsLoading(false);
        onPinsLoaded?.(data);
      })
      .catch((err: Error) => {
        setPinError(err);
        setPinsLoading(false);
      });

    const statsPromise = fetch(okraMapUrl('/stats'))
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load stats: ${res.status}`);
        return (await res.json()) as StatsData;
      })
      .then((data) => {
        onStatsLoaded?.(data);
      })
      .catch(() => {
        /* stats error is non-fatal */
      });

    await Promise.allSettled([pinPromise, statsPromise]);
  }, [onPinsLoaded, onStatsLoaded]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (!pins || pins.length === 0) {
          map.setView([position.coords.latitude, position.coords.longitude], 6, { animate: true });
        }
      },
      () => {},
      { timeout: 5000, maximumAge: 300000 },
    );
  }, [pins]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !pins || pins.length === 0) return;

    const bounds = computeViewportBounds(pins);
    if (bounds) {
      map.flyToBounds(bounds, { duration: 0.4, padding: [30, 30] });
      window.requestAnimationFrame(() => map.invalidateSize());
    }
  }, [pins]);

  useEffect(() => {
    if (!externalSelectedPin) return;

    setSelectedPin(externalSelectedPin);

    const map = mapRef.current;
    if (map) {
      map.flyTo([externalSelectedPin.display_lat, externalSelectedPin.display_lng], 10, { duration: 0.5 });
    }
  }, [externalSelectedPin]);

  const handlePinClick = useCallback(
    (pin: PinData) => {
      setSelectedPin(pin);
      onPinSelected?.(pin);
    },
    [onPinSelected],
  );

  const handleClosePopup = useCallback(() => {
    setSelectedPin(null);
    onPinSelected?.(null);
  }, [onPinSelected]);

  const showError = pinError !== null && !pinsLoading;
  const showEmpty = !pinsLoading && !pinError && pins !== null && pins.length === 0;
  const showLoading = pinsLoading && !pinError;
  const showPins = !pinsLoading && !pinError && pins !== null && pins.length > 0;

  return (
    <div className="map-view">
      <a href="#after-map" className="map-view__skip-link">
        Skip map
      </a>

      <div className="map-view__container">
        <MapShell ref={mapRef}>
          {showPins ? (
            <PinLayer pins={pins ?? []} activePinId={selectedPin?.id ?? null} onPinClick={handlePinClick} />
          ) : null}
        </MapShell>

        {selectedPin && !isMobile ? <PinPopup pin={selectedPin} onClose={handleClosePopup} /> : null}

        {showLoading ? (
          <div className="map-view__loading" aria-live="polite">
            <div className="map-view__loading-pulse" />
            <span className="map-view__loading-text">Loading gardens...</span>
          </div>
        ) : null}

        {showError ? (
          <div className="map-view__error" role="alert">
            <p className="map-view__error-message">Something went wrong loading the map.</p>
            <button className="map-view__retry-btn" onClick={fetchData}>
              Try again
            </button>
          </div>
        ) : null}

        {showEmpty ? (
          <div className="map-view__empty" role="status">
            <p className="map-view__empty-message">No gardens yet - be the first to share yours</p>
            <button type="button" className="map-view__cta-link" onClick={onOpenSubmission}>
              Share your garden
            </button>
          </div>
        ) : null}
      </div>

      {selectedPin && isMobile ? <BottomSheet pin={selectedPin} onClose={handleClosePopup} /> : null}

      <div id="after-map" />
    </div>
  );
}
