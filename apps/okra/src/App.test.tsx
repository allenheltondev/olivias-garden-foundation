import { render, screen } from '@testing-library/react';
import { App } from './App';

vi.mock('./components/MapView', () => ({
  MapView: ({ onPinsLoaded, onStatsLoaded }: { onPinsLoaded?: (pins: unknown[]) => void; onStatsLoaded?: (stats: unknown) => void }) => {
    // Simulate loading pins and stats on mount
    if (onPinsLoaded) {
      setTimeout(() => onPinsLoaded([
        { id: '1', display_lat: 38.9, display_lng: -77.0, contributor_name: 'Alice', story_text: null, photo_urls: [] },
      ]), 0);
    }
    if (onStatsLoaded) {
      setTimeout(() => onStatsLoaded({ total_pins: 5, country_count: 3, contributor_count: 4 }), 0);
    }
    return <div data-testid="map-view">MapView</div>;
  },
}));

vi.mock('./components/PinPopup', async () => {
  const actual = await vi.importActual('./components/PinPopup');
  return actual;
});

describe('App', () => {
  it('renders the MapView component', () => {
    render(<App />);
    expect(screen.getByTestId('map-view')).toBeTruthy();
  });

  it('renders within a main landmark', () => {
    render(<App />);
    expect(screen.getByRole('main')).toBeTruthy();
  });

  it('renders the navbar with foundation name', () => {
    render(<App />);
    expect(screen.getByText("Olivia's Garden Foundation")).toBeTruthy();
  });

  it('renders the footer with copyright', () => {
    render(<App />);
    expect(screen.getByText(/Olivia's Garden Foundation. All rights reserved/)).toBeTruthy();
  });

  it('renders the story section', () => {
    render(<App />);
    expect(screen.getByText('Okra')).toBeTruthy();
  });
});
