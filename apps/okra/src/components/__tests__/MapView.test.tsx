import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// Mock leaflet before any component imports
vi.mock('leaflet', () => {
  const latLngBounds = vi.fn(() => ({
    extend: vi.fn(),
    isValid: () => true,
    getSouthWest: () => ({ lat: -10, lng: -10 }),
    getNorthEast: () => ({ lat: 10, lng: 10 }),
  }));
  return {
    default: {
      latLngBounds,
      marker: vi.fn(() => ({
        addTo: vi.fn(),
        remove: vi.fn(),
        on: vi.fn(),
        setIcon: vi.fn(),
        getLatLng: vi.fn(() => ({ lat: 0, lng: 0 })),
      })),
      markerClusterGroup: vi.fn(() => ({
        addLayer: vi.fn(),
        addLayers: vi.fn(),
        removeLayer: vi.fn(),
        clearLayers: vi.fn(),
        addTo: vi.fn(),
        remove: vi.fn(),
        on: vi.fn(),
      })),
      divIcon: vi.fn(() => ({})),
      layerGroup: vi.fn(() => ({
        addTo: vi.fn(),
        remove: vi.fn(),
        addLayer: vi.fn(),
        clearLayers: vi.fn(),
      })),
      point: vi.fn((x: number, y: number) => ({ x, y })),
      icon: vi.fn(() => ({})),
    },
    latLngBounds,
    marker: vi.fn(),
    markerClusterGroup: vi.fn(),
    divIcon: vi.fn(),
    layerGroup: vi.fn(),
    point: vi.fn(),
    icon: vi.fn(),
  };
});

// Mock leaflet.markercluster
vi.mock('leaflet.markercluster', () => ({}));

// Mock react-leaflet
vi.mock('react-leaflet', () => ({
  MapContainer: ({
    children,
    'aria-label': ariaLabel,
    className,
    style,
  }: {
    children?: React.ReactNode;
    'aria-label'?: string;
    className?: string;
    style?: React.CSSProperties;
  }) => (
    <div data-testid="map-container" aria-label={ariaLabel} className={className} style={style}>
      {children}
    </div>
  ),
  TileLayer: () => null,
  useMap: vi.fn(() => ({
    flyToBounds: vi.fn(),
    getPane: vi.fn(() => ({ style: {} })),
    fitBounds: vi.fn(),
    setView: vi.fn(),
    getZoom: vi.fn(() => 2),
  })),
  Popup: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="popup">{children}</div>
  ),
}));

import { MapView } from '../MapView';

// Helper to create mock fetch responses
function mockFetchResponses(options: {
  okraData?: { total_count: number; data: unknown[] };
  okraError?: boolean;
  statsData?: { total_pins: number; country_count: number; contributor_count: number };
  statsError?: boolean;
}) {
  const {
    okraData = { total_count: 0, data: [] },
    okraError = false,
    statsData = { total_pins: 0, country_count: 0, contributor_count: 0 },
    statsError = false,
  } = options;

  return vi.fn((url: string) => {
    if (url === '/okra' || url.endsWith('/okra')) {
      if (okraError) return Promise.reject(new Error('Network error'));
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(okraData),
      });
    }
    if (url.includes('/okra/stats')) {
      if (statsError) return Promise.reject(new Error('Network error'));
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(statsData),
      });
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });
}

describe('MapView', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    // Mock window.matchMedia for jsdom (used by useIsMobile hook)
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    originalFetch = globalThis.fetch;
    // Default: mock both endpoints returning empty/zero data
    globalThis.fetch = mockFetchResponses({}) as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // Requirement 7.1: zero pins shows empty state message with CTA
  describe('zero pins empty state', () => {
    it('shows empty state message and CTA when no pins are returned', async () => {
      globalThis.fetch = mockFetchResponses({
        okraData: { total_count: 0, data: [] },
      }) as unknown as typeof globalThis.fetch;

      render(<MapView />);

      await waitFor(() => {
        expect(screen.getByText('No gardens yet — be the first to share yours')).toBeTruthy();
      });

      const ctaLink = screen.getByText('Share your garden');
      expect(ctaLink).toBeTruthy();
      expect(ctaLink.tagName).toBe('BUTTON');
    });
  });

  // Requirement 13.1: map has aria-label attribute
  describe('aria-label on map', () => {
    it('renders the MapContainer with an aria-label describing the map purpose', async () => {
      render(<MapView />);

      const mapContainer = screen.getByTestId('map-container');
      expect(mapContainer.getAttribute('aria-label')).toBe(
        'Interactive map showing okra gardens around the world',
      );
    });
  });

  // Requirement 13.6: skip link is present
  describe('skip link', () => {
    it('renders a skip link to bypass the map', () => {
      render(<MapView />);

      const skipLink = screen.getByText('Skip map');
      expect(skipLink).toBeTruthy();
      expect(skipLink.tagName).toBe('A');
      expect(skipLink.getAttribute('href')).toBe('#after-map');
    });
  });

  // Requirement 5.6: error state shows retry button
  describe('error state', () => {
    it('shows error message and retry button when pin fetch fails', async () => {
      globalThis.fetch = mockFetchResponses({
        okraError: true,
      }) as unknown as typeof globalThis.fetch;

      render(<MapView />);

      await waitFor(() => {
        expect(screen.getByText('Something went wrong loading the map.')).toBeTruthy();
      });

      const retryButton = screen.getByText('Try again');
      expect(retryButton).toBeTruthy();
      expect(retryButton.tagName).toBe('BUTTON');
    });
  });
});
