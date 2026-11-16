import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listMyCrops,
  deleteMyCrop,
  listMyBeds,
  updateMyCrop,
  type HarvestItem,
  type UpsertGrowerCropRequest,
} from '../../services/api';
import type { GrowerCropItem } from '../../types/listing';
import { Button, Card } from '@olivias/ui';
import { createLogger } from '../../utils/logging';
import { visualForCrop } from '../CropPlanner/cropVisuals';
import { CropArtwork, GardenScene } from '../branding/GardenArt';
import { HarvestLogModal } from '../Harvests/HarvestLogModal';
import { daysUntil, formatDate, harvestProgress } from '../../utils/cropTiming';
import { CropTimingModal } from './CropTimingModal';
import './CropJourney.css';

const logger = createLogger('crop-library');

interface CropLibraryPanelProps {
  viewerUserId?: string;
}

const STATUS_LABELS: Record<string, { label: string; emoji: string; tone: string }> = {
  interested: { label: 'Interested', emoji: '💭', tone: 'neutral' },
  planning: { label: 'Planning', emoji: '📋', tone: 'info' },
  growing: { label: 'Growing', emoji: '🌱', tone: 'success' },
  paused: { label: 'Paused', emoji: '⏸️', tone: 'muted' },
};

export function CropLibraryPanel({ viewerUserId }: CropLibraryPanelProps) {
  void viewerUserId;
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<'all' | 'growing' | 'planning' | 'interested'>('all');
  const [harvestCrop, setHarvestCrop] = useState<GrowerCropItem | null>(null);
  const [timingCrop, setTimingCrop] = useState<GrowerCropItem | null>(null);
  const [dismissedLinkedHarvestId, setDismissedLinkedHarvestId] = useState<string | null>(null);
  const [dismissedLinkedTimingId, setDismissedLinkedTimingId] = useState<string | null>(null);
  const [bedUpdateError, setBedUpdateError] = useState<string | null>(null);

  const { data: myCrops, isLoading: isLoadingCrops, isError: cropsError, refetch: retryCrops } = useQuery({
    queryKey: ['myCrops'],
    queryFn: listMyCrops,
  });

  const { data: beds = [] } = useQuery({
    queryKey: ['myBeds'],
    queryFn: listMyBeds,
  });

  // A bed carried between views is navigation context, not an assignment.
  // Explicit add-to-bed flows supply bedId themselves.
  const addCropParams = new URLSearchParams({ returnTo: `${location.pathname}${location.search}` });
  const addCropPath = `/garden/plants/new?${addCropParams}`;
  const linkedCropId = searchParams.get('crop');
  const linkedAction = searchParams.get('action');
  const linkedHarvestId = searchParams.get('harvest');

  const linkedHarvestCrop = useMemo(() => {
    if (linkedAction !== 'harvest' || !linkedCropId || !myCrops) return null;
    return myCrops.find((crop) => crop.id === linkedCropId) ?? null;
  }, [linkedAction, linkedCropId, myCrops]);
  const linkedTimingCrop = useMemo(() => {
    if (linkedAction !== 'timing' || !linkedCropId || !myCrops) return null;
    return myCrops.find((crop) => crop.id === linkedCropId) ?? null;
  }, [linkedAction, linkedCropId, myCrops]);
  const activeHarvestCrop =
    harvestCrop ??
    (linkedHarvestCrop?.id !== dismissedLinkedHarvestId ? linkedHarvestCrop : null);
  const activeTimingCrop =
    timingCrop ??
    (linkedTimingCrop?.id !== dismissedLinkedTimingId ? linkedTimingCrop : null);

  const deleteMutation = useMutation({
    mutationFn: deleteMyCrop,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['myCrops'] });
      logger.info('Crop removed from library');
    },
    onError: (error) => {
      logger.error('Failed to remove crop', error instanceof Error ? error : undefined);
    },
  });

  const bedMutation = useMutation({
    mutationFn: ({ crop, bedId }: { crop: GrowerCropItem; bedId: string | null }) =>
      updateMyCrop(crop.id, cropUpdatePayload(crop, bedId)),
    onMutate: async ({ crop, bedId }) => {
      setBedUpdateError(null);
      await queryClient.cancelQueries({ queryKey: ['myCrops'] });
      const previous = queryClient.getQueryData<GrowerCropItem[]>(['myCrops']);
      const bedName = beds.find((bed) => bed.id === bedId)?.name ?? null;
      queryClient.setQueryData<GrowerCropItem[]>(['myCrops'], (current) =>
        current?.map((item) =>
          item.id === crop.id ? { ...item, bedId, bedName } : item
        )
      );
      return { previous };
    },
    onError: (error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['myCrops'], context.previous);
      }
      setBedUpdateError(
        error instanceof Error ? error.message : 'Could not update that bed assignment.'
      );
    },
    onSuccess: () => {
      logger.info('Updated crop bed assignment');
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['myCrops'] });
    },
  });

  const timingMutation = useMutation({
    mutationFn: ({
      crop,
      plantingDate,
      expectedHarvestDate,
    }: {
      crop: GrowerCropItem;
      plantingDate: string | null;
      expectedHarvestDate: string | null;
    }) =>
      updateMyCrop(crop.id, {
        ...cropUpdatePayload(crop, crop.bedId),
        plantingDate,
        expectedHarvestDate,
      }),
    onSuccess: () => {
      logger.info('Updated crop timing');
      setTimingCrop(null);
      if (activeTimingCrop?.id === linkedCropId) {
        setDismissedLinkedTimingId(activeTimingCrop.id);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['myCrops'] });
    },
  });

  const focusedCrop = myCrops?.find((crop) => crop.id === linkedCropId);
  const filteredCrops = useMemo(() => {
    if (!myCrops) return [];
    if (focusedCrop) return [focusedCrop];
    if (filter === 'all') return myCrops;
    return myCrops.filter((crop) => crop.status === filter);
  }, [myCrops, filter, focusedCrop]);

  const handleDelete = (crop: GrowerCropItem) => {
    if (
      confirm(
        `Remove "${crop.nickname || crop.cropName}" from your garden? This won't delete any food offers already shared.`
      )
    ) {
      deleteMutation.mutate(crop.id);
    }
  };

  const openShareDraft = (crop: GrowerCropItem, harvest?: HarvestItem) => {
    const params = new URLSearchParams({ crop: crop.id });
    if (harvest) {
      params.set('harvest', harvest.id);
      params.set('quantity', harvest.amount);
      params.set('unit', harvest.unit ?? crop.defaultUnit ?? 'lb');
      params.set('harvestedOn', harvest.harvestedOn);
    }
    navigate(`/share/listings?${params.toString()}`);
  };

  if (isLoadingCrops) {
    return (
      <Card>
        <div className="grn-page-status">
          <p>Loading your garden…</p>
        </div>
      </Card>
    );
  }

  if (cropsError && myCrops === undefined) {
    return (
      <Card padding="6">
        <div role="alert">
          <p>We could not refresh your plants. Try again to see your garden.</p>
          <Button onClick={() => { void retryCrops(); }}>Try again</Button>
        </div>
      </Card>
    );
  }

  const counts = {
    all: myCrops?.length ?? 0,
    growing: myCrops?.filter((c) => c.status === 'growing').length ?? 0,
    planning: myCrops?.filter((c) => c.status === 'planning').length ?? 0,
    interested: myCrops?.filter((c) => c.status === 'interested').length ?? 0,
  };

  if (!myCrops || myCrops.length === 0) {
    return (
      <Card padding="6">
        <div className="grn-crop-empty">
          <GardenScene name="first-garden" className="grn-crop-empty__art" />
          <h3>Your garden is a blank slate</h3>
          <p>
            Add your first crop and start mapping out beds, planting dates, and what you&apos;d like to grow.
          </p>
          <Button variant="primary" size="md" onClick={() => navigate(addCropPath)}>
            Add a crop
          </Button>
          {beds.length === 0 ? (
            <p className="grn-crop-empty__hint">
              You can also set up garden beds while adding your first crop.
            </p>
          ) : null}
        </div>
      </Card>
    );
  }

  return (
    <div className={`grn-crop-library ${focusedCrop ? 'grn-crop-library--focused' : ''}`}>
      {cropsError ? (
        <div className="grn-crop-journey__notice" role="alert">
          <p>We could not refresh your plants. Showing the last saved garden information.</p>
          <Button variant="ghost" size="sm" onClick={() => { void retryCrops(); }}>Try again</Button>
        </div>
      ) : null}
      <Card padding="6">
        <div className="grn-crop-library__head">
          <div>
            <h3 className="grn-crop-library__title">{focusedCrop ? focusedCrop.nickname || focusedCrop.cropName : 'My garden'}</h3>
            <p className="grn-crop-library__subtitle">
              {focusedCrop ? 'Plant details · timing, harvests, and care in one place' : `${counts.all} crop${counts.all === 1 ? '' : 's'} tracked`}
              {beds.length ? ` · ${beds.length} bed${beds.length === 1 ? '' : 's'}` : ''}
            </p>
          </div>
          <Button variant="primary" size="sm" onClick={() => navigate(addCropPath)}>
            + Add crop
          </Button>
        </div>

        {linkedCropId ? (
          <div className="grn-crop-journey__context">
            {!focusedCrop ? <p role="status">That plant is no longer in your garden. Your other plants are shown below.</p> : null}
            <Button variant="ghost" size="sm" onClick={() => {
              const next = new URLSearchParams(searchParams);
              ['crop', 'action', 'harvest'].forEach((key) => next.delete(key));
              setFilter('all');
              setSearchParams(next);
            }}>Back to all plants</Button>
          </div>
        ) : null}

        {!focusedCrop ? <div className="grn-crop-library__filters" role="tablist" aria-label="Filter crops by status">
          {([
            { id: 'all', label: 'All', count: counts.all },
            { id: 'growing', label: 'Growing', count: counts.growing },
            { id: 'planning', label: 'Planning', count: counts.planning },
            { id: 'interested', label: 'Interested', count: counts.interested },
          ] as const).map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={filter === tab.id}
              className={`grn-crop-library__tab ${filter === tab.id ? 'is-active' : ''}`.trim()}
              onClick={() => setFilter(tab.id)}
            >
              <span>{tab.label}</span>
              <span className="grn-crop-library__tab-count">{tab.count}</span>
            </button>
          ))}
        </div> : null}

        {filteredCrops.length === 0 ? <p role="status">No plants in this stage yet. Choose another filter to see the rest of your garden.</p> : null}
        <div className="grn-crop-grid">
          {filteredCrops.map((crop) => {
            const plantParams = new URLSearchParams(searchParams);
            plantParams.set('crop', crop.id);
            plantParams.delete('action');
            plantParams.delete('harvest');
            const visual = visualForCrop(crop.cropName, null);
            const status = STATUS_LABELS[crop.status] ?? STATUS_LABELS.interested;
            const planted = formatDate(crop.plantingDate);
            const harvest = formatDate(crop.expectedHarvestDate);
            const harvestIn = daysUntil(crop.expectedHarvestDate);
            const progress = harvestProgress(crop.plantingDate, crop.expectedHarvestDate);

            return (
              <article key={crop.id} id={`crop-${crop.id}`} className="grn-crop-card">
                <header
                  className="grn-crop-card__header"
                  style={{
                    background: `linear-gradient(135deg, ${visual.accent}33, ${visual.accent}10)`,
                  }}
                >
                  <span className="grn-crop-card__emoji" aria-hidden="true">
                    <CropArtwork iconKey={visual.iconKey} color={visual.accent} size="3.5rem" />
                  </span>
                  <span className={`grn-crop-card__status grn-crop-card__status--${status.tone}`}>
                    <span aria-hidden="true">{status.emoji}</span>
                    {status.label}
                  </span>
                </header>

                <div className="grn-crop-card__body">
                  <h4 className="grn-crop-card__name">
                    <Link to={{ pathname: '/garden/plants', search: `?${plantParams}` }}>
                      {crop.nickname || crop.cropName}
                    </Link>
                  </h4>
                  {crop.nickname ? (
                    <p className="grn-crop-card__subname">{crop.cropName}</p>
                  ) : null}

                  <ul className="grn-crop-card__facts">
                    {crop.bedName ? (
                      <li>
                        <span aria-hidden="true">🛏️</span>
                        <span>{crop.bedName}</span>
                      </li>
                    ) : null}
                    {planted ? (
                      <li>
                        <span aria-hidden="true">🌱</span>
                        <span>Planted {planted}</span>
                      </li>
                    ) : null}
                    {harvest ? (
                      <li>
                        <span aria-hidden="true">🌾</span>
                        <span>
                          Harvest {harvest}
                          {harvestIn !== null && harvestIn >= 0
                            ? ` · in ${harvestIn} day${harvestIn === 1 ? '' : 's'}`
                            : ''}
                        </span>
                      </li>
                    ) : null}
                    {crop.plantCount ? (
                      <li>
                        <span aria-hidden="true">🔢</span>
                        <span>
                          {crop.plantCount} plant{crop.plantCount === 1 ? '' : 's'}
                          {crop.spacingInches ? ` · ${crop.spacingInches}" apart` : ''}
                        </span>
                      </li>
                    ) : null}
                    {crop.surplusEnabled ? (
                      <li>
                        <span aria-hidden="true">🤝</span>
                        <span>Food sharing enabled</span>
                      </li>
                    ) : null}
                  </ul>

                  {progress !== null ? (
                    <div
                      className="grn-crop-card__progress"
                      role="progressbar"
                      aria-valuenow={progress}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label="Days planted vs days to harvest"
                    >
                      <span
                        className="grn-crop-card__progress-bar"
                        style={{ width: `${progress}%`, background: visual.accent }}
                      />
                    </div>
                  ) : null}

                  {focusedCrop && crop.notes ? <p className="grn-crop-journey__notes">{crop.notes}</p> : null}
                  {focusedCrop ? (
                    <nav className="grn-crop-journey__links" aria-label={`Care for ${crop.nickname || crop.cropName}`}>
                      <Link to={`/today/reminders?${new URLSearchParams({ new: 'true', title: `Check ${crop.nickname || crop.cropName}`, type: 'custom' })}`}>Add a care reminder</Link>
                      <Link to="/garden/journal">Open garden journal</Link>
                    </nav>
                  ) : null}

                  <label className="grn-crop-card__bed-field">
                    <span>Bed assignment</span>
                    <select
                      value={crop.bedId ?? ''}
                      aria-label={`Bed assignment for ${crop.nickname || crop.cropName}`}
                      disabled={bedMutation.isPending}
                      onChange={(event) =>
                        bedMutation.mutate({ crop, bedId: event.target.value || null })
                      }
                    >
                      <option value="">Not assigned</option>
                      {beds.map((bed) => (
                        <option key={bed.id} value={bed.id}>
                          {bed.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <footer className="grn-crop-card__footer">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => openShareDraft(crop)}
                  >
                    Share food
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setHarvestCrop(crop)}
                  >
                    Harvests
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      timingMutation.reset();
                      setTimingCrop(crop);
                    }}
                  >
                    Timing
                  </Button>
                  {crop.bedId ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const params = new URLSearchParams(searchParams);
                        params.set('bed', crop.bedId!);
                        params.set('crop', crop.id);
                        params.delete('action');
                        params.delete('harvest');
                        navigate(`/garden?${params}`);
                      }}
                    >
                      View on Map
                    </Button>
                  ) : null}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDelete(crop)}
                    disabled={deleteMutation.isPending}
                    className="grn-crop-card__remove"
                  >
                    Remove
                  </Button>
                </footer>
              </article>
            );
          })}
        </div>
      </Card>

      {bedUpdateError ? (
        <p className="grn-page-status__error" role="alert">
          {bedUpdateError}
        </p>
      ) : null}

      {activeHarvestCrop ? (
        <HarvestLogModal
          cropId={activeHarvestCrop.id}
          cropName={activeHarvestCrop.nickname || activeHarvestCrop.cropName}
          defaultUnit={activeHarvestCrop.defaultUnit}
          highlightedHarvestId={linkedHarvestId}
          onShareHarvest={(harvest) => openShareDraft(activeHarvestCrop, harvest)}
          onClose={() => {
            setHarvestCrop(null);
            if (activeHarvestCrop.id === linkedCropId) {
              setDismissedLinkedHarvestId(activeHarvestCrop.id);
            }
          }}
        />
      ) : null}

      {activeTimingCrop ? (
        <CropTimingModal
          crop={activeTimingCrop}
          isSaving={timingMutation.isPending}
          saveError={
            timingMutation.error instanceof Error
              ? timingMutation.error.message
              : timingMutation.isError
                ? 'Could not save crop timing.'
                : null
          }
          onSave={(dates) => timingMutation.mutate({ crop: activeTimingCrop, ...dates })}
          onClose={() => {
            setTimingCrop(null);
            timingMutation.reset();
            if (activeTimingCrop.id === linkedCropId) {
              setDismissedLinkedTimingId(activeTimingCrop.id);
            }
          }}
        />
      ) : null}
    </div>
  );
}

function cropUpdatePayload(
  crop: GrowerCropItem,
  bedId: string | null
): UpsertGrowerCropRequest {
  return {
    canonicalId: crop.canonicalId ?? undefined,
    cropName: crop.cropName,
    varietyId: crop.varietyId ?? undefined,
    status: crop.status,
    visibility: crop.visibility,
    surplusEnabled: crop.surplusEnabled,
    nickname: crop.nickname ?? undefined,
    defaultUnit: crop.defaultUnit ?? undefined,
    notes: crop.notes ?? undefined,
    bedId,
    plantingDate: crop.plantingDate,
    expectedHarvestDate: crop.expectedHarvestDate,
    plantCount: crop.plantCount,
    spacingInches: crop.spacingInches,
  };
}
