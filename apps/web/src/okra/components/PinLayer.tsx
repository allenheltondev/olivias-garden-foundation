import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet.markercluster';
import './PinLayer.css';

export interface PinData {
  id: string;
  /**
   * `garden` pins come from approved okra submissions. `seeds` pins mark
   * places we've mailed seeds to — first name and city/region only.
   * Missing means `garden` for backward compatibility.
   */
  kind?: 'garden' | 'seeds';
  display_lat: number;
  display_lng: number;
  contributor_name: string | null;
  story_text: string | null;
  country: string | null;
  photo_urls: string[];
  edited?: boolean;
  edited_at?: string | null;
  /** Seed pins only: "City, Region" */
  locality?: string | null;
  /** Seed pins only: YYYY-MM */
  sent_month?: string | null;
}

export function isSeedPin(pin: PinData): boolean {
  return pin.kind === 'seeds';
}

export interface PinLayerProps {
  pins: PinData[];
  activePinId: string | null;
  onPinClick: (pin: PinData) => void;
}

/** SVG leaf/sprout icon in Primary Green */
const PIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
  <path d="M14 0C6.3 0 0 6.3 0 14c0 10.5 14 22 14 22s14-11.5 14-22C28 6.3 21.7 0 14 0z" fill="#3f7d3a"/>
  <path d="M14 8c-1.5 0-3 1.2-3 3.5 0 2.5 1.5 5 3 7 1.5-2 3-4.5 3-7C17 9.2 15.5 8 14 8z" fill="#fff" opacity="0.9"/>
  <path d="M14 12v6M12 14c1-1 3-1 4 0" stroke="#3f7d3a" stroke-width="1.2" fill="none" stroke-linecap="round"/>
</svg>`;

const ACTIVE_PIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
  <path d="M14 0C6.3 0 0 6.3 0 14c0 10.5 14 22 14 22s14-11.5 14-22C28 6.3 21.7 0 14 0z" fill="#d8a741"/>
  <path d="M14 8c-1.5 0-3 1.2-3 3.5 0 2.5 1.5 5 3 7 1.5-2 3-4.5 3-7C17 9.2 15.5 8 14 8z" fill="#fff" opacity="0.9"/>
  <path d="M14 12v6M12 14c1-1 3-1 4 0" stroke="#d8a741" stroke-width="1.2" fill="none" stroke-linecap="round"/>
</svg>`;

