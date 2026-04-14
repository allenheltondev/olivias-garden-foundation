import { useState, useEffect, useCallback, useRef } from 'react';
import L from 'leaflet';
import { MapShell } from './MapShell';
import { type StatsData } from './StatsBar';
import { PinLayer, type PinData } from './PinLayer';
import { PinPopup } from './PinPopup';
import { BottomSheet } from './BottomSheet';
import './MapView.css';

export type { PinData } from './PinLayer';
export type { StatsData } from './StatsBar';

export function computeViewportBounds(pins: PinData[]): L.LatLngBounds | null {
  if (pins.length < 3) return null;
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
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
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);
  return isMobile;
}

const API_BASE = '/okra';

export interface MapViewProps {
  /** Externally selected pin (e.g. from sidebar click) */
  externalSelectedPin?: PinData | null;
  /** Called when pins are loaded so parent can use them */
  onPinsLoaded?: (pins: PinData[]) => void;
  /** Called when stats are loaded */
  onStatsLoaded?: (stats: StatsData) => void;
  /** Called when a pin is selected (from map click or external) */
  onPinSelected?: (pin: PinData | null) => void;
  /** Called when the user clicks the "Share your garden" CTA in the empty state */
  onOpenSubmission?: () => void;
}

export function MapView({ externalSelectedPin, onPinsLoaded, onStatsLoaded, onPinSelected, onOpenSubmission }: MapViewProps) {
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

    const pinPromise = fetch(API_BASE)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load pins: ${res.status}`);
        return (await res.json()).data as PinData[];
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

    const statsPromise = fetch(`${API_BASE}/stats`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load stats: ${res.status}`);
        return (await res.json()) as StatsData;
      })
      .then((data) => { onStatsLoaded?.(data); })
      .catch(() => { /* stats error is non-fatal */ });

    await Promise.allSettled([pinPromise, statsPromise]);
  }, [onPinsLoaded, onStatsLoaded]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Geolocation centering before pins load
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!pins || pins.length === 0) {
          map.setView([pos.coords.latitude, pos.coords.longitude], 6, { animate: true });
        }
      },
      () => {},
      { timeout: 5000, maximumAge: 300000 }
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fly-to-bounds when pins arrive
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !pins || pins.length === 0) return;
    const bounds = computeViewportBounds(pins);
    if (bounds) map.flyToBounds(bounds, { duration: 0.4, padding: [30, 30] });
  }, [pins]);

  // Handle external pin selection (from sidebar)
  useEffect(() => {
    if (externalSelectedPin) {
      setSelectedPin(externalSelectedPin);
      const map = mapRef.current;
      if (map) {
        map.flyTo([externalSelectedPin.display_lat, externalSelectedPin.display_lng], 10, { duration: 0.5 });
      }
    }
  }, [externalSelectedPin]);

  const handlePinClick = useCallback((pin: PinData) => {
    setSelectedPin(pin);
    onPinSelected?.(pin);
  }, [onPinSelected]);

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
      <a href="#after-map" className="map-view__skip-link">Skip map</a>

      <div className="map-view__container">
        <MapShell ref={mapRef}>
          {showPins && (
            <PinLayer pins={pins!} activePinId={selectedPin?.id ?? null} onPinClick={handlePinClick} />
          )}
        </MapShell>

        {selectedPin && !isMobile && (
          <PinPopup pin={selectedPin} onClose={handleClosePopup} />
        )}

        {showLoading && (
          <div className="map-view__loading" aria-live="polite">
            <div className="map-view__loading-pulse" />
            <span className="map-view__loading-text">Loading gardens…</span>
          </div>
        )}

        {showError && (
          <div className="map-view__error" role="alert">
            <p className="map-view__error-message">Something went wrong loading the map.</p>
            <button className="map-view__retry-btn" onClick={fetchData}>Try again</button>
          </div>
        )}

        {showEmpty && (
          <div className="map-view__empty" role="status">
            <p className="map-view__empty-message">No gardens yet — be the first to share yours</p>
            <button type="button" className="map-view__cta-link" onClick={onOpenSubmission}>Share your garden</button>
          </div>
        )}
      </div>

      {selectedPin && isMobile && (
        <BottomSheet pin={selectedPin} onClose={handleClosePopup} />
      )}

      <div id="after-map" />
    </div>
  );
}
