import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  createCheckoutSession,
  createRequest,
  discoverListings,
  getDerivedFeed,
  getEntitlements,
  getWeeklyGrowPlan,
  listCatalogCrops,
  updateRequest,
} from '../../services/api';
import { createClaim, updateClaimStatus } from '../../services/claims';
import type { Listing } from '../../types/listing';
import type { RequestItem, UpsertRequestPayload } from '../../types/request';
import type { Claim, ClaimStatus } from '../../types/claim';
import { createLogger } from '../../utils/logging';
import { Button, Card, Input } from '@olivias/ui';
import { ClaimStatusList } from './ClaimStatusList';
import {
  loadSessionClaims,
  saveSessionClaims,
  upsertSessionClaim,
} from '../../utils/claimSession';
import {
  enqueueCreateClaimAction,
  enqueueTransitionClaimAction,
  hasQueuedClaimActions,
  replayQueuedClaimActions,
  type ProcessedQueuedClaimAction,
} from '../../utils/claimOfflineQueue';

const logger = createLogger('searcher-requests');
const REQUEST_DRAFT_KEY = 'searcher-request-draft-v1';
const AI_OPT_OUT_KEY_PREFIX = 'ai-insights-opt-out';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface RequestDraft {
  cropId: string;
  varietyId: string;
  quantity: string;
  unit: string;
  neededByLocal: string;
  notes: string;
}

interface MatchingRequestResult {
  requestId?: string;
  ambiguous: boolean;
}

export interface SearcherRequestPanelProps {
  viewerUserId?: string;
  gathererGeoKey?: string;
  defaultLat?: number;
  defaultLng?: number;
  defaultRadiusMiles?: number;
}

