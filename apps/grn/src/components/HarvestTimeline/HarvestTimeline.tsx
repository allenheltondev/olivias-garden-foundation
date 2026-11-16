import { useMemo, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@olivias/ui';
import type { GrowerCropItem } from '../../types/listing';
import { CropArtwork } from '../branding/GardenArt';
import { visualForCrop } from '../CropPlanner/cropVisuals';
import { createLogger } from '../../utils/logging';
import {
  buildHarvestTimeline,
  cropDisplayName,
  harvestDateLabel,
  type HarvestHorizon,
  type HarvestTimelineItem,
} from './harvestTimelineData';
import './HarvestTimeline.css';

const logger = createLogger('harvest-timeline');

const HORIZONS: Array<{ id: HarvestHorizon; label: string; shortLabel: string }> = [
  { id: 'ready', label: 'Ready to check', shortLabel: 'Now' },
  { id: 'week', label: 'Next 7 days', shortLabel: 'Soon' },
  { id: 'month', label: 'This month', shortLabel: 'Ahead' },
  { id: 'later', label: 'Later', shortLabel: 'Later' },
];

export interface HarvestTimelineProps {
  crops: GrowerCropItem[];
  now?: Date;
}

export function HarvestTimeline({ crops, now }: HarvestTimelineProps) {
  const navigate = useNavigate();
  const timeline = useMemo(() => buildHarvestTimeline(crops, now), [crops, now]);
  const growingCount = crops.filter((crop) => crop.status === 'growing').length;

  if (growingCount === 0) return null;

  const openCrop = (item: HarvestTimelineItem) => {
    const isReady = item.horizon === 'ready';
    logger.info('Harvest timeline item opened', {
      cropId: item.crop.id,
      horizon: item.horizon,
      dayOffset: item.dayOffset,
    });
    const params = new URLSearchParams({ crop: item.crop.id });
    if (isReady) params.set('action', 'harvest');
    navigate(`/garden/plants?${params.toString()}`);
  };

  const firstMissing = timeline.missingTiming[0];

  return (
    <section className="grn-harvest-timeline" aria-labelledby="harvest-timeline-heading">
      <header className="grn-harvest-timeline__header">
        <div>
          <h2 id="harvest-timeline-heading">Coming harvests</h2>
          <p>Approximate first harvests from the dates saved with your plants.</p>
        </div>
        {timeline.groups.ready.length > 0 ? (
          <span className="grn-harvest-timeline__ready-count">
            {timeline.groups.ready.length} ready to check
          </span>
        ) : null}
      </header>

      {timeline.scheduledCount > 0 ? (
        <ol className="grn-harvest-timeline__rail" aria-label="Harvest timeline">
          {HORIZONS.map((horizon) => (
            <li
              key={horizon.id}
              className={`grn-harvest-period grn-harvest-period--${horizon.id}`}
            >
              <div className="grn-harvest-period__marker" aria-hidden="true">
                <span />
              </div>
              <div className="grn-harvest-period__heading">
                <span>{horizon.shortLabel}</span>
                <h3>{horizon.label}</h3>
              </div>
              {timeline.groups[horizon.id].length > 0 ? (
                <ul className="grn-harvest-period__items">
                  {timeline.groups[horizon.id].map((item) => (
                    <li key={item.crop.id}>
                      <HarvestCrop item={item} onOpen={() => openCrop(item)} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="grn-harvest-period__empty">Nothing scheduled</p>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <div className="grn-harvest-timeline__empty">
          <span aria-hidden="true">🌾</span>
          <div>
            <h3>Give your growing plants a harvest estimate</h3>
            <p>Add an expected first harvest and this space will become your garden timeline.</p>
          </div>
        </div>
      )}

      {firstMissing ? (
        <div className="grn-harvest-timeline__missing">
          <p>
            <strong>
              {timeline.missingTiming.length} growing plant{timeline.missingTiming.length === 1 ? '' : 's'}
            </strong>{' '}
            {timeline.missingTiming.length === 1 ? 'needs' : 'need'} a harvest estimate.
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const params = new URLSearchParams({ crop: firstMissing.id, action: 'timing' });
              navigate(`/garden/plants?${params.toString()}`);
            }}
          >
            Add timing
          </Button>
        </div>
      ) : null}

      <p className="grn-harvest-timeline__note">
        Harvest dates are estimates. Weather, variety, and your garden’s conditions can move them.
      </p>
    </section>
  );
}

function HarvestCrop({ item, onOpen }: { item: HarvestTimelineItem; onOpen: () => void }) {
  const visual = visualForCrop(item.crop.cropName);
  const name = cropDisplayName(item.crop);
  const isReady = item.horizon === 'ready';

  return (
    <article
      className={`grn-harvest-crop ${isReady ? 'grn-harvest-crop--ready' : ''}`.trim()}
      style={{ '--harvest-crop-accent': visual.accent } as CSSProperties}
    >
      <div className="grn-harvest-crop__icon" aria-hidden="true">
        <CropArtwork iconKey={visual.iconKey} size={32} />
      </div>
      <div className="grn-harvest-crop__copy">
        <h4>{name}</h4>
        <p>{harvestDateLabel(item)}</p>
        {item.crop.bedName ? <span>{item.crop.bedName}</span> : null}
      </div>
      <button
        type="button"
        className="grn-harvest-crop__action"
        onClick={onOpen}
        aria-label={isReady ? `Log ${name} harvest` : `View ${name}`}
      >
        {isReady ? 'Log harvest' : 'View'}
        <span aria-hidden="true"> →</span>
      </button>
    </article>
  );
}

export default HarvestTimeline;
