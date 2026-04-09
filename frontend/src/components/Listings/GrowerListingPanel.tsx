import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createListing,
  getMyListing,
  listCatalogCrops,
  listCatalogVarieties,
  listMyCrops,
  listMyListings,
  updateListing,
} from '../../services/api';
import { createClaim, updateClaimStatus } from '../../services/claims';
import type { Listing, UpsertListingRequest } from '../../types/listing';
import type { Claim, ClaimStatus } from '../../types/claim';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { ListingForm, type ListingQuickPickOption } from './ListingForm';
import { createLogger } from '../../utils/logging';
import { ClaimStatusList } from './ClaimStatusList';
import {
  loadSessionClaims,
  saveSessionClaims,
  upsertSessionClaim,
} from '../../utils/claimSession';
import {
  enqueueTransitionClaimAction,
  hasQueuedClaimActions,
  replayQueuedClaimActions,
  type ProcessedQueuedClaimAction,
} from '../../utils/claimOfflineQueue';

const logger = createLogger('grower-listings');

type ListingsView = 'create' | 'my-listings' | 'discovery';
type MyListingsFilter = 'all' | 'active' | 'expired' | 'completed';

interface GrowerListingPanelProps {
  viewerUserId?: string;
  defaultLat?: number;
  defaultLng?: number;
}

const quickPickRank: Record<string, number> = {
  growing: 0,
  planning: 1,
  interested: 2,
  paused: 3,
};

const statusStyles: Record<string, string> = {
  active: 'border-success bg-primary-50 text-primary-800',
  pending: 'border-warning bg-accent-50 text-neutral-800',
  claimed: 'border-neutral-300 bg-neutral-100 text-neutral-800',
  expired: 'border-neutral-300 bg-neutral-100 text-neutral-700',
  completed: 'border-neutral-300 bg-neutral-100 text-neutral-700',
};

const filterOptions: Array<{ value: MyListingsFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'expired', label: 'Expired' },
  { value: 'completed', label: 'Completed' },
];

