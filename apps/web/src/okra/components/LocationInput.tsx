import { useCallback, useState } from 'react';
import L from 'leaflet';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import type { LocationData } from '../hooks/useLocationPicker';
import './LocationInput.css';

export interface LocationInputProps {
  location: LocationData;
  onTextChange: (text: string) => void;
  onCoordinatesChange: (lat: number, lng: number) => void;
  onGeocode: (text: string) => Promise<void>;
  geocodeError: string | null;
  isGeocoding: boolean;
  disabled: boolean;
  validationError?: string;
}

const DEFAULT_CENTER: [number, number] = [20, 0];
const DEFAULT_ZOOM = 2;

const LOCATION_PICKER_PIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
  <path d="M14 0C6.3 0 0 6.3 0 14c0 10.5 14 22 14 22s14-11.5 14-22C28 6.3 21.7 0 14 0z" fill="#3f7d3a"/>
  <path d="M14 8c-1.5 0-3 1.2-3 3.5 0 2.5 1.5 5 3 7 1.5-2 3-4.5 3-7C17 9.2 15.5 8 14 8z" fill="#fff" opacity="0.9"/>
  <path d="M14 12v6M12 14c1-1 3-1 4 0" stroke="#3f7d3a" stroke-width="1.2" fill="none" stroke-linecap="round"/>
</svg>`;

const locationPickerIcon = L.divIcon({
  html: LOCATION_PICKER_PIN_SVG,
  className: 'location-input__marker',
  iconSize: [28, 36],
  iconAnchor: [14, 36],
});

/** Inner component that listens for map click events. */
function MapClickHandler({
  onCoordinatesChange,
  disabled,
}: {
  onCoordinatesChange: (lat: number, lng: number) => void;
  disabled: boolean;
}) {
  useMapEvents({
    click(e) {
      if (!disabled) {
        onCoordinatesChange(e.latlng.lat, e.latlng.lng);
      }
    },
  });
  return null;
}

export function LocationInput({
  location,
  onTextChange,
  onCoordinatesChange,
  onGeocode,
  geocodeError,
  isGeocoding,
  disabled,
  validationError,
}: LocationInputProps) {
  const textInputId = 'location-text-input';
  const errorId = 'location-error';
  const hasCoordinates = location.displayLat !== null && location.displayLng !== null;
  const [showMap, setShowMap] = useState(false);
  const mapVisible = showMap || hasCoordinates;

  const handleFindOnMap = useCallback(() => {
    setShowMap(true);
    if (location.rawLocationText.trim()) {
      onGeocode(location.rawLocationText);
    }
  }, [location.rawLocationText, onGeocode]);

  const mapCenter: [number, number] = hasCoordinates
    ? [location.displayLat!, location.displayLng!]
    : DEFAULT_CENTER;

  const mapZoom = hasCoordinates ? 13 : DEFAULT_ZOOM;

  const showError = geocodeError || validationError;
  const errorMessage = geocodeError ?? validationError ?? undefined;

  return (
    <div className="location-input">
      <div className="location-input__text-group">
        <label className="location-input__label" htmlFor={textInputId}>
          Location (city, state, or address)
        </label>
        <div className="location-input__row">
          <input
            id={textInputId}
            className="location-input__text"
            type="text"
            value={location.rawLocationText}
            onChange={(e) => onTextChange(e.target.value)}
            disabled={disabled}
            aria-describedby={showError ? errorId : undefined}
            aria-invalid={showError ? true : undefined}
          />
          <button
            className="location-input__geocode-btn"
            type="button"
            onClick={handleFindOnMap}
            disabled={disabled || isGeocoding || !location.rawLocationText.trim()}
          >
            {isGeocoding ? 'Searching…' : 'Find on map'}
          </button>
        </div>
      </div>

      {showError && (
        <p id={errorId} className="location-input__error" role="alert">
          {errorMessage}
        </p>
      )}

      {mapVisible && (
        <div className="location-input__map-wrapper">
          <MapContainer
            center={mapCenter}
            zoom={mapZoom}
            scrollWheelZoom
            className="location-input__map"
            key={hasCoordinates ? `${location.displayLat},${location.displayLng}` : 'default'}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <MapClickHandler
              onCoordinatesChange={onCoordinatesChange}
              disabled={disabled}
            />
            {hasCoordinates && (
              <Marker position={[location.displayLat!, location.displayLng!]} icon={locationPickerIcon} />
            )}
          </MapContainer>
        </div>
      )}

      {!mapVisible && (
        <button
          className="location-input__show-map-btn"
          type="button"
          onClick={() => setShowMap(true)}
          disabled={disabled}
        >
          Or click to pick on map
        </button>
      )}

      {hasCoordinates && (
        <p className="location-input__coords">
          Coordinates: {location.displayLat!.toFixed(4)}, {location.displayLng!.toFixed(4)}
        </p>
      )}
    </div>
  );
}
