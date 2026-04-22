import { useCallback, useState } from 'react';
import type { AuthSession } from '../auth/session';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { MapView, type PinData, type StatsData } from './components/MapView';
import { SeedRequestModal } from './components/SeedRequestModal';
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

function PromiseIcon({ kind }: { kind: 'mail' | 'seed' | 'check' }) {
  const paths: Record<string, string> = {
    mail: 'M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Zm0 2v.4l8 5.2 8-5.2V8H4Zm0 2.4V16h16v-5.6l-7.45 4.85a1 1 0 0 1-1.1 0L4 10.4Z',
    seed: 'M12 3c3.5 0 6 2.5 6 6 0 4-3 7-6 11-3-4-6-7-6-11 0-3.5 2.5-6 6-6Zm0 2a4 4 0 0 0-4 4c0 2.3 1.7 4.6 4 7.6 2.3-3 4-5.3 4-7.6a4 4 0 0 0-4-4Zm0 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z',
    check: 'M9.55 17.08 4.42 12l1.41-1.41 3.72 3.71 8.62-8.62 1.41 1.41-10.03 10Z',
  };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="ok-promise__icon-svg">
      <path d={paths[kind]} />
    </svg>
  );
}

function StepIcon({ src, alt }: { src: string; alt: string }) {
  return <img src={src} alt={alt} className="ok-how__icon-img" loading="lazy" />;
}

