import { useCallback, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { MapView, type PinData, type StatsData } from './components/MapView';
import { SubmissionModal } from './components/SubmissionModal';
import './theme.css';
import './OkraExperience.css';

function shortCountry(country: string | null): string | null {
  if (!country) return null;

  const map: Record<string, string> = {
    'United States of America': 'United States',
    'United Kingdom': 'UK',
    'Russian Federation': 'Russia',
  };

  return map[country] ?? country;
}

function recentDisplayName(pin: PinData): string {
  if (pin.contributor_name && pin.contributor_name.trim()) {
    return pin.contributor_name;
  }

  if (pin.country) {
    return `Grower in ${shortCountry(pin.country)}`;
  }

  return 'A grower';
}

export function OkraExperience({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [pins, setPins] = useState<PinData[]>([]);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [focusPin, setFocusPin] = useState<PinData | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handlePinsLoaded = useCallback((data: PinData[]) => setPins(data), []);
  const handleStatsLoaded = useCallback((data: StatsData) => setStats(data), []);
  const handleSidebarPinClick = useCallback((pin: PinData) => setFocusPin(pin), []);

  const recentPins = pins.slice(0, 5);

  return (
    <div className="okra-experience">
      <section className="okra-experience__intro">
        <div className="okra-experience__intro-copy">
          <p className="okra-experience__eyebrow">Okra Project</p>
          <h1 className="okra-experience__title">Grow okra. Share it back.</h1>
          <p className="okra-experience__lede okra-experience__lede--inline">
            Okra was Olivia&apos;s favorite thing to grow. We share free seeds from a line of plants she
            grew herself so more people can experience some of that same joy.
          </p>
          <p className="okra-experience__lede okra-experience__lede--inline">
            Grow it in a garden bed or a few containers, send photos back, and join the growers
            already pinned on this map.
          </p>

          <div className="okra-experience__intro-actions">
            <button type="button" className="okra-experience__primary-cta" onClick={() => onNavigate('/seeds')}>
              Request free seeds
            </button>
            <button
              type="button"
              className="okra-experience__secondary-cta"
              onClick={() => setIsModalOpen(true)}
            >
              Share your garden
            </button>
          </div>
        </div>

        <div className="okra-experience__story-photo">
          <img
            src="/images/okra/olivia-okra.jpg"
            alt="Olivia in the garden with okra."
          />
        </div>
      </section>

      {stats ? (
        <section className="okra-stats" aria-label="Okra community statistics">
          <div className="okra-stats__item">
            <span className="okra-stats__value">{stats.total_pins.toLocaleString()}</span>
            <span className="okra-stats__label">growers on the map</span>
          </div>
          <div className="okra-stats__item">
            <span className="okra-stats__value">{stats.country_count.toLocaleString()}</span>
            <span className="okra-stats__label">countries represented</span>
          </div>
        </section>
      ) : null}

      <section className="okra-experience__content" aria-label="Okra map and community">
        <div className="okra-experience__map">
          <MapView
            externalSelectedPin={focusPin}
            onPinsLoaded={handlePinsLoaded}
            onStatsLoaded={handleStatsLoaded}
            onPinSelected={setFocusPin}
            onOpenSubmission={() => setIsModalOpen(true)}
          />
        </div>

        {recentPins.length > 0 ? (
          <section className="okra-recent-card" aria-label="Recent growers">
            <div className="okra-recent-card__header">
              <div>
                <h3 className="okra-recent-card__title">Recent growers</h3>
                <p className="okra-recent-card__subtitle">
                  These are growers who sent back photos and stories. Click one to center the map on
                  their garden.
                </p>
              </div>
              <button
                type="button"
                className="okra-recent-card__cta okra-recent-card__cta--inline"
                onClick={() => setIsModalOpen(true)}
              >
                Add yours
              </button>
            </div>

            <ul className="okra-recent-card__list okra-recent-card__list--inline">
              {recentPins.map((pin) => (
                <li key={pin.id} className="okra-recent-card__item">
                  <button
                    type="button"
                    className="okra-recent-card__btn"
                    onClick={() => handleSidebarPinClick(pin)}
                    aria-label={`View garden by ${recentDisplayName(pin)}`}
                  >
                    <span className="okra-recent-card__dot" />
                    <span className="okra-recent-card__name">{recentDisplayName(pin)}</span>
                    {pin.country ? (
                      <span className="okra-recent-card__location">{shortCountry(pin.country)}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </section>

      <SubmissionModal open={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </div>
  );
}