function isFiniteCoordinate(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function distanceInMiles(fromLat: number, fromLng: number, toLat: number, toLng: number): number {
  const earthRadiusMiles = 3958.8;
  const dLat = toRadians(toLat - fromLat);
  const dLng = toRadians(toLng - fromLng);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(fromLat)) * Math.cos(toRadians(toLat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  return earthRadiusMiles * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function toDateTimeLocalValue(date: Date): string {
  const timezoneOffsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - timezoneOffsetMs).toISOString().slice(0, 16);
}

function parseRfc3339ToDateTimeLocal(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return createDefaultDraft().neededByLocal;
  }

  return toDateTimeLocalValue(parsed);
}

function createDefaultDraft(): RequestDraft {
  const nextDay = new Date(Date.now() + MS_PER_DAY);
  return {
    cropId: '',
    varietyId: '',
    quantity: '1',
    unit: '',
    neededByLocal: toDateTimeLocalValue(nextDay),
    notes: '',
  };
}

function loadRequestDraft(): RequestDraft {
  try {
    const serialized = window.localStorage.getItem(REQUEST_DRAFT_KEY);
    if (!serialized) {
      return createDefaultDraft();
    }

    const parsed = JSON.parse(serialized) as Partial<RequestDraft>;
    return {
      cropId: parsed.cropId ?? '',
      varietyId: parsed.varietyId ?? '',
      quantity: parsed.quantity ?? '1',
      unit: parsed.unit ?? '',
      neededByLocal: parsed.neededByLocal ?? createDefaultDraft().neededByLocal,
      notes: parsed.notes ?? '',
    };
  } catch {
    return createDefaultDraft();
  }
}

function loadAiOptOutPreference(viewerUserId?: string): boolean {
  try {
    const storageKey = `${AI_OPT_OUT_KEY_PREFIX}:${viewerUserId ?? 'anonymous'}`;
    return window.localStorage.getItem(storageKey) === 'true';
  } catch {
    return false;
  }
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

function validateNeededByWindow(value: Date): string | null {
  if (Number.isNaN(value.getTime())) {
    return 'Needed by must be a valid date and time.';
  }

  const now = new Date();
  if (value < now) {
    return 'Needed by must be in the future.';
  }

  const max = new Date(now.getTime() + 365 * MS_PER_DAY);
  if (value > max) {
    return 'Needed by must be within the next 365 days.';
  }

  return null;
}

function resolveDefaultClaimQuantity(listing: Listing): number {
  const remaining = Number(listing.quantityRemaining);
  if (!Number.isFinite(remaining) || remaining <= 0) {
    return 1;
  }

  return Math.min(1, remaining);
}

function getSearcherActions(status: ClaimStatus): ClaimStatus[] {
  if (status === 'pending') {
    return ['cancelled'];
  }

  if (status === 'confirmed') {
    return ['completed', 'cancelled'];
  }

  return [];
}

function makeLocalClaimId(): string {
  return `local-claim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isLocalClaimId(claimId: string): boolean {
  return claimId.startsWith('local-claim-');
}

function applyProcessedQueuedClaims(
  existingClaims: Claim[],
  processedActions: ProcessedQueuedClaimAction[]
): Claim[] {
  let next = [...existingClaims];

  for (const action of processedActions) {
    if (action.replaceClaimId && action.replaceClaimId !== action.claim.id) {
      next = next.filter((claim) => claim.id !== action.replaceClaimId);
    }

    next = upsertSessionClaim(next, action.claim);
  }

  return next;
}

function resolveMatchingRequestId(
  listing: Listing,
  sessionRequests: RequestItem[]
): MatchingRequestResult {
  const openRequests = sessionRequests.filter(
    (request) => request.status === 'open' && request.cropId === listing.cropId
  );

  if (openRequests.length === 0) {
    return { ambiguous: false };
  }

  if (listing.varietyId) {
    const varietyMatches = openRequests.filter((request) => request.varietyId === listing.varietyId);

    if (varietyMatches.length === 1) {
      return { requestId: varietyMatches[0].id, ambiguous: false };
    }

    if (varietyMatches.length > 1) {
      return { ambiguous: true };
    }
  }

  if (openRequests.length === 1) {
    return { requestId: openRequests[0].id, ambiguous: false };
  }

  return { ambiguous: true };
}

export function SearcherRequestPanel({
  viewerUserId,
  gathererGeoKey,
  defaultLat,
  defaultLng,
  defaultRadiusMiles = 15,
}: SearcherRequestPanelProps) {
  const [isOffline, setIsOffline] = useState<boolean>(() => !navigator.onLine);
  const [radiusMiles, setRadiusMiles] = useState<number>(defaultRadiusMiles);
  const [selectedCropId, setSelectedCropId] = useState<string>('all');
  const [selectedListingId, setSelectedListingId] = useState<string>('');
  const [draft, setDraft] = useState<RequestDraft>(() => loadRequestDraft());
  const [aiInsightsOptOut, setAiInsightsOptOut] = useState<boolean>(() =>
    loadAiOptOutPreference(viewerUserId)
  );
  const [isStartingUpgrade, setIsStartingUpgrade] = useState(false);
  const [sessionRequests, setSessionRequests] = useState<RequestItem[]>([]);
  const [sessionClaims, setSessionClaims] = useState<Claim[]>(() => loadSessionClaims(viewerUserId));
  const [editingRequestId, setEditingRequestId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimSuccessMessage, setClaimSuccessMessage] = useState<string | null>(null);
  const [transitioningClaimIds, setTransitioningClaimIds] = useState<string[]>([]);
  const [isReplayingClaimQueue, setIsReplayingClaimQueue] = useState<boolean>(false);

  const replayClaimQueue = useCallback(async () => {
    if (isOffline || isReplayingClaimQueue) {
      return;
    }

    if (!hasQueuedClaimActions(viewerUserId)) {
      return;
    }

    setIsReplayingClaimQueue(true);

    try {
      const result = await replayQueuedClaimActions({
        viewerUserId,
        createClaimHandler: createClaim,
        transitionClaimHandler: updateClaimStatus,
      });

      if (result.processed.length > 0) {
        setSessionClaims((current) => applyProcessedQueuedClaims(current, result.processed));
        setClaimSuccessMessage(
          `Synced ${result.processed.length} queued claim action${result.processed.length === 1 ? '' : 's'}.`
        );
      }

      if (result.failed.length > 0) {
        setClaimError('Some offline claim actions are still queued. They will retry when you reconnect.');
      }
    } finally {
      setIsReplayingClaimQueue(false);
    }
  }, [isOffline, isReplayingClaimQueue, viewerUserId]);

  useEffect(() => {
    const goOffline = () => setIsOffline(true);
    const goOnline = () => {
      setIsOffline(false);
      void replayClaimQueue();
    };

    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);

    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, [replayClaimQueue]);

  useEffect(() => {
    try {
      window.localStorage.setItem(REQUEST_DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // Ignore localStorage write failures in restricted environments.
    }
  }, [draft]);

  useEffect(() => {
    setAiInsightsOptOut(loadAiOptOutPreference(viewerUserId));
  }, [viewerUserId]);

  useEffect(() => {
    try {
      const storageKey = `${AI_OPT_OUT_KEY_PREFIX}:${viewerUserId ?? 'anonymous'}`;
      window.localStorage.setItem(storageKey, String(aiInsightsOptOut));
    } catch {
      // Ignore localStorage write failures in restricted environments.
    }
  }, [aiInsightsOptOut, viewerUserId]);

  useEffect(() => {
    saveSessionClaims(sessionClaims, viewerUserId);
  }, [sessionClaims, viewerUserId]);

  useEffect(() => {
    void replayClaimQueue();
  }, [replayClaimQueue]);

  const cropsQuery = useQuery({
    queryKey: ['catalogCrops'],
    queryFn: listCatalogCrops,
    staleTime: 10 * 60 * 1000,
  });

  const discoveryQuery = useQuery({
    queryKey: ['discoverListings', gathererGeoKey, radiusMiles],
    queryFn: () =>
      discoverListings({
        geoKey: gathererGeoKey ?? '',
        radiusMiles,
        limit: 30,
        offset: 0,
      }),
    enabled: Boolean(gathererGeoKey) && !isOffline,
    staleTime: 30 * 1000,
  });

  const entitlementsQuery = useQuery({
    queryKey: ['meEntitlements'],
    queryFn: getEntitlements,
    staleTime: 60 * 1000,
    retry: 1,
  });

  const hasProAiInsights =
    entitlementsQuery.data?.entitlements?.includes('ai.feed_insights.read') ?? false;

  const derivedFeedQuery = useQuery({
    queryKey: ['derivedFeed', gathererGeoKey],
    queryFn: () =>
      getDerivedFeed({
        geoKey: gathererGeoKey ?? '',
        windowDays: 7,
        limit: 20,
        offset: 0,
      }),
    enabled:
      Boolean(gathererGeoKey) && !isOffline && !aiInsightsOptOut && hasProAiInsights,
    staleTime: 30 * 1000,
  });

  const weeklyPlanQuery = useQuery({
    queryKey: ['weeklyGrowPlan', gathererGeoKey],
    queryFn: () => getWeeklyGrowPlan(gathererGeoKey ?? '', 7),
    enabled:
      Boolean(gathererGeoKey) && !isOffline && !aiInsightsOptOut && hasProAiInsights,
    staleTime: 60 * 1000,
  });

  const createRequestMutation = useMutation({
    mutationFn: (payload: UpsertRequestPayload) => createRequest(payload),
  });

  const updateRequestMutation = useMutation({
    mutationFn: ({ requestId, payload }: { requestId: string; payload: UpsertRequestPayload }) =>
      updateRequest(requestId, payload),
  });

  const createClaimMutation = useMutation({
    mutationFn: createClaim,
  });

  const transitionClaimMutation = useMutation({
    mutationFn: ({ claimId, status }: { claimId: string; status: ClaimStatus }) =>
      updateClaimStatus(claimId, { status }),
  });

  const isSubmitting = createRequestMutation.isPending || updateRequestMutation.isPending;
  const listings = useMemo(() => discoveryQuery.data?.items ?? [], [discoveryQuery.data?.items]);
  const pendingClaimIds = useMemo(() => new Set(transitioningClaimIds), [transitioningClaimIds]);

  const cropNameById = useMemo(() => {
    const byId = new Map<string, string>();
    for (const crop of cropsQuery.data ?? []) {
      byId.set(crop.id, crop.commonName);
    }
    return byId;
  }, [cropsQuery.data]);

  const filteredListings = useMemo(() => {
    if (selectedCropId === 'all') {
      return listings;
    }

    return listings.filter((listing) => listing.cropId === selectedCropId);
  }, [listings, selectedCropId]);

  const selectedListing = useMemo(
    () => filteredListings.find((listing) => listing.id === selectedListingId) ?? null,
    [filteredListings, selectedListingId]
  );

  const marketSnapshot = useMemo(() => {
    const signals = derivedFeedQuery.data?.signals ?? [];
    if (signals.length === 0) {
      return null;
    }

    const scarce = [...signals]
      .sort((left, right) => right.scarcityScore - left.scarcityScore)
      .slice(0, 3);
    const abundant = [...signals]
      .sort((left, right) => right.abundanceScore - left.abundanceScore)
      .slice(0, 3);

    return { scarce, abundant };
  }, [derivedFeedQuery.data?.signals]);

  const sortedListings = useMemo(() => {
    if (!isFiniteCoordinate(defaultLat) || !isFiniteCoordinate(defaultLng)) {
      return filteredListings;
    }

    return [...filteredListings].sort((left, right) => {
      const leftHasCoordinates = Number.isFinite(left.lat) && Number.isFinite(left.lng);
      const rightHasCoordinates = Number.isFinite(right.lat) && Number.isFinite(right.lng);

      if (!leftHasCoordinates && !rightHasCoordinates) {
        return 0;
      }
      if (!leftHasCoordinates) {
        return 1;
      }
      if (!rightHasCoordinates) {
        return -1;
      }

      const leftDistance = distanceInMiles(defaultLat, defaultLng, left.lat, left.lng);
      const rightDistance = distanceInMiles(defaultLat, defaultLng, right.lat, right.lng);
      return leftDistance - rightDistance;
    });
  }, [defaultLat, defaultLng, filteredListings]);

  const visibleClaims = useMemo(
    () => sessionClaims.filter((claim) => (viewerUserId ? claim.claimerId === viewerUserId : true)),
    [sessionClaims, viewerUserId]
  );

  const handleSelectListing = (listing: Listing) => {
    setSelectedListingId(listing.id);
    setDraft((previous) => ({
      ...previous,
      cropId: listing.cropId,
      varietyId: listing.varietyId ?? '',
      unit: previous.unit || listing.unit,
    }));
    setSubmitError(null);
    setSuccessMessage(null);
    setClaimError(null);
    setClaimSuccessMessage(null);
  };

  const handleStartEditing = (request: RequestItem) => {
    setEditingRequestId(request.id);
    setSelectedListingId('');
    setDraft({
      cropId: request.cropId,
      varietyId: request.varietyId ?? '',
      quantity: request.quantity,
      unit: request.unit ?? '',
      neededByLocal: parseRfc3339ToDateTimeLocal(request.neededBy),
      notes: request.notes ?? '',
    });
    setSubmitError(null);
    setSuccessMessage(null);
  };

  const handleCancelEdit = () => {
    setEditingRequestId(null);
    setSubmitError(null);
    setSuccessMessage(null);
    setDraft(createDefaultDraft());
  };

  const handleStartUpgrade = async () => {
    try {
      setIsStartingUpgrade(true);
      const origin = window.location.origin;
      const session = await createCheckoutSession({
        successUrl: `${origin}/?upgrade=success`,
        cancelUrl: `${origin}/?upgrade=cancelled`,
      });
      window.location.assign(session.checkoutUrl);
    } catch (error) {
      logger.error(
        `Failed to start pro upgrade checkout: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    } finally {
      setIsStartingUpgrade(false);
    }
  };

  const handleSubmit = async () => {
    setSubmitError(null);
    setSuccessMessage(null);

    if (isOffline) {
      setSubmitError('You are offline. Reconnect to submit requests.');
      return;
    }

    const quantity = Number(draft.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setSubmitError('Quantity must be greater than 0.');
      return;
    }

    const neededByDate = new Date(draft.neededByLocal);
    const neededByValidationError = validateNeededByWindow(neededByDate);
    if (neededByValidationError) {
      setSubmitError(neededByValidationError);
      return;
    }

    const cropId = selectedListing?.cropId ?? draft.cropId;
    if (!cropId) {
      setSubmitError('Choose a listing or crop before submitting your request.');
      return;
    }

    const resolvedVarietyId = selectedListing?.varietyId ?? draft.varietyId;

    const payload: UpsertRequestPayload = {
      cropId,
      varietyId: resolvedVarietyId || undefined,
      unit: draft.unit.trim() || selectedListing?.unit || undefined,
      quantity,
      neededBy: neededByDate.toISOString(),
      notes: draft.notes.trim() || undefined,
      status: 'open',
    };

    try {
      if (editingRequestId) {
        const updated = await updateRequestMutation.mutateAsync({ requestId: editingRequestId, payload });
        setSessionRequests((previous) =>
          previous.map((request) => (request.id === updated.id ? updated : request))
        );
        setSuccessMessage('Request updated.');
        logger.info('Request updated', { requestId: updated.id });
        setEditingRequestId(null);
      } else {
        const created = await createRequestMutation.mutateAsync(payload);
        setSessionRequests((previous) => [created, ...previous]);
        setSuccessMessage('Request submitted.');
        logger.info('Request created', { requestId: created.id, cropId: created.cropId });
      }

      setDraft(createDefaultDraft());
      setSelectedListingId('');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to submit request';
      setSubmitError(message);
      logger.error('Request submission failed', error as Error);
    }
  };

  const handleCreateClaim = async (listing: Listing) => {
    setClaimError(null);
    setClaimSuccessMessage(null);

    const requestMatch = resolveMatchingRequestId(listing, sessionRequests);
    if (requestMatch.ambiguous) {
      setClaimError('Multiple open requests match this listing. Claim will be created without linking to a request.');
    }

    const payload = {
      listingId: listing.id,
      requestId: requestMatch.requestId,
      quantityClaimed: resolveDefaultClaimQuantity(listing),
    };

    if (isOffline) {
      const localClaimId = makeLocalClaimId();
      const localClaim: Claim = {
        id: localClaimId,
        listingId: listing.id,
        requestId: requestMatch.requestId ?? null,
        claimerId: viewerUserId ?? 'unknown-claimer',
        listingOwnerId: listing.userId,
        quantityClaimed: String(payload.quantityClaimed),
        status: 'pending',
        notes: null,
        claimedAt: new Date().toISOString(),
        confirmedAt: null,
        completedAt: null,
        cancelledAt: null,
      };

      setSessionClaims((previous) => upsertSessionClaim(previous, localClaim));
      enqueueCreateClaimAction(payload, localClaimId, viewerUserId);
      setClaimSuccessMessage('You are offline. Claim was queued and will sync when you reconnect.');
      return;
    }

    try {
      const createdClaim = await createClaimMutation.mutateAsync(payload);

      setSessionClaims((previous) => upsertSessionClaim(previous, createdClaim));
      setClaimSuccessMessage('Claim submitted.');
      logger.info('Claim created', { claimId: createdClaim.id, listingId: createdClaim.listingId });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create claim';
      setClaimError(message);
      logger.error('Claim creation failed', error as Error);
    }
  };

  const handleClaimTransition = async (claimId: string, status: ClaimStatus) => {
    setClaimError(null);
    setClaimSuccessMessage(null);

    let didStart = false;
    setTransitioningClaimIds((current) => {
      if (current.includes(claimId)) {
        return current;
      }

      didStart = true;
      return [...current, claimId];
    });

    if (!didStart) {
      return;
    }

    const previousClaim = sessionClaims.find((claim) => claim.id === claimId) ?? null;

    setSessionClaims((current) =>
      current.map((claim) => (claim.id === claimId ? { ...claim, status } : claim))
    );

    try {
      if (isOffline) {
        enqueueTransitionClaimAction(claimId, { status }, viewerUserId);
        setClaimSuccessMessage('You are offline. Claim transition was queued and will sync when you reconnect.');
        return;
      }

      const resolvedClaimId = isLocalClaimId(claimId) ? previousClaim?.id : claimId;
      if (!resolvedClaimId || isLocalClaimId(resolvedClaimId)) {
        throw new Error('Claim is not synced yet. Reconnect to sync queued actions first.');
      }

      const updated = await transitionClaimMutation.mutateAsync({ claimId: resolvedClaimId, status });
      setSessionClaims((current) => upsertSessionClaim(current, updated));
      setClaimSuccessMessage('Claim updated.');
      logger.info('Claim updated', { claimId: updated.id, status: updated.status });
    } catch (error) {
      if (previousClaim) {
        setSessionClaims((current) =>
          current.map((claim) => (claim.id === claimId ? previousClaim : claim))
        );
      }

      const message = error instanceof Error ? error.message : 'Failed to update claim';
      setClaimError(message);
      logger.error('Claim transition failed', error as Error);
    } finally {
      setTransitioningClaimIds((current) => current.filter((id) => id !== claimId));
    }
  };

  if (!gathererGeoKey) {
    return (
      <Card className="space-y-3" padding="6">
        <h3 className="text-lg font-semibold text-neutral-900">Search and request</h3>
        <p className="text-sm text-neutral-700">
          Add your location in onboarding to start discovering nearby listings.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-4" padding="6">
        <div className="space-y-1">
          <h3 className="text-lg font-semibold text-neutral-900">Find food near you</h3>
          <p className="text-sm text-neutral-600">
            Discovery uses your local geohash context so results stay nearby and practical.
          </p>
        </div>

        {isOffline && (
          <p className="rounded-base border border-warning bg-accent-50 px-3 py-2 text-sm text-neutral-800" role="status">
            You are offline. Cached content may still appear, but requests cannot be submitted.
          </p>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Input
            label="Radius (miles)"
            type="text"
            value={String(radiusMiles)}
            onChange={(event) => {
              const nextValue = Number(event.target.value);
              if (Number.isFinite(nextValue) && nextValue > 0) {
                setRadiusMiles(nextValue);
              }
            }}
          />

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-neutral-700" htmlFor="searcher-crop-filter">
              Crop filter
            </label>
            <select
              id="searcher-crop-filter"
              value={selectedCropId}
              onChange={(event) => setSelectedCropId(event.target.value)}
              className="w-full rounded-base border-2 border-neutral-300 bg-white px-3 py-2 text-base text-neutral-800"
            >
              <option value="all">All crops</option>
              {(cropsQuery.data ?? []).map((crop) => (
                <option key={crop.id} value={crop.id}>
                  {crop.commonName}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-end">
            <Button
              variant="outline"
              fullWidth
              onClick={() => discoveryQuery.refetch()}
              disabled={isOffline || discoveryQuery.isFetching}
            >
              Refresh Listings
            </Button>
          </div>
        </div>
      </Card>

      <Card className="space-y-4" padding="6">
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <h4 className="text-base font-semibold text-neutral-900">AI-assisted insights</h4>
              <p className="text-sm text-neutral-600">
                Optional summaries are labeled as AI-assisted and can be turned off any time.
              </p>
            </div>
            {hasProAiInsights ? (
              <label className="inline-flex items-center gap-2 text-sm text-neutral-700">
                <input
                  type="checkbox"
                  checked={!aiInsightsOptOut}
                  onChange={(event) => setAiInsightsOptOut(!event.target.checked)}
                  aria-label="Show AI-assisted insights"
                />
                Show AI insights
              </label>
            ) : (
              <Button
                onClick={() => void handleStartUpgrade()}
                variant="primary"
                disabled={isStartingUpgrade}
              >
                {isStartingUpgrade ? 'Opening checkout...' : 'Unlock Pro AI'}
              </Button>
            )}
          </div>

          <p className="text-xs text-neutral-500">
            We only show AI-generated summary text for Pro accounts when enabled. Core listing and request flows always remain available.
          </p>
        </div>

        {!hasProAiInsights && (
          <p className="rounded-base border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700" role="status">
            AI insights are a Pro feature. Upgrade to unlock personalized weekly guidance.
          </p>
        )}

        {hasProAiInsights && aiInsightsOptOut && (
          <p className="rounded-base border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700" role="status">
            AI insights are off for this account on this device.
          </p>
        )}

        {hasProAiInsights && !aiInsightsOptOut && derivedFeedQuery.isLoading && (
          <p className="text-sm text-neutral-600" role="status">Loading AI insights...</p>
        )}

        {hasProAiInsights && !aiInsightsOptOut && derivedFeedQuery.isError && (
          <p className="rounded-base border border-warning bg-accent-50 px-3 py-2 text-sm text-neutral-800" role="status">
            AI insights are temporarily unavailable. You can still discover listings and submit requests.
          </p>
        )}

        {hasProAiInsights && !aiInsightsOptOut && derivedFeedQuery.data?.aiSummary && (
          <div className="rounded-base border border-primary-200 bg-primary-50 px-3 py-3" data-testid="ai-summary-card">
            <div className="mb-2 inline-flex items-center rounded-full border border-primary-300 bg-white px-2 py-0.5 text-xs font-medium text-primary-700">
              AI-assisted
            </div>
            <p className="text-sm text-neutral-800">{derivedFeedQuery.data.aiSummary.summaryText}</p>
            <p className="mt-2 text-xs text-neutral-600">
              Model: {derivedFeedQuery.data.aiSummary.modelId} Â· Generated {formatDateTime(derivedFeedQuery.data.aiSummary.generatedAt)}
            </p>
          </div>
        )}

        {hasProAiInsights && !aiInsightsOptOut && weeklyPlanQuery.data?.recommendations?.length ? (
          <div className="rounded-base border border-primary-300 bg-white px-3 py-3" data-testid="weekly-plan-cards">
            <div className="mb-2 inline-flex items-center rounded-full border border-primary-300 bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">
              Pro AI plan
            </div>
            <ul className="space-y-2">
              {weeklyPlanQuery.data.recommendations.slice(0, 2).map((rec, index) => (
                <li key={`weekly-plan-${index}`} className="rounded-md border border-neutral-200 px-3 py-2">
                  <p className="text-sm text-neutral-900">{rec.recommendation}</p>
                  <p className="mt-1 text-xs text-neutral-600">
                    Confidence {(rec.confidence * 100).toFixed(0)}% Â· {rec.rationale[0] ?? 'Local signal based'}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {hasProAiInsights && !aiInsightsOptOut && marketSnapshot && (
          <div className="rounded-base border border-neutral-200 bg-white px-3 py-3" data-testid="market-snapshot-card">
            <h5 className="text-sm font-semibold text-neutral-900">Market snapshot (last 7 days)</h5>
            <p className="mt-1 text-xs text-neutral-600">
              Use this as a quick signal: what seems scarce vs abundant near you.
            </p>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-warning">Likely scarce</p>
                <ul className="space-y-1 text-sm text-neutral-800">
                  {marketSnapshot.scarce.map((signal) => (
                    <li key={`scarce-${signal.geoBoundaryKey}-${signal.cropId ?? 'all'}`} className="flex items-center justify-between gap-3">
                      <span>{signal.cropId ? (cropNameById.get(signal.cropId) ?? 'Local crop') : 'Mixed crops'}</span>
                      <span className="text-xs text-neutral-600">scarcity {(signal.scarcityScore * 100).toFixed(0)}%</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-success">Likely abundant</p>
                <ul className="space-y-1 text-sm text-neutral-800">
                  {marketSnapshot.abundant.map((signal) => (
                    <li key={`abundant-${signal.geoBoundaryKey}-${signal.cropId ?? 'all'}`} className="flex items-center justify-between gap-3">
                      <span>{signal.cropId ? (cropNameById.get(signal.cropId) ?? 'Local crop') : 'Mixed crops'}</span>
                      <span className="text-xs text-neutral-600">abundance {(signal.abundanceScore * 100).toFixed(0)}%</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}
      </Card>

      <Card className="space-y-4" padding="6">
        <div className="space-y-1">
          <h4 className="text-base font-semibold text-neutral-900">Available listings</h4>
          <p className="text-sm text-neutral-600">
            Select a listing to prefill your request form.
          </p>
        </div>

        {discoveryQuery.isLoading && (
          <p className="text-sm text-neutral-600" role="status">Loading listings...</p>
        )}

        {discoveryQuery.isError && (
          <p className="rounded-base border border-error bg-red-50 px-3 py-2 text-sm text-error" role="alert">
            {discoveryQuery.error instanceof Error ? discoveryQuery.error.message : 'Failed to load listings'}
          </p>
        )}

        {!discoveryQuery.isLoading && !discoveryQuery.isError && sortedListings.length === 0 && (
          <p className="text-sm text-neutral-600">No listings found in this area yet. Try a wider radius.</p>
        )}

        {sortedListings.map((listing) => {
          const canShowDistance =
            isFiniteCoordinate(defaultLat) &&
            isFiniteCoordinate(defaultLng) &&
            Number.isFinite(listing.lat) &&
            Number.isFinite(listing.lng);

          const distanceLabel = canShowDistance
            ? `${distanceInMiles(defaultLat, defaultLng, listing.lat, listing.lng).toFixed(1)} mi away`
            : null;

          return (
            <div
              key={listing.id}
              className={`rounded-base border px-3 py-3 ${
                selectedListingId === listing.id
                  ? 'border-primary-500 bg-primary-50'
                  : 'border-neutral-200 bg-white'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="font-medium text-neutral-900">{listing.title || 'Untitled listing'}</p>
                  <p className="text-sm text-neutral-700">
                    {listing.quantityRemaining} {listing.unit} available
                  </p>
                  <p className="text-xs text-neutral-600">
                    Crop: {cropNameById.get(listing.cropId) ?? listing.cropId}
                  </p>
                  {distanceLabel && <p className="text-xs text-neutral-500">{distanceLabel}</p>}
                </div>
                <div className="flex flex-col gap-2">
                  <Button size="sm" variant="ghost" onClick={() => handleSelectListing(listing)}>
                    Request this item
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    loading={createClaimMutation.isPending}
                    onClick={() => handleCreateClaim(listing)}
                  >
                    Claim this listing
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </Card>

      <Card className="space-y-4" padding="6">
        <div className="space-y-1">
          <h4 className="text-base font-semibold text-neutral-900">
            {editingRequestId ? 'Edit request' : 'Create request'}
          </h4>
          <p className="text-sm text-neutral-600">
            Submit a request with quantity and needed-by timing in one step.
          </p>
        </div>

        {selectedListing && (
          <p className="rounded-base border border-primary-200 bg-primary-50 px-3 py-2 text-sm text-primary-800" role="status">
            Requesting from: {selectedListing.title || 'Untitled listing'}
          </p>
        )}

        {successMessage && (
          <p className="rounded-base border border-success bg-primary-50 px-3 py-2 text-sm text-primary-800" role="status">
            {successMessage}
          </p>
        )}

        {submitError && (
          <p className="rounded-base border border-error bg-red-50 px-3 py-2 text-sm text-error" role="alert">
            {submitError}
          </p>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1 sm:col-span-2">
            <label className="text-sm font-medium text-neutral-700" htmlFor="request-crop-id">
              Crop
            </label>
            <select
              id="request-crop-id"
              value={selectedListing ? selectedListing.cropId : draft.cropId}
              onChange={(event) => {
                setSelectedListingId('');
                setDraft((previous) => ({
                  ...previous,
                  cropId: event.target.value,
                  varietyId: '',
                }));
              }}
              className="w-full rounded-base border-2 border-neutral-300 bg-white px-3 py-2 text-base text-neutral-800"
            >
              <option value="">Select crop</option>
              {(cropsQuery.data ?? []).map((crop) => (
                <option key={crop.id} value={crop.id}>
                  {crop.commonName}
                </option>
              ))}
            </select>
          </div>

          <Input
            label="Quantity"
            type="text"
            value={draft.quantity}
            onChange={(event) => setDraft((previous) => ({ ...previous, quantity: event.target.value }))}
          />

          <Input
            label="Unit"
            type="text"
            value={draft.unit}
            onChange={(event) => setDraft((previous) => ({ ...previous, unit: event.target.value }))}
            placeholder="lb, bunch, box"
          />

          <div className="sm:col-span-2 flex flex-col gap-1">
            <label className="text-sm font-medium text-neutral-700" htmlFor="request-needed-by">
              Needed by
            </label>
            <input
              id="request-needed-by"
              type="datetime-local"
              value={draft.neededByLocal}
              onChange={(event) =>
                setDraft((previous) => ({ ...previous, neededByLocal: event.target.value }))
              }
              className="w-full rounded-base border-2 border-neutral-300 bg-white px-3 py-2 text-base text-neutral-800"
            />
          </div>

          <div className="sm:col-span-2 flex flex-col gap-1">
            <label className="text-sm font-medium text-neutral-700" htmlFor="request-notes">
              Notes (optional)
            </label>
            <textarea
              id="request-notes"
              value={draft.notes}
              onChange={(event) => setDraft((previous) => ({ ...previous, notes: event.target.value }))}
              rows={3}
              className="w-full rounded-base border-2 border-neutral-300 bg-white px-3 py-2 text-base text-neutral-800"
              placeholder="Pickup windows, organization context, or constraints"
            />
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button onClick={handleSubmit} loading={isSubmitting} fullWidth>
            {editingRequestId ? 'Update Request' : 'Create Request'}
          </Button>
          {editingRequestId && (
            <Button variant="ghost" onClick={handleCancelEdit} fullWidth>
              Cancel Edit
            </Button>
          )}
        </div>
      </Card>

      <ClaimStatusList
        title="My claim coordination"
        description="Track your claim states and apply only valid transitions."
        claims={visibleClaims}
        pendingClaimIds={pendingClaimIds}
        successMessage={claimSuccessMessage}
        errorMessage={claimError}
        emptyMessage="No claims tracked in this session yet."
        getActions={(claim) => getSearcherActions(claim.status)}
        onTransition={handleClaimTransition}
      />

      <Card className="space-y-3" padding="6">
        <h4 className="text-base font-semibold text-neutral-900">Requests this session</h4>

        {sessionRequests.length === 0 && (
          <p className="text-sm text-neutral-600">No requests submitted in this session yet.</p>
        )}

        {sessionRequests.map((request) => (
          <div key={request.id} className="rounded-base border border-neutral-200 bg-white px-3 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="font-medium text-neutral-900">
                  {cropNameById.get(request.cropId) ?? request.cropId}
                </p>
                <p className="text-sm text-neutral-700">
                  {request.quantity} {request.unit ?? ''} needed by {formatDateTime(request.neededBy)}
                </p>
                <p className="text-xs text-neutral-600">Status: {request.status}</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => handleStartEditing(request)}>
                Edit request
              </Button>
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}

export default SearcherRequestPanel;

