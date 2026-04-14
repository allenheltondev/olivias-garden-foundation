import { useState, useCallback } from 'react';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { MapView, type PinData, type StatsData } from './components/MapView';
import { SubmissionModal } from './components/SubmissionModal';
import './App.css';

/** Shorten long country names for the sidebar display */
function shortCountry(country: string | null): string | null {
  if (!country) return null;
  const map: Record<string, string> = {
    'United States of America': 'United States',
    'United Kingdom': 'UK',
    'Russian Federation': 'Russia',
  };
  return map[country] ?? country;
}

/** Display name for the recent gardens list — uses country for anonymous */
function recentDisplayName(pin: PinData): string {
  if (pin.contributor_name && pin.contributor_name.trim()) {
    return pin.contributor_name;
  }
  if (pin.country) {
    return `Grower in ${shortCountry(pin.country)}`;
  }
  return 'A grower';
}

export function App() {
  const year = new Date().getFullYear();
  const [pins, setPins] = useState<PinData[]>([]);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [focusPin, setFocusPin] = useState<PinData | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handlePinsLoaded = useCallback((data: PinData[]) => setPins(data), []);
  const handleStatsLoaded = useCallback((data: StatsData) => setStats(data), []);

  const handleSidebarPinClick = useCallback((pin: PinData) => {
    setFocusPin(pin);
  }, []);

  // Show up to 5 most recent pins in the sidebar
  const recentPins = pins.slice(0, 5);

  return (
    <div className="app">
      <header className="navbar">
        <div className="navbar__inner">
          <a href="/" className="navbar__logo">Olivia's Garden Foundation</a>
          <nav className="navbar__nav" aria-label="Main navigation">
            <a href="/" className="navbar__link navbar__link--active">Map</a>
            <a href="/seeds" className="navbar__link navbar__link--btn">Request Seeds</a>
          </nav>
        </div>
      </header>

      <main className="hero">
        <div className="sidebar-stack">
          <aside className="sidebar">
            <h2 className="sidebar__title">Okra</h2>
            <div className="sidebar__accent-line" />

            {stats && (
              <p className="sidebar__stats-line">
                <span className="sidebar__stat-num">{stats.total_pins.toLocaleString()}</span>&nbsp;growers &middot; <span className="sidebar__stat-num">{stats.country_count.toLocaleString()}</span>&nbsp;countries &amp; counting
              </p>
            )}

            <p className="sidebar__text">
              Olivia loved growing okra more than anything. She found joy in watching seeds sprout, tending to her plants, and sharing what she grew.
            </p>
            <p className="sidebar__text">
              When Olivia lost her battle with leukemia at four years old, her family wanted to keep that joy growing.
            </p>
            <p className="sidebar__text">
              The foundation sends seeds harvested from Olivia's own okra plants — for free — to anyone in the US who requests them.
            </p>
            <p className="sidebar__text sidebar__text--italic">
              All we ask is that when they sprout, you share a photo so the world can see her garden keep growing.
            </p>

            <a href="/seeds" className="sidebar__cta">
              Request Free Seeds
              <span className="sidebar__cta-arrow">&rarr;</span>
            </a>
          </aside>

          {recentPins.length > 0 && (
            <div className="recent-card">
              <h3 className="recent-card__title">Growing Community</h3>
              <p className="recent-card__subtitle">These growers planted Olivia's seeds. Click a name to see their garden.</p>
              <ul className="recent-card__list">
                {recentPins.map((pin) => (
                  <li key={pin.id} className="recent-card__item">
                    <button
                      className="recent-card__btn"
                      onClick={() => handleSidebarPinClick(pin)}
                      aria-label={`View garden by ${recentDisplayName(pin)}`}
                    >
                      <span className="recent-card__dot" />
                      <span className="recent-card__name">{recentDisplayName(pin)}</span>
                      {pin.country && <span className="recent-card__location">{shortCountry(pin.country)}</span>}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="recent-card__divider" />
              <p className="recent-card__return-prompt">Already growing? Show the world.</p>
              <button type="button" className="recent-card__cta" onClick={() => setIsModalOpen(true)}>
                My Seeds Sprouted &rarr;
              </button>
            </div>
          )}
        </div>

        <div className="hero__map">
          <MapView
            externalSelectedPin={focusPin}
            onPinsLoaded={handlePinsLoaded}
            onStatsLoaded={handleStatsLoaded}
            onPinSelected={setFocusPin}
            onOpenSubmission={() => setIsModalOpen(true)}
          />
        </div>
      </main>

      <footer className="site-footer">
        <p className="site-footer__text">
          &copy; {year} Olivia's Garden Foundation. All rights reserved.
        </p>
        <a href="https://instagram.com/oliviasgardentx" className="site-footer__social" target="_blank" rel="noopener noreferrer" aria-label="Follow us on Instagram">
          <svg className="site-footer__ig-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 2.163c3.204 0 3.584.012 4.85.07 1.17.054 1.97.24 2.43.403a4.088 4.088 0 011.47.957c.453.453.78.898.957 1.47.163.46.35 1.26.404 2.43.058 1.266.07 1.646.07 4.85s-.012 3.584-.07 4.85c-.054 1.17-.24 1.97-.404 2.43a4.088 4.088 0 01-.957 1.47 4.088 4.088 0 01-1.47.957c-.46.163-1.26.35-2.43.404-1.266.058-1.646.07-4.85.07s-3.584-.012-4.85-.07c-1.17-.054-1.97-.24-2.43-.404a4.088 4.088 0 01-1.47-.957 4.088 4.088 0 01-.957-1.47c-.163-.46-.35-1.26-.404-2.43C2.175 15.584 2.163 15.204 2.163 12s.012-3.584.07-4.85c.054-1.17.24-1.97.404-2.43a4.088 4.088 0 01.957-1.47A4.088 4.088 0 015.064 2.293c.46-.163 1.26-.35 2.43-.404C8.76 1.831 9.14 1.82 12 1.82V2.163zM12 0C8.741 0 8.333.014 7.053.072 5.775.13 4.902.333 4.14.63a5.882 5.882 0 00-2.126 1.384A5.882 5.882 0 00.63 4.14C.333 4.902.13 5.775.072 7.053.014 8.333 0 8.741 0 12s.014 3.667.072 4.947c.058 1.278.261 2.151.558 2.913a5.882 5.882 0 001.384 2.126 5.882 5.882 0 002.126 1.384c.762.297 1.635.5 2.913.558C8.333 23.986 8.741 24 12 24s3.667-.014 4.947-.072c1.278-.058 2.151-.261 2.913-.558a5.882 5.882 0 002.126-1.384 5.882 5.882 0 001.384-2.126c.297-.762.5-1.635.558-2.913C23.986 15.667 24 15.259 24 12s-.014-3.667-.072-4.947c-.058-1.278-.261-2.151-.558-2.913a5.882 5.882 0 00-1.384-2.126A5.882 5.882 0 0019.86.63C19.098.333 18.225.13 16.947.072 15.667.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 11-2.88 0 1.44 1.44 0 012.88 0z"/>
          </svg>
          @oliviasgardentx
        </a>
      </footer>

      <SubmissionModal open={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </div>
  );
}
