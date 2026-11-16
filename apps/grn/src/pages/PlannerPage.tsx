import { useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Panel, SectionHeading } from '@olivias/ui';
import { getMe, listMyCrops } from '../services/api';
import { PlantLoader } from '../components/branding/PlantLoader';
import { GardenPyramid, type PyramidCropVisual } from '../components/Planner/GardenPyramid';
import { PlanScore } from '../components/Planner/PlanScore';
import { CropIcon } from '../components/CropPlanner/cropIcons';
import { visualForCrop } from '../components/CropPlanner/cropVisuals';
import { shade } from '../components/GardenMasterplan/palette';
import {
  bucketCropsByTier,
  evaluatePlan,
  planGuidance,
  tierMeta,
  type PyramidTier,
} from '../components/CropPlanner/gardenPyramid';
import type { GrowerCropItem } from '../types/listing';

const ALL_TIERS: PyramidTier[] = [1, 2, 3, 4, 5];

function parseTier(value: string | null): PyramidTier {
  const tier = Number(value);
  return ALL_TIERS.includes(tier as PyramidTier) ? (tier as PyramidTier) : 1;
}

export function PlannerPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTier = parseTier(searchParams.get('tier'));
  const [activeTier, setActiveTier] = useState<PyramidTier>(requestedTier);

  useEffect(() => {
    setActiveTier(requestedTier);
  }, [requestedTier]);

  const selectTier = (tier: PyramidTier) => {
    setActiveTier(tier);
    const next = new URLSearchParams(searchParams);
    next.set('tier', String(tier));
    setSearchParams(next, { replace: true });
  };

  const { data: profile, isLoading: isLoadingProfile } = useQuery({
    queryKey: ['userProfile'],
    queryFn: getMe,
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });

  const {
    data: myCrops,
    isLoading: isLoadingCrops,
    isError: isCropsError,
    refetch: refetchCrops,
  } = useQuery({
    queryKey: ['myCrops'],
    queryFn: listMyCrops,
    enabled: profile?.userType === 'grower',
  });

  const { tiers, unsorted } = useMemo(
    () => bucketCropsByTier(myCrops ?? []),
    [myCrops]
  );

  const counts = useMemo(
    () =>
      ALL_TIERS.reduce(
        (acc, level) => {
          acc[level] = tiers[level].length;
          return acc;
        },
        {} as Record<PyramidTier, number>
      ),
    [tiers]
  );

  const cropsByTier = useMemo(
    () =>
      ALL_TIERS.reduce(
        (acc, level) => {
          acc[level] = tiers[level].map(toCropVisual);
          return acc;
        },
        {} as Record<PyramidTier, PyramidCropVisual[]>
      ),
    [tiers]
  );

  const evaluation = useMemo(() => evaluatePlan(counts), [counts]);
  const nextTier = ALL_TIERS.find((level) => counts[level] === 0) ?? 1;

  if (isLoadingProfile) {
    return (
      <section className="grn-section">
        <SectionHeading title="Plan" />
        <Panel className="grn-page-status">
          <PlantLoader size="md" />
          <p>Loading your plan…</p>
        </Panel>
      </section>
    );
  }

  if (!profile || profile.userType !== 'grower') {
    return <Navigate to="/" replace />;
  }

  const activeCrops = tiers[activeTier];

  return (
    <section className="grn-section grn-planner">
      <SectionHeading
        title="Plan"
        body="Use the garden pyramid to see what is covered and choose a practical next layer."
      />

      <Card padding="6" className="grn-planner__workspace">
        <div className="grn-planner__health">
          <PlanScore evaluation={evaluation} />
          <div className="grn-planner__health-body">
            <p className="grn-planner__progress-stat">
              <strong>{evaluation.coveredCount}</strong> of 5 layers started
            </p>
            <div className="grn-planner__progress-track" aria-hidden="true">
              {ALL_TIERS.map((level) => (
                <span
                  key={level}
                  className={`grn-planner__progress-pip ${counts[level] > 0 ? 'is-on' : ''}`.trim()}
                  style={{ background: counts[level] > 0 ? tierMeta(level).accent : undefined }}
                  title={`${tierMeta(level).name}: ${counts[level]} crop${counts[level] === 1 ? '' : 's'}`}
                />
              ))}
            </div>
            <p className="grn-planner__guidance">{planGuidance(evaluation)}</p>
            <div className="grn-planner__map-link">
              <span>Ready to give your plan a place?</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate({ pathname: '/garden', search: searchParams.toString() })}
              >
                Open Map
              </Button>
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => selectTier(nextTier)}
          >
            {counts[nextTier] > 0
              ? `Review ${tierMeta(nextTier).name}`
              : `Start with ${tierMeta(nextTier).name}`}
          </Button>
        </div>

        <div className="grn-planner__workspace-grid">
          <section className="grn-planner__pyramid-panel" aria-labelledby="planner-layers-title">
            <div className="grn-planner__panel-heading">
              <h2 id="planner-layers-title" className="grn-planner__pyramid-title">
                Choose a layer
              </h2>
              <p>Start at the base or jump to the part of your garden you want to tend.</p>
            </div>
            <GardenPyramid
              cropsByTier={cropsByTier}
              activeTier={activeTier}
              nextTier={evaluation.nextFocusTier}
              onSelectTier={selectTier}
            />
          </section>

          <section className="grn-planner__detail-panel" aria-label={`${tierMeta(activeTier).name} layer`}>
            <TierDetail
              tier={activeTier}
              crops={activeCrops}
              isLoading={isLoadingCrops}
              hasError={isCropsError}
              onRetry={() => void refetchCrops()}
              onAddCrop={() => navigate(`/garden/plants/new?${new URLSearchParams({ returnTo: `${location.pathname}${location.search}` })}`)}
            />
          </section>
        </div>
      </Card>

      <Card padding="6" className="grn-planner__local-context">
        <div>
          <h3>Local planting context</h3>
          <p>
            If it helps, compare this plan with aggregated activity near you. These are
            optional community signals, not instructions or a commitment to grow more.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            navigate({
              pathname: '/garden/plan/recommendations',
              search: searchParams.toString(),
            })
          }
        >
          View local context
        </Button>
      </Card>

      {unsorted.length > 0 ? (
        <Card padding="6">
          <div className="grn-planner__unsorted">
            <h3 className="grn-planner__detail-name">Not yet placed</h3>
            <p className="grn-planner__detail-desc">
              We couldn&apos;t sort these into a layer — they may be ornamentals or
              experiments outside the food pyramid.
            </p>
            <ul className="grn-planner__crop-list">
              {unsorted.map((crop) => (
                <CropChip key={crop.id} crop={crop} />
              ))}
            </ul>
          </div>
        </Card>
      ) : null}
    </section>
  );
}

