import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { PlantLoader } from '../components/branding/PlantLoader';
import { sceneMetrics } from '../components/GardenMasterplan/footprints';
import { IsoScene } from '../components/GardenMasterplan/IsoScene';
import { useMapViewport } from '../components/GardenMasterplan/useMapViewport';
import {
  fetchSharedGarden,
  type SharedGardenSnapshot,
} from '../services/api';
import type {
  GardenAnnotation,
  GardenBed,
  GardenCanvas,
  GrowerCropItem,
} from '../types/listing';

type LoadState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'error' }
  | { status: 'ready'; snapshot: SharedGardenSnapshot };

// The public payload is privacy-trimmed; widen it back to the full local
// types with neutral placeholders so the masterplan renderer can be
// reused untouched.
function toGardenBed(bed: SharedGardenSnapshot['beds'][number]): GardenBed {
  return {
    ...bed,
    userId: '',
    description: null,
    locationNotes: null,
    createdAt: '',
    updatedAt: '',
  };
}

function toGardenAnnotation(
  annotation: SharedGardenSnapshot['annotations'][number]
): GardenAnnotation {
  return {
    ...annotation,
    userId: '',
    createdAt: '',
    updatedAt: '',
  };
}

function toCropItem(
  crop: SharedGardenSnapshot['crops'][number],
  index: number
): GrowerCropItem {
  return {
    id: `shared-crop-${index}`,
    userId: '',
    canonicalId: null,
    cropName: crop.cropName,
    varietyId: null,
    status: 'growing',
    visibility: 'public',
    surplusEnabled: false,
    nickname: null,
    defaultUnit: null,
    notes: null,
    bedId: crop.bedId,
    bedName: null,
    plantingDate: null,
    expectedHarvestDate: null,
    plantCount: crop.plantCount,
    spacingInches: null,
    createdAt: '',
    updatedAt: '',
  };
}

/**
 * Public, read-only view of a shared garden — no auth shell, no editing.
 * Reachable at /shared/{token} for anyone holding the link.
 */
export function SharedGardenPage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    // A missing token renders not-found below without touching state.
    if (!token) return undefined;
    let cancelled = false;
    fetchSharedGarden(token)
      .then((snapshot) => {
        if (!cancelled) setState({ status: 'ready', snapshot });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const statusCode =
          error && typeof error === 'object' && 'statusCode' in error
            ? (error as { statusCode?: number }).statusCode
            : undefined;
        setState(statusCode === 404 ? { status: 'not-found' } : { status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (state.status === 'loading' && token) {
    return (
      <div className="grn-shared-page">
        <div className="grn-page-status">
          <PlantLoader size="md" />
          <p>Opening the garden…</p>
        </div>
      </div>
    );
  }

  if (state.status !== 'ready' || !token) {
    const notFound = state.status === 'not-found' || !token;
    return (
      <div className="grn-shared-page">
        <div className="grn-page-status">
          <h1 className="grn-shared-page__title">
            {notFound
              ? 'This garden link doesn’t exist or was turned off.'
              : 'We couldn’t load this garden right now.'}
          </h1>
          <p>
            {notFound
              ? 'Ask the gardener for a fresh link.'
              : 'Try refreshing the page in a moment.'}
          </p>
        </div>
      </div>
    );
  }

  return <SharedGardenView snapshot={state.snapshot} />;
}

function SharedGardenView({ snapshot }: { snapshot: SharedGardenSnapshot }) {
  const canvas: GardenCanvas = useMemo(
    () => ({
      id: 'shared',
      userId: '',
      widthInches: snapshot.canvas.widthInches,
      heightInches: snapshot.canvas.heightInches,
      backgroundImageKey: null,
      backgroundImageUrl: null,
      backgroundOpacity: 0,
      northOffsetDeg: snapshot.canvas.northOffsetDeg,
      createdAt: '',
      updatedAt: '',
    }),
    [snapshot.canvas]
  );

  const beds = useMemo(() => snapshot.beds.map(toGardenBed), [snapshot.beds]);
  const annotations = useMemo(
    () => snapshot.annotations.map(toGardenAnnotation),
    [snapshot.annotations]
  );
  const cropsByBedId = useMemo(() => {
    const map = new Map<string, GrowerCropItem[]>();
    snapshot.crops.forEach((crop, index) => {
      const item = toCropItem(crop, index);
      const existing = map.get(crop.bedId);
      if (existing) {
        existing.push(item);
      } else {
        map.set(crop.bedId, [item]);
      }
    });
    return map;
  }, [snapshot.crops]);

  const metrics = useMemo(() => sceneMetrics(canvas), [canvas]);
  const {
    containerRef,
    containerHandlers,
    contentStyle,
    zoomIn,
    zoomOut,
    fitToScreen,
    shouldIgnoreClick,
  } = useMapViewport(
    metrics.width,
    metrics.height,
    metrics.originX,
    metrics.originY
  );

  return (
    <div className="grn-shared-page">
      <header className="grn-shared-page__header">
        <h1 className="grn-shared-page__title">A shared garden</h1>
        <p className="grn-shared-page__subtitle">
          Made with the free Good Roots garden planner
        </p>
      </header>
      <div className="mp-explorer grn-shared-page__map">
        <div
          ref={containerRef}
          className="mp-explorer__viewport"
          {...containerHandlers}
        >
          <div className="mp-explorer__content" style={contentStyle}>
            <IsoScene
              canvas={canvas}
              beds={beds}
              annotations={annotations}
              cropsByBedId={cropsByBedId}
              selected={null}
              onSelect={() => {}}
              shouldIgnoreClick={shouldIgnoreClick}
            />
          </div>
          <div className="mp-explorer__zoom" role="group" aria-label="Map zoom controls">
            <button
              type="button"
              className="mp-explorer__zoom-btn"
              onClick={zoomIn}
              aria-label="Zoom in"
            >
              +
            </button>
            <button
              type="button"
              className="mp-explorer__zoom-btn"
              onClick={zoomOut}
              aria-label="Zoom out"
            >
              −
            </button>
            <button
              type="button"
              className="mp-explorer__zoom-btn mp-explorer__zoom-btn--fit"
              onClick={fitToScreen}
              aria-label="Fit garden to screen"
            >
              ⊡
            </button>
          </div>
          <p className="mp-explorer__hint" aria-hidden="true">
            Drag to explore · scroll to zoom
          </p>
        </div>
      </div>
    </div>
  );
}
