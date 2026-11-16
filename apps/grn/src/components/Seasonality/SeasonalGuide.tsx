import { Button } from '@olivias/ui';
import type { CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import type { GrowerCropItem } from '../../types/listing';
import type { GrowerProfile } from '../../types/user';
import { CropArtwork } from '../branding/GardenArt';
import { visualForCrop } from '../CropPlanner/cropVisuals';
import { createLogger } from '../../utils/logging';
import { buildSeasonalGuide } from './seasonality';
import './SeasonalGuide.css';

const logger = createLogger('seasonal-guide');

export interface SeasonalGuideProps {
  growerProfile?: GrowerProfile | null;
  crops?: GrowerCropItem[];
  now?: Date;
}

function normalizedCropName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

export function SeasonalGuide({ growerProfile, crops = [], now }: SeasonalGuideProps) {
  const navigate = useNavigate();
  const guide = buildSeasonalGuide({
    homeZone: growerProfile?.homeZone,
    lat: growerProfile?.lat,
    locale: growerProfile?.locale,
    date: now,
  });

  if (!guide) {
    return (
      <section className="grn-season-guide grn-season-guide--unset" aria-labelledby="season-guide-heading">
        <div className="grn-season-guide__empty-copy">
          <span className="grn-season-guide__kicker">Your growing season</span>
          <h2 id="season-guide-heading">Make Today local to your garden</h2>
          <p>Add your growing zone to see a seasonal landscape and timely ideas for what to plant.</p>
          <Button variant="secondary" size="sm" onClick={() => navigate('/settings#profile')}>
            Review growing zone
          </Button>
        </div>
        <SeasonScene season="spring" />
      </section>
    );
  }

  const cropsByName = new Map(crops.map((crop) => [normalizedCropName(crop.cropName), crop]));

  return (
    <section
      className={`grn-season-guide grn-season-guide--${guide.season}`}
      aria-labelledby="season-guide-heading"
    >
      <div className="grn-season-guide__intro">
        <div className="grn-season-guide__copy">
          <span className="grn-season-guide__kicker">
            {guide.monthName} <span aria-hidden="true">·</span> Your local season
          </span>
          <h2 id="season-guide-heading">{guide.title}</h2>
          <p>{guide.summary}</p>
        </div>
        <SeasonScene season={guide.season} />
      </div>

      <div className="grn-season-guide__suggestions">
        <div className="grn-season-guide__suggestion-heading">
          <h3>Good to grow now</h3>
          <span>Three starting points for your garden</span>
        </div>
        <ul className="grn-season-guide__crop-grid">
          {guide.suggestions.map((suggestion) => {
            const existingCrop = cropsByName.get(normalizedCropName(suggestion.cropName));
            const visual = visualForCrop(suggestion.cropName);
            const buttonLabel = existingCrop
              ? `Open ${suggestion.cropName}`
              : `Plan ${suggestion.cropName}`;

            return (
              <li key={suggestion.cropName} className="grn-season-crop">
                <div
                  className="grn-season-crop__icon"
                  style={{ '--season-crop-accent': visual.accent } as CSSProperties}
                  aria-hidden="true"
                >
                  <CropArtwork iconKey={visual.iconKey} size={40} />
                </div>
                <div className="grn-season-crop__copy">
                  <div className="grn-season-crop__topline">
                    <span className="grn-season-crop__action">{suggestion.actionLabel}</span>
                    {existingCrop ? <span className="grn-season-crop__owned">In your garden</span> : null}
                  </div>
                  <h4>{suggestion.cropName}</h4>
                  <p>{suggestion.why}</p>
                  <button
                    type="button"
                    className="grn-season-crop__link"
                    onClick={() => {
                      logger.info('Seasonal suggestion opened', {
                        cropName: suggestion.cropName,
                        season: guide.season,
                        climateBand: guide.climateBand,
                        alreadyGrowing: Boolean(existingCrop),
                      });
                      if (existingCrop) {
                        navigate(`/garden/plants?crop=${encodeURIComponent(existingCrop.id)}`);
                      } else {
                        const params = new URLSearchParams({
                          suggestion: suggestion.cropName,
                          source: 'seasonal-guide',
                        });
                        navigate(`/garden/plants/new?${params.toString()}`);
                      }
                    }}
                  >
                    {buttonLabel}
                    <span aria-hidden="true"> →</span>
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        <p className="grn-season-guide__note">
          Planting windows are a starting point. Frost dates, current weather, shade, and your garden’s
          microclimate can shift the best timing.
        </p>
      </div>
    </section>
  );
}

function SeasonScene({ season }: { season: 'spring' | 'summer' | 'fall' | 'winter' }) {
  return (
    <div className={`grn-season-scene grn-season-scene--${season}`} aria-hidden="true">
      <span className="grn-season-scene__sun" />
      <span className="grn-season-scene__cloud grn-season-scene__cloud--one" />
      <span className="grn-season-scene__cloud grn-season-scene__cloud--two" />
      <span className="grn-season-scene__hill grn-season-scene__hill--far" />
      <span className="grn-season-scene__hill grn-season-scene__hill--near" />
      <span className="grn-season-scene__row" />
      <span className="grn-season-scene__plant grn-season-scene__plant--one" />
      <span className="grn-season-scene__plant grn-season-scene__plant--two" />
      <span className="grn-season-scene__plant grn-season-scene__plant--three" />
      <span className="grn-season-scene__spark grn-season-scene__spark--one" />
      <span className="grn-season-scene__spark grn-season-scene__spark--two" />
      <span className="grn-season-scene__spark grn-season-scene__spark--three" />
    </div>
  );
}

export default SeasonalGuide;