function formatStatus(status: string): string {
  if (!status) {
    return 'Unknown';
  }

  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Unknown';
  }

  return parsed.toLocaleString();
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function distanceInKm(fromLat: number, fromLng: number, toLat: number, toLng: number): number {
  const earthRadiusKm = 6371;
  const dLat = toRadians(toLat - fromLat);
  const dLng = toRadians(toLng - fromLng);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(fromLat)) * Math.cos(toRadians(toLat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function isFiniteCoordinate(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function getGrowerActions(status: ClaimStatus): ClaimStatus[] {
  if (status === 'pending') {
    return ['confirmed', 'cancelled'];
  }

  if (status === 'confirmed') {
    return ['completed', 'cancelled'];
  }

  return [];
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

function ListingStatusChip({ status }: { status: string }) {
  const tone = statusStyles[status] ?? 'border-neutral-300 bg-neutral-100 text-neutral-800';

  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${tone}`}>
      {formatStatus(status)}
    </span>
  );
}

function ListingDetails({ listing }: { listing: Listing }) {
  return (
    <div className="rounded-base border border-neutral-200 bg-white px-4 py-4">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-base font-semibold text-neutral-900">Listing details</h4>
        <ListingStatusChip status={listing.status} />
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-2 text-sm text-neutral-700">
        <div>
          <dt className="font-medium text-neutral-900">Title</dt>
          <dd>{listing.title}</dd>
        </div>
        <div>
          <dt className="font-medium text-neutral-900">Quantity remaining</dt>
          <dd>{listing.quantityRemaining} {listing.unit}</dd>
        </div>
        <div>
          <dt className="font-medium text-neutral-900">Pickup window</dt>
          <dd>{formatDateTime(listing.availableStart)} to {formatDateTime(listing.availableEnd)}</dd>
        </div>
        <div>
          <dt className="font-medium text-neutral-900">Pickup location</dt>
          <dd>{listing.pickupLocationText ?? 'Not provided'}</dd>
        </div>
      </dl>
    </div>
  );
}

export function GrowerListingPanel({ viewerUserId, defaultLat, defaultLng }: GrowerListingPanelProps) {
  const queryClient = useQueryClient();
  const [isOffline, setIsOffline] = useState<boolean>(() => !navigator.onLine);
  const [selectedCropId, setSelectedCropId] = useState<string>('');
  const [editingListingId, setEditingListingId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ListingsView>('create');
  const [myListingsFilter, setMyListingsFilter] = useState<MyListingsFilter>('all');
  const [selectedListingId, setSelectedListingId] = useState<string | null>(null);
  const [sessionClaims, setSessionClaims] = useState<Claim[]>(() => loadSessionClaims(viewerUserId));
  const [claimSuccessMessage, setClaimSuccessMessage] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
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

  const cropsQuery = useQuery({
    queryKey: ['catalogCrops'],
    queryFn: listCatalogCrops,
    staleTime: 10 * 60 * 1000,
  });

  const growerCropsQuery = useQuery({
    queryKey: ['myCrops'],
    queryFn: listMyCrops,
    staleTime: 5 * 60 * 1000,
  });

  const myListingsStatus = myListingsFilter === 'all' ? undefined : myListingsFilter;
  const isMyListingsViewActive = activeView === 'my-listings';
  const isDiscoveryViewActive = activeView === 'discovery';

  const myListingsQuery = useQuery({
    queryKey: ['myListings', myListingsStatus],
    queryFn: () => listMyListings(50, 0, myListingsStatus),
    staleTime: 30 * 1000,
    enabled: isMyListingsViewActive,
  });

  const discoveryQuery = useQuery({
    queryKey: ['myListingsDiscovery'],
    queryFn: () => listMyListings(50, 0, 'active'),
    staleTime: 30 * 1000,
    enabled: isDiscoveryViewActive,
  });

  const editListingQuery = useQuery({
    queryKey: ['myListing', editingListingId],
    queryFn: () => getMyListing(editingListingId ?? ''),
    enabled: !!editingListingId,
  });

  const detailListingQuery = useQuery({
    queryKey: ['myListingDetail', selectedListingId],
    queryFn: () => getMyListing(selectedListingId ?? ''),
    enabled: !!selectedListingId,
  });

  const createMutation = useMutation({
    mutationFn: (request: UpsertListingRequest) => createListing(request),
  });

  const updateMutation = useMutation({
    mutationFn: ({ listingId, request }: { listingId: string; request: UpsertListingRequest }) =>
      updateListing(listingId, request),
  });

  const transitionClaimMutation = useMutation({
    mutationFn: ({ claimId, status }: { claimId: string; status: ClaimStatus }) =>
      updateClaimStatus(claimId, { status }),
  });

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
    saveSessionClaims(sessionClaims, viewerUserId);
  }, [sessionClaims, viewerUserId]);

  useEffect(() => {
    void replayClaimQueue();
  }, [replayClaimQueue]);

  const activeEditListing: Listing | null = useMemo(() => {
    if (!editingListingId) {
      return null;
    }

    if (editListingQuery.data) {
      return editListingQuery.data;
    }

    return myListingsQuery.data?.items.find((listing) => listing.id === editingListingId) ?? null;
  }, [editingListingId, editListingQuery.data, myListingsQuery.data?.items]);

  const isEditingListingLoading =
    editingListingId !== null && editListingQuery.isLoading && activeEditListing === null;

  const varietiesCropId = selectedCropId || activeEditListing?.cropId || '';

  const varietiesQuery = useQuery({
    queryKey: ['catalogVarieties', varietiesCropId],
    queryFn: () => listCatalogVarieties(varietiesCropId),
    enabled: varietiesCropId.length > 0,
  });

  const listingFormKey = useMemo(() => {
    if (!activeEditListing) {
      return `create:${defaultLat ?? ''}:${defaultLng ?? ''}`;
    }

    return [
      'edit',
      activeEditListing.id,
      activeEditListing.title,
      activeEditListing.cropId,
      activeEditListing.varietyId ?? '',
      activeEditListing.quantityTotal,
      activeEditListing.unit,
      activeEditListing.availableStart,
      activeEditListing.availableEnd,
      activeEditListing.lat,
      activeEditListing.lng,
      activeEditListing.pickupLocationText ?? '',
      activeEditListing.pickupNotes ?? '',
    ].join(':');
  }, [activeEditListing, defaultLat, defaultLng]);

  const isSubmitting = createMutation.isPending || updateMutation.isPending;
  const pendingClaimIds = useMemo(() => new Set(transitioningClaimIds), [transitioningClaimIds]);

  const cropNameById = useMemo(() => {
    const byId = new Map<string, string>();
    for (const crop of cropsQuery.data ?? []) {
      byId.set(crop.id, crop.commonName);
    }
    return byId;
  }, [cropsQuery.data]);

  const quickPickOptions = useMemo<ListingQuickPickOption[]>(() => {
    const items = growerCropsQuery.data ?? [];

    return [...items]
      .sort((left, right) => {
        const leftRank = quickPickRank[left.status] ?? 99;
        const rightRank = quickPickRank[right.status] ?? 99;
        return leftRank - rightRank;
      })
      .map((item) => {
        // Use catalog name if available, otherwise use the stored crop name
        const cropName = item.canonicalId ? (cropNameById.get(item.canonicalId) ?? 'Unknown crop') : item.cropName;
        const baseTitle = item.nickname?.trim() || cropName;
        const statusTag = item.status === 'growing' ? '' : ` (${item.status})`;

        return {
          id: item.id,
          label: `${baseTitle}${statusTag}`,
          cropId: item.canonicalId || '',  // Empty string for user-defined crops
          growerCropId: item.id,  // Include the grower crop library ID
          varietyId: item.varietyId ?? undefined,
          defaultUnit: item.defaultUnit ?? undefined,
          suggestedTitle: baseTitle,
        };
      });
  }, [growerCropsQuery.data, cropNameById]);

  const discoveryListings = useMemo(() => {
    const items = discoveryQuery.data?.items ?? [];

    if (!isFiniteCoordinate(defaultLat) || !isFiniteCoordinate(defaultLng)) {
      return items;
    }

    return [...items].sort((left, right) => {
      const leftDistance = distanceInKm(defaultLat, defaultLng, left.lat, left.lng);
      const rightDistance = distanceInKm(defaultLat, defaultLng, right.lat, right.lng);
      return leftDistance - rightDistance;
    });
  }, [defaultLat, defaultLng, discoveryQuery.data?.items]);

  const handleCreateMode = () => {
    setEditingListingId(null);
    setSelectedCropId('');
    setSubmitError(null);
    setSuccessMessage(null);
    setSelectedListingId(null);
    setActiveView('create');
  };

  const handleEditMode = (listingId: string, cropId: string) => {
    setEditingListingId(listingId);
    setSelectedCropId(cropId);
    setSubmitError(null);
    setSuccessMessage(null);
    setSelectedListingId(null);
    setActiveView('create');
  };

  const handleViewChange = (view: ListingsView) => {
    setActiveView(view);
    setSelectedListingId(null);

    if (view !== 'create') {
      setEditingListingId(null);
      setSubmitError(null);
      setSuccessMessage(null);
    }
  };

  const handleSubmit = async (request: UpsertListingRequest) => {
    setSubmitError(null);
    setSuccessMessage(null);

    try {
      if (editingListingId) {
        await updateMutation.mutateAsync({ listingId: editingListingId, request });
        setSuccessMessage('Listing updated.');
        logger.info('Listing updated', { listingId: editingListingId });
      } else {
        await createMutation.mutateAsync(request);
        setSuccessMessage('Listing posted.');
        logger.info('Listing created', { cropId: request.cropId });
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['myListings'] }),
        queryClient.invalidateQueries({ queryKey: ['myListingsDiscovery'] }),
      ]);

      if (!editingListingId) {
        setSelectedCropId('');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to submit listing';
      setSubmitError(message);
      logger.error('Listing submission failed', error as Error);
      throw error;
    }
  };

  const selectedListing = detailListingQuery.data ?? null;

  const claimsForSelectedListing = useMemo(() => {
    if (!selectedListing) {
      return [];
    }

    return sessionClaims.filter((claim) => {
      if (claim.listingId !== selectedListing.id) {
        return false;
      }

      return viewerUserId ? claim.listingOwnerId === viewerUserId : true;
    });
  }, [selectedListing, sessionClaims, viewerUserId]);

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

      const updated = await transitionClaimMutation.mutateAsync({ claimId, status });
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

  return (
    <div className="space-y-4">
      <Card className="space-y-3" padding="4">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Listings workspace views">
          <Button
            size="sm"
            variant={activeView === 'create' ? 'primary' : 'ghost'}
            role="tab"
            aria-selected={activeView === 'create'}
            onClick={() => handleViewChange('create')}
          >
            Create Listing
          </Button>
          <Button
            size="sm"
            variant={activeView === 'my-listings' ? 'primary' : 'ghost'}
            role="tab"
            aria-selected={activeView === 'my-listings'}
            onClick={() => handleViewChange('my-listings')}
          >
            My Listings
          </Button>
          <Button
            size="sm"
            variant={activeView === 'discovery' ? 'primary' : 'ghost'}
            role="tab"
            aria-selected={activeView === 'discovery'}
            onClick={() => handleViewChange('discovery')}
          >
            Local Discovery
          </Button>
        </div>
      </Card>

      {activeView === 'create' && (
        <Card className="space-y-4" padding="6">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold text-neutral-900">
              {editingListingId ? 'Edit listing' : 'Create listing'}
            </h2>
            <p className="text-sm text-neutral-600">
              Start from something you already grow, then post in seconds.
            </p>
          </div>

          {cropsQuery.isLoading && (
            <p className="text-sm text-neutral-600" role="status">Loading crops...</p>
          )}

          {cropsQuery.isError && (
            <p className="rounded-base border border-error bg-red-50 px-3 py-2 text-sm text-error" role="alert">
              {cropsQuery.error instanceof Error ? cropsQuery.error.message : 'Failed to load crops'}
            </p>
          )}

          {growerCropsQuery.isError && (
            <p className="rounded-base border border-warning bg-accent-50 px-3 py-2 text-sm text-neutral-800" role="status">
              Could not load your crop library. You can still post manually.
            </p>
          )}

          {successMessage && (
            <p className="rounded-base border border-success bg-primary-50 px-3 py-2 text-sm text-primary-800" role="status">
              {successMessage}
            </p>
          )}

          {isEditingListingLoading && (
            <p className="text-sm text-neutral-600" role="status">Loading listing...</p>
          )}

          {!cropsQuery.isLoading && !cropsQuery.isError && !isEditingListingLoading && (
            <ListingForm
              key={listingFormKey}
              mode={editingListingId ? 'edit' : 'create'}
              crops={cropsQuery.data ?? []}
              varieties={varietiesQuery.data ?? []}
              quickPickOptions={quickPickOptions}
              isLoadingVarieties={varietiesQuery.isLoading}
              isLoadingQuickPicks={growerCropsQuery.isLoading}
              initialListing={activeEditListing}
              defaultLat={defaultLat}
              defaultLng={defaultLng}
              isSubmitting={isSubmitting}
              isOffline={isOffline}
              submitError={submitError}
              onCropChange={setSelectedCropId}
              onSubmit={handleSubmit}
              onCancelEdit={editingListingId ? handleCreateMode : undefined}
            />
          )}
        </Card>
      )}

      {activeView === 'my-listings' && (
        <Card className="space-y-4" padding="6">
          <div className="space-y-1">
            <h3 className="text-lg font-semibold text-neutral-900">My Listings</h3>
            <p className="text-sm text-neutral-600">Review your posted listings and open details for each entry.</p>
          </div>

          <div className="flex flex-wrap gap-2" aria-label="Listing status filters">
            {filterOptions.map((option) => (
              <Button
                key={option.value}
                size="sm"
                variant={myListingsFilter === option.value ? 'outline' : 'ghost'}
                aria-pressed={myListingsFilter === option.value}
                onClick={() => {
                  setMyListingsFilter(option.value);
                  setSelectedListingId(null);
                }}
              >
                {option.label}
              </Button>
            ))}
          </div>

          {myListingsQuery.isLoading && (
            <p className="text-sm text-neutral-600" role="status">Loading your listings...</p>
          )}

          {myListingsQuery.isError && (
            <p className="rounded-base border border-error bg-red-50 px-3 py-2 text-sm text-error" role="alert">
              {myListingsQuery.error instanceof Error
                ? myListingsQuery.error.message
                : 'Failed to load your listings'}
            </p>
          )}

          {!myListingsQuery.isLoading && !myListingsQuery.isError && (myListingsQuery.data?.items.length ?? 0) === 0 && (
            <p className="text-sm text-neutral-600">No listings match this filter.</p>
          )}

          {(myListingsQuery.data?.items ?? []).map((listing) => (
            <div
              key={listing.id}
              className="rounded-base border border-neutral-200 bg-white px-3 py-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1">
                  <p className="font-medium text-neutral-900">{listing.title}</p>
                  <p className="text-sm text-neutral-600">
                    {listing.quantityRemaining} {listing.unit} remaining
                  </p>
                  <ListingStatusChip status={listing.status} />
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setSelectedListingId(listing.id)}
                  >
                    View details
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleEditMode(listing.id, listing.cropId)}
                  >
                    Edit
                  </Button>
                </div>
              </div>
            </div>
          ))}

          {selectedListingId && detailListingQuery.isLoading && (
            <p className="text-sm text-neutral-600" role="status">Loading listing details...</p>
          )}

          {selectedListingId && detailListingQuery.isError && (
            <p className="rounded-base border border-error bg-red-50 px-3 py-2 text-sm text-error" role="alert">
              {detailListingQuery.error instanceof Error
                ? detailListingQuery.error.message
                : 'Failed to load listing details'}
            </p>
          )}

          {selectedListing && (
            <>
              <ListingDetails listing={selectedListing} />
              <ClaimStatusList
                title="Claim coordination"
                description="Review claim status and apply valid transitions."
                claims={claimsForSelectedListing}
                pendingClaimIds={pendingClaimIds}
                successMessage={claimSuccessMessage}
                errorMessage={claimError}
                emptyMessage="No claims tracked for this listing in this session yet."
                getActions={(claim) => getGrowerActions(claim.status)}
                onTransition={handleClaimTransition}
              />
            </>
          )}
        </Card>
      )}

      {activeView === 'discovery' && (
        <Card className="space-y-4" padding="6">
          <div className="space-y-1">
            <h3 className="text-lg font-semibold text-neutral-900">Local Discovery</h3>
            <p className="text-sm text-neutral-600">
              Showing your active listings in local-context order so you can verify what nearby neighbors can discover.
            </p>
          </div>

          {discoveryQuery.isLoading && (
            <p className="text-sm text-neutral-600" role="status">Loading local discovery listings...</p>
          )}

          {discoveryQuery.isError && (
            <p className="rounded-base border border-error bg-red-50 px-3 py-2 text-sm text-error" role="alert">
              {discoveryQuery.error instanceof Error
                ? discoveryQuery.error.message
                : 'Failed to load local discovery listings'}
            </p>
          )}

          {!discoveryQuery.isLoading && !discoveryQuery.isError && discoveryListings.length === 0 && (
            <p className="text-sm text-neutral-600">No active listings available for local discovery yet.</p>
          )}

          {discoveryListings.map((listing) => {
            const canShowDistance = isFiniteCoordinate(defaultLat) && isFiniteCoordinate(defaultLng);
            const distanceLabel = canShowDistance
              ? `${distanceInKm(defaultLat, defaultLng, listing.lat, listing.lng).toFixed(1)} km away`
              : null;

            return (
              <div key={listing.id} className="rounded-base border border-neutral-200 bg-white px-3 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <p className="font-medium text-neutral-900">{listing.title}</p>
                    <p className="text-sm text-neutral-600">
                      {listing.quantityRemaining} {listing.unit} remaining
                    </p>
                    {distanceLabel && <p className="text-xs text-neutral-500">{distanceLabel}</p>}
                    <ListingStatusChip status={listing.status} />
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setSelectedListingId(listing.id)}
                  >
                    View details
                  </Button>
                </div>
              </div>
            );
          })}

          {selectedListingId && detailListingQuery.isLoading && (
            <p className="text-sm text-neutral-600" role="status">Loading listing details...</p>
          )}

          {selectedListingId && detailListingQuery.isError && (
            <p className="rounded-base border border-error bg-red-50 px-3 py-2 text-sm text-error" role="alert">
              {detailListingQuery.error instanceof Error
                ? detailListingQuery.error.message
                : 'Failed to load listing details'}
            </p>
          )}

          {selectedListing && (
            <>
              <ListingDetails listing={selectedListing} />
              <ClaimStatusList
                title="Claim coordination"
                description="Review claim status and apply valid transitions."
                claims={claimsForSelectedListing}
                pendingClaimIds={pendingClaimIds}
                successMessage={claimSuccessMessage}
                errorMessage={claimError}
                emptyMessage="No claims tracked for this listing in this session yet."
                getActions={(claim) => getGrowerActions(claim.status)}
                onTransition={handleClaimTransition}
              />
            </>
          )}
        </Card>
      )}
    </div>
  );
}
