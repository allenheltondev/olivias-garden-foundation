import { forwardRef, useEffect, type ReactNode } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import type { Map as LeafletMap } from 'leaflet';
import './MapShell.css';

export interface MapShellProps {
  children?: ReactNode;
}

/** Applies the desaturation CSS filter to the Leaflet tile pane after mount. */
function TileDesaturator() {
  const map = useMap();

  useEffect(() => {
    const pane = map.getPane('tilePane');
    if (pane) {
      pane.style.filter = 'saturate(0.3) brightness(1.05)';
    }
  }, [map]);

  return null;
}

/**
 * MapShell — the outer Leaflet MapContainer wrapper.
 * Renders immediately with background, controls, attribution, and desaturated tiles.
 * Accepts children (PinLayer, etc.) and forwards a ref to the Leaflet Map instance.
 */
export const MapShell = forwardRef<LeafletMap, MapShellProps>(
  function MapShell({ children }, ref) {
    return (
      <MapContainer
        center={[20, 0]}
        zoom={2}
        scrollWheelZoom
        className="map-shell"
        ref={ref}
        aria-label="Interactive map showing okra gardens around the world"
        style={{
          minHeight: '500px',
          width: '100%',
          background: 'var(--color-background)',
        }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <TileDesaturator />
        {children}
      </MapContainer>
    );
  }
);