export function OkraExperience({
  onNavigate,
  authEnabled,
  authSession,
  onLogin,
  onSignup,
}: {
  onNavigate: (path: string) => void;
  authEnabled: boolean;
  authSession: AuthSession | null;
  onLogin: () => void;
  onSignup: () => void;
}) {
  const [pins, setPins] = useState<PinData[]>([]);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [focusPin, setFocusPin] = useState<PinData | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSeedModalOpen, setIsSeedModalOpen] = useState(false);

  const handlePinsLoaded = useCallback((data: PinData[]) => setPins(data), []);
  const handleStatsLoaded = useCallback((data: StatsData) => setStats(data), []);
  const handleSidebarPinClick = useCallback((pin: PinData) => setFocusPin(pin), []);
  const openSubmission = useCallback(() => setIsModalOpen(true), []);
  const requestSeeds = useCallback(() => setIsSeedModalOpen(true), []);

  const recentPins = pins.slice(0, 5);
  const hasGrowers = stats !== null && stats.total_pins > 0;

  return (
    <div className="okra-experience">
      {/* HERO */}
      <section className="ok-hero" aria-labelledby="ok-hero-title">
        <div className="ok-hero__content">
          <p className="ok-hero__eyebrow">The Okra Project</p>
          <h1 id="ok-hero-title" className="ok-hero__title">
            These seeds came from Olivia&apos;s garden. Now they&apos;re growing everywhere.
          </h1>
          <p className="ok-hero__lede">
            Okra was Olivia&apos;s favorite thing to grow. We&apos;ve kept her plants going — and we mail
            free seeds to anyone who wants to grow them.
          </p>
          <p className="ok-hero__lede">
            Grow them, take a photo, and add your garden to the map. Every pin is a piece of her
            garden, somewhere new in the world.
          </p>

          <div className="ok-hero__actions">
            <button type="button" className="ok-btn ok-btn--primary ok-btn--lg" onClick={requestSeeds}>
              Request free seeds
            </button>
            <button type="button" className="ok-btn ok-btn--ghost ok-btn--lg" onClick={openSubmission}>
              Add my okra patch
            </button>
          </div>

          <ul className="ok-hero__trust" aria-label="What to expect">
            <li>
              <PromiseIcon kind="check" /> Free
            </li>
            <li>
              <PromiseIcon kind="check" /> Mailed to your door
            </li>
            <li>
              <PromiseIcon kind="check" /> No sign-up required
            </li>
            <li>
              <PromiseIcon kind="check" /> Grow something new
            </li>
          </ul>
        </div>

        <figure className="ok-hero__photo">
          <div className="ok-hero__photo-frame">
            <img
              src="/images/okra/olivia-okra.jpg"
              alt="Olivia with her okra harvest."
              loading="eager"
              fetchPriority="high"
            />
          </div>
          <figcaption className="ok-hero__photo-caption">Olivia with her okra harvest.</figcaption>
        </figure>
      </section>

      {/* STATS */}
      {hasGrowers ? (
        <section className="ok-stats" aria-label="Community stats">
          <div className="ok-stats__item">
            <span className="ok-stats__value">{stats!.total_pins.toLocaleString()}</span>
            <span className="ok-stats__label">growers on the map</span>
          </div>
          <div className="ok-stats__item">
            <span className="ok-stats__value">{stats!.country_count.toLocaleString()}</span>
            <span className="ok-stats__label">countries represented</span>
          </div>
        </section>
      ) : null}

      {/* HOW IT WORKS */}
      <section className="ok-how" aria-labelledby="ok-how-heading">
        <header className="ok-how__header">
          <p className="ok-how__eyebrow">A simple path</p>
          <h2 id="ok-how-heading" className="ok-how__heading">How it works</h2>
        </header>
        <ol className="ok-how__grid">
          <li className="ok-how__card">
            <div className="ok-how__icon"><StepIcon src="/images/icons/pot.webp" alt="" /></div>
            <div className="ok-how__step-num" aria-hidden="true">01</div>
            <h3 className="ok-how__card-title">Request seeds</h3>
            <p className="ok-how__card-body">
              Fill out a short form and we mail you okra seeds from Olivia&apos;s line, completely
              free.
            </p>
          </li>
          <li className="ok-how__card">
            <div className="ok-how__icon"><StepIcon src="/images/icons/seedling.webp" alt="" /></div>
            <div className="ok-how__step-num" aria-hidden="true">02</div>
            <h3 className="ok-how__card-title">Grow them</h3>
            <p className="ok-how__card-body">
              Plant in a garden bed, containers, or wherever you have space. Okra is forgiving and
              grows fast in warm weather.
            </p>
          </li>
          <li className="ok-how__card">
            <div className="ok-how__icon"><StepIcon src="/images/icons/hands.webp" alt="" /></div>
            <div className="ok-how__step-num" aria-hidden="true">03</div>
            <h3 className="ok-how__card-title">Add your garden</h3>
            <p className="ok-how__card-body">
              Come back with a photo of your plant and pin your location on the map. You&apos;re now
              part of the lineage.
            </p>
          </li>
        </ol>
      </section>

      {/* STORY */}
      <section className="ok-story" aria-labelledby="ok-story-heading">
        <div className="ok-story__inner">
          <p className="ok-story__eyebrow">Why okra?</p>
          <h2 id="ok-story-heading" className="ok-story__heading">
            It&apos;s what she loved to grow.
          </h2>
          <p className="ok-story__body">
            Olivia was a true Texas cowgirl who loved being outside and spending time in the garden.
            Okra was her favorite. Keeping her line of plants going — and mailing seeds to anyone who
            asks — is how we keep her garden alive past our own fence line.
          </p>
          <button
            type="button"
            className="ok-link-btn"
            onClick={() => onNavigate('/about')}
          >
            Read Olivia&apos;s story →
          </button>
        </div>
      </section>

      {/* MAP */}
      <section className="ok-map-section" aria-labelledby="ok-map-heading">
        <header className="ok-map__header">
          <p className="ok-map__eyebrow">The map</p>
          <h2 id="ok-map-heading" className="ok-map__heading">
            Gardens growing from Olivia&apos;s seeds
          </h2>
          <p className="ok-map__sub">
            Pins go up once growers send back a photo. Click one to see their garden.
          </p>
        </header>

        <div className="ok-map-container">
          <MapView
            externalSelectedPin={focusPin}
            onPinsLoaded={handlePinsLoaded}
            onStatsLoaded={handleStatsLoaded}
            onPinSelected={setFocusPin}
            onOpenSubmission={openSubmission}
          />
        </div>

        {pins.length > 0 ? (
          <p className="ok-map__footer">Every pin is a garden growing from Olivia&apos;s seeds.</p>
        ) : null}

        {recentPins.length > 0 ? (
          <aside className="ok-recent" aria-label="Recent growers">
            <div className="ok-recent__header">
              <div>
                <h3 className="ok-recent__title">Recent growers</h3>
                <p className="ok-recent__sub">
                  Click a grower to center the map on their garden.{' '}
                  {authSession
                    ? 'Your sign-in keeps future submissions connected to you.'
                    : 'You can submit anonymously — no account needed.'}
                </p>
              </div>
              <button
                type="button"
                className="ok-btn ok-btn--primary"
                onClick={openSubmission}
              >
                Add yours
              </button>
            </div>

            <ul className="ok-recent__list">
              {recentPins.map((pin) => (
                <li key={pin.id}>
                  <button
                    type="button"
                    className="ok-recent__btn"
                    onClick={() => handleSidebarPinClick(pin)}
                    aria-label={`View garden by ${recentDisplayName(pin)}`}
                  >
                    <span className="ok-recent__dot" aria-hidden="true" />
                    <span className="ok-recent__name">{recentDisplayName(pin)}</span>
                    {pin.country ? (
                      <span className="ok-recent__location">{shortCountry(pin.country)}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        ) : null}
      </section>

      {/* FINAL CTA */}
      <section className="ok-final" aria-labelledby="ok-final-heading">
        <h2 id="ok-final-heading" className="ok-final__heading">
          Ready to grow some okra?
        </h2>
        <p className="ok-final__body">
          We&apos;ll mail you a packet of seeds from Olivia&apos;s line. No account, no catch.
        </p>
        <div className="ok-final__actions">
          <button type="button" className="ok-btn ok-btn--primary ok-btn--lg" onClick={requestSeeds}>
            Request free seeds
          </button>
          <button type="button" className="ok-btn ok-btn--ghost ok-btn--lg" onClick={openSubmission}>
            I&apos;m already growing this
          </button>
        </div>
      </section>

      {/* STICKY MOBILE CTA */}
      <div className="ok-sticky-cta" role="region" aria-label="Request seeds">
        <button type="button" className="ok-btn ok-btn--primary ok-btn--block" onClick={requestSeeds}>
          Request free seeds
        </button>
      </div>

      <SubmissionModal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        authEnabled={authEnabled}
        authSession={authSession}
        onLogin={onLogin}
        onSignup={onSignup}
      />

      <SeedRequestModal
        open={isSeedModalOpen}
        onClose={() => setIsSeedModalOpen(false)}
        authEnabled={authEnabled}
        authSession={authSession}
        onLogin={onLogin}
        onSignup={onSignup}
      />
    </div>
  );
}