/** Seed-packet marker in soil brown so "seeds sent" reads differently from a growing garden */
const SEED_PIN_SVG = (fill: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
  <path d="M14 0C6.3 0 0 6.3 0 14c0 10.5 14 22 14 22s14-11.5 14-22C28 6.3 21.7 0 14 0z" fill="${fill}"/>
  <rect x="8" y="7" width="12" height="14" rx="1.5" fill="#fff" opacity="0.92"/>
  <path d="M8 10.5h12" stroke="${fill}" stroke-width="1.2"/>
  <ellipse cx="12" cy="15" rx="1.2" ry="1.8" fill="${fill}"/>
  <ellipse cx="16" cy="16.5" rx="1.2" ry="1.8" fill="${fill}"/>
</svg>`;

const seedIcon = L.divIcon({
  html: SEED_PIN_SVG('#8a5a2b'),
  className: 'pin-icon pin-icon--seeds',
  iconSize: [28, 36],
  iconAnchor: [14, 36],
  popupAnchor: [0, -36],
});

const activeSeedIcon = L.divIcon({
  html: SEED_PIN_SVG('#d8a741'),
  className: 'pin-icon pin-icon--seeds pin-icon--active',
  iconSize: [34, 44],
  iconAnchor: [17, 44],
  popupAnchor: [0, -44],
});

function iconFor(pin: PinData, active: boolean): L.DivIcon {
  if (isSeedPin(pin)) return active ? activeSeedIcon : seedIcon;
  return active ? activeIcon : defaultIcon;
}

const defaultIcon = L.divIcon({
  html: PIN_SVG,
  className: 'pin-icon',
  iconSize: [28, 36],
  iconAnchor: [14, 36],
  popupAnchor: [0, -36],
});

const activeIcon = L.divIcon({
  html: ACTIVE_PIN_SVG,
  className: 'pin-icon pin-icon--active',
  iconSize: [34, 44],
  iconAnchor: [17, 44],
  popupAnchor: [0, -44],
});

/**
 * Pure function: returns clustering configuration based on pin count.
 * Exported for property-based testing.
 */
export function getClusteringConfig(pinCount: number): {
  enabled: boolean;
  disableClusteringAtZoom: number | null;
  maxClusterRadius: number;
  maxZoom: number | null;
} {
  if (pinCount <= 0) {
    return { enabled: false, disableClusteringAtZoom: null, maxClusterRadius: 0, maxZoom: null };
  }
  if (pinCount < 10) {
    return { enabled: false, disableClusteringAtZoom: null, maxClusterRadius: 0, maxZoom: 8 };
  }
  if (pinCount <= 500) {
    return { enabled: true, disableClusteringAtZoom: 10, maxClusterRadius: 60, maxZoom: null };
  }
  if (pinCount <= 2000) {
    return { enabled: true, disableClusteringAtZoom: 13, maxClusterRadius: 80, maxZoom: null };
  }
  return { enabled: true, disableClusteringAtZoom: 15, maxClusterRadius: 100, maxZoom: null };
}

/**
 * Pure function: returns cluster badge size category based on count.
 * Exported for property-based testing.
 */
export function getClusterSizeCategory(count: number): 'small' | 'medium' | 'large' {
  if (count <= 5) return 'small';
  if (count <= 20) return 'medium';
  return 'large';
}

/** Creates a cluster icon with Accent Gold badge, sized by count. */
function createClusterIcon(cluster: L.MarkerCluster): L.DivIcon {
  const count = cluster.getChildCount();
  const size = getClusterSizeCategory(count);
  const sizeMap = { small: 36, medium: 48, large: 60 };
  const px = sizeMap[size];

  return L.divIcon({
    html: `<span class="cluster-badge cluster-badge--${size}">${count}</span>`,
    className: 'cluster-icon',
    iconSize: L.point(px, px),
  });
}

/**
 * PinLayer — manages Leaflet markers and MarkerClusterGroup.
 * Must be rendered inside a react-leaflet MapContainer.
 */
export function PinLayer({ pins, activePinId, onPinClick }: PinLayerProps) {
  const map = useMap();
  const clusterGroupRef = useRef<L.MarkerClusterGroup | null>(null);
  const markersRef = useRef<Map<string, { marker: L.Marker; pin: PinData }>>(new Map());

  // Build / rebuild markers when pins change
  useEffect(() => {
    // Clean up previous cluster group
    if (clusterGroupRef.current) {
      map.removeLayer(clusterGroupRef.current);
      clusterGroupRef.current = null;
    }
    markersRef.current.clear();

    if (pins.length === 0) return;

    const config = getClusteringConfig(pins.length);

    const markers: L.Marker[] = [];
    for (const pin of pins) {
      const marker = L.marker([pin.display_lat, pin.display_lng], {
        icon: iconFor(pin, pin.id === activePinId),
        title: isSeedPin(pin) ? 'Seeds sent here' : 'Okra garden',
        alt: isSeedPin(pin) ? 'Seeds sent here' : 'Okra garden',
      });
      marker.on('click', () => onPinClick(pin));
      markersRef.current.set(pin.id, { marker, pin });
      markers.push(marker);
    }

    if (config.enabled) {
      const group = L.markerClusterGroup({
        disableClusteringAtZoom: config.disableClusteringAtZoom ?? undefined,
        maxClusterRadius: config.maxClusterRadius,
        iconCreateFunction: createClusterIcon,
        animate: true,
        animateAddingMarkers: false,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
      });
      group.addLayers(markers);
      map.addLayer(group);
      clusterGroupRef.current = group;
    } else {
      // No clustering — add markers directly, enforce maxZoom if set
      const group = L.layerGroup(markers);
      map.addLayer(group);
      clusterGroupRef.current = group as unknown as L.MarkerClusterGroup;

      if (config.maxZoom !== null) {
        map.setMaxZoom(config.maxZoom);
      }
    }

    const currentMarkers = markersRef.current;
    return () => {
      if (clusterGroupRef.current) {
        map.removeLayer(clusterGroupRef.current);
        clusterGroupRef.current = null;
      }
      currentMarkers.clear();
    };
  }, [pins, activePinId, map, onPinClick]);

  // Update active pin icon when activePinId changes
  useEffect(() => {
    for (const [id, { marker, pin }] of markersRef.current) {
      marker.setIcon(iconFor(pin, id === activePinId));
    }
  }, [activePinId, pins]);

  return null;
}