// Ties each layer back to the "build from the base up" philosophy, so the
// order of the pyramid reads as intentional rather than decorative.
function positionNote(level: PyramidTier): string {
  if (level === 1) return 'The base of the pyramid — everything else builds on this layer.';
  if (level === 5) return 'The top of the pyramid — pure upside once the layers below are growing.';
  return 'Grow this once the layers beneath it are underway — each layer rests on the one below.';
}

function toCropVisual(crop: GrowerCropItem): PyramidCropVisual {
  const visual = visualForCrop(crop.cropName, null);
  return {
    id: crop.id,
    label: crop.nickname || crop.cropName,
    iconKey: visual.iconKey,
    accent: visual.accent,
  };
}

interface TierDetailProps {
  tier: PyramidTier;
  crops: GrowerCropItem[];
  isLoading: boolean;
  hasError: boolean;
  onRetry: () => void;
  onAddCrop: () => void;
}

function TierDetail({ tier, crops, isLoading, hasError, onRetry, onAddCrop }: TierDetailProps) {
  const meta = tierMeta(tier);
  const plantedNames = useMemo(
    () => new Set(crops.map((c) => c.cropName.trim().toLowerCase())),
    [crops]
  );
  const openSuggestions = meta.suggestions.filter(
    (s) => !plantedNames.has(s.name.trim().toLowerCase())
  );

  return (
    <div
      className="grn-planner__detail"
      style={{
        ['--tier-accent' as string]: meta.accent,
        // A darker shade of the same accent, used for small label text so it
        // stays legible on the pale card even for the light gold/sage tiers.
        ['--tier-ink' as string]: shade(meta.accent, 0.4),
      }}
    >
      <header className="grn-planner__detail-head">
        <span className="grn-planner__detail-level" aria-hidden="true">
          {meta.level}
        </span>
        <div>
          <p className="grn-planner__detail-position">Layer {meta.level} of 5</p>
          <h3 className="grn-planner__detail-name">{meta.name}</h3>
          <p className="grn-planner__detail-tagline">{meta.descriptor}</p>
        </div>
      </header>

      <dl className="grn-planner__detail-facts">
        <div className="grn-planner__fact">
          <dt>Gives you</dt>
          <dd>{meta.contribution}</dd>
        </div>
        <div className="grn-planner__fact">
          <dt>Effort</dt>
          <dd>{meta.effort}</dd>
        </div>
      </dl>

      <p className="grn-planner__detail-desc">{meta.description}</p>

      <p className="grn-planner__detail-note">{positionNote(meta.level)}</p>

      <div className="grn-planner__detail-section">
        <h4 className="grn-planner__detail-subhead">
          In your garden ({crops.length})
        </h4>
        {isLoading ? (
          <p className="grn-planner__detail-state" role="status">
            Checking this layer…
          </p>
        ) : hasError ? (
          <div className="grn-planner__detail-state grn-planner__detail-state--error" role="alert">
            <p>We couldn&apos;t load your garden just now.</p>
            <Button variant="secondary" size="sm" onClick={onRetry}>
              Try again
            </Button>
          </div>
        ) : crops.length > 0 ? (
          <ul className="grn-planner__crop-list">
            {crops.map((crop) => (
              <CropChip key={crop.id} crop={crop} />
            ))}
          </ul>
        ) : (
          <div className="grn-planner__empty-state">
            <p className="grn-planner__detail-empty">
              This layer is ready for its first crop.
            </p>
            <Button variant="primary" size="sm" onClick={onAddCrop}>
              Add a crop to {meta.name}
            </Button>
          </div>
        )}
      </div>

      {!isLoading && !hasError && openSuggestions.length > 0 ? (
        <div className="grn-planner__detail-section">
          <h4 className="grn-planner__detail-subhead">Ideas to fill this layer</h4>
          <ul className="grn-planner__suggestions">
            {openSuggestions.map((suggestion) => (
              <li key={suggestion.name}>
                <span className="grn-planner__suggestion" style={{ color: meta.accent }}>
                  <CropIcon iconKey={suggestion.iconKey} color={meta.accent} size="1.1rem" />
                  {suggestion.name}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!isLoading && !hasError && crops.length > 0 ? (
        <div className="grn-planner__detail-actions">
          <Button variant="secondary" size="sm" onClick={onAddCrop}>
            Add another crop
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function CropChip({ crop }: { crop: GrowerCropItem }) {
  const visual = visualForCrop(crop.cropName, null);
  return (
    <li className="grn-planner__crop-chip" style={{ borderColor: `${visual.accent}55` }}>
      <CropIcon iconKey={visual.iconKey} color={visual.accent} size="1.2rem" />
      <span>{crop.nickname || crop.cropName}</span>
    </li>
  );
}

export default PlannerPage;
