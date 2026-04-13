import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearcherRequestPanel } from './SearcherRequestPanel';
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

vi.mock('../../services/api', () => ({
  createCheckoutSession: vi.fn(),
  createRequest: vi.fn(),
  discoverListings: vi.fn(),
  getDerivedFeed: vi.fn(),
  getEntitlements: vi.fn(),
  getWeeklyGrowPlan: vi.fn(),
  listCatalogCrops: vi.fn(),
  updateRequest: vi.fn(),
}));

vi.mock('../../services/claims', () => ({
  createClaim: vi.fn(),
  updateClaimStatus: vi.fn(),
}));

const mockCreateCheckoutSession = vi.mocked(createCheckoutSession);
const mockCreateRequest = vi.mocked(createRequest);
const mockDiscoverListings = vi.mocked(discoverListings);
const mockGetDerivedFeed = vi.mocked(getDerivedFeed);
const mockGetEntitlements = vi.mocked(getEntitlements);
const mockGetWeeklyGrowPlan = vi.mocked(getWeeklyGrowPlan);
const mockListCatalogCrops = vi.mocked(listCatalogCrops);
const mockUpdateRequest = vi.mocked(updateRequest);
const mockCreateClaim = vi.mocked(createClaim);
const mockUpdateClaimStatus = vi.mocked(updateClaimStatus);

function setOnlineStatus(isOnline: boolean) {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value: isOnline,
  });
}

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <SearcherRequestPanel
        viewerUserId="gatherer-1"
        gathererGeoKey="9v6kn"
        defaultLat={30.2672}
        defaultLng={-97.7431}
        defaultRadiusMiles={10}
      />
    </QueryClientProvider>
  );
}

describe('SearcherRequestPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();

    setOnlineStatus(true);

    mockListCatalogCrops.mockResolvedValue([
      {
        id: 'crop-1',
        slug: 'tomato',
        commonName: 'Tomato',
        scientificName: null,
        category: 'fruit',
        description: null,
      },
      {
        id: 'crop-2',
        slug: 'kale',
        commonName: 'Kale',
        scientificName: null,
        category: 'leafy',
        description: null,
      },
    ]);

    mockDiscoverListings.mockResolvedValue({
      items: [
        {
          id: 'listing-1',
          userId: 'grower-1',
          growerCropId: null,
          cropId: 'crop-1',
          varietyId: null,
          title: 'Tomatoes Basket',
          unit: 'lb',
          quantityTotal: '10',
          quantityRemaining: '8',
          availableStart: '2026-02-20T10:00:00.000Z',
          availableEnd: '2026-02-21T10:00:00.000Z',
          status: 'active',
          pickupLocationText: 'Front porch',
          pickupAddress: null,
          pickupDisclosurePolicy: 'after_confirmed',
          pickupNotes: null,
          contactPref: 'app_message',
          geoKey: '9v6kn',
          lat: 30.2672,
          lng: -97.7431,
          createdAt: '2026-02-20T10:00:00.000Z',
        },
      ],
      limit: 30,
      offset: 0,
      hasMore: false,
      nextOffset: null,
    });

    mockGetDerivedFeed.mockResolvedValue({
      items: [],
      signals: [
        {
          geoBoundaryKey: '9v6k',
          cropId: 'crop-1',
          windowDays: 7,
          listingCount: 2,
          requestCount: 8,
          supplyQuantity: '20',
          demandQuantity: '80',
          scarcityScore: 0.92,
          abundanceScore: 0.18,
          computedAt: '2026-02-20T10:00:00.000Z',
          expiresAt: '2026-02-20T16:00:00.000Z',
        },
        {
          geoBoundaryKey: '9v6k',
          cropId: null,
          windowDays: 7,
          listingCount: 12,
          requestCount: 3,
          supplyQuantity: '160',
          demandQuantity: '20',
          scarcityScore: 0.10,
          abundanceScore: 0.94,
          computedAt: '2026-02-20T10:00:00.000Z',
          expiresAt: '2026-02-20T16:00:00.000Z',
        },
      ],
      freshness: {
        asOf: '2026-02-20T10:00:00.000Z',
        isStale: false,
        staleFallbackUsed: false,
        staleReason: null,
      },
      aiSummary: {
        summaryText: 'AI summary for local produce trends.',
        modelId: 'mock-model',
        modelVersion: 'v1',
        generatedAt: '2026-02-20T10:05:00.000Z',
        expiresAt: '2026-02-20T16:05:00.000Z',
        fromCache: true,
      },
      growerGuidance: null,
      limit: 20,
      offset: 0,
      hasMore: false,
      nextOffset: null,
    });

    mockGetEntitlements.mockResolvedValue({
      tier: 'pro',
      entitlementsVersion: 'v1',
      entitlements: ['ai.feed_insights.read'],
      policy: {
        aiIsProOnly: true,
        freeRemindersDeterministicOnly: true,
      },
    });

    mockCreateCheckoutSession.mockResolvedValue({
      checkoutUrl: 'https://checkout.stripe.test/session_123',
      checkoutSessionId: 'cs_test_123',
    });

    mockGetWeeklyGrowPlan.mockResolvedValue({
      modelId: 'amazon.nova-lite-v1:0',
      modelVersion: 'v1',
      structuredJson: true,
      geoKey: '9v6kn',
      windowDays: 7,
      recommendations: [
        {
          recommendation: 'Plant one scarcity-priority crop this week.',
          confidence: 0.82,
          rationale: ['Top scarcity signal: 0.82'],
        },
      ],
    });

    mockCreateRequest.mockResolvedValue({
      id: 'request-1',
      userId: 'gatherer-1',
      cropId: 'crop-1',
      varietyId: null,
      unit: 'lb',
      quantity: '2',
      neededBy: '2026-02-21T18:00:00.000Z',
      notes: 'Need for family meal prep',
      geoKey: '9v6kn',
      lat: 30.2672,
      lng: -97.7431,
      status: 'open',
      createdAt: '2026-02-20T10:15:00.000Z',
    });

    mockUpdateRequest.mockResolvedValue({
      id: 'request-1',
      userId: 'gatherer-1',
      cropId: 'crop-1',
      varietyId: null,
      unit: 'lb',
      quantity: '5',
      neededBy: '2026-02-21T18:00:00.000Z',
      notes: 'Updated quantity',
      geoKey: '9v6kn',
      lat: 30.2672,
      lng: -97.7431,
      status: 'open',
      createdAt: '2026-02-20T10:15:00.000Z',
    });

    mockCreateClaim.mockResolvedValue({
      id: 'claim-1',
      listingId: 'listing-1',
      requestId: null,
      claimerId: 'gatherer-1',
      listingOwnerId: 'grower-1',
      quantityClaimed: '1',
      status: 'pending',
      notes: null,
      claimedAt: '2026-02-20T11:00:00.000Z',
      confirmedAt: null,
      completedAt: null,
      cancelledAt: null,
    });

    mockUpdateClaimStatus.mockResolvedValue({
      id: 'claim-1',
      listingId: 'listing-1',
      requestId: null,
      claimerId: 'gatherer-1',
      listingOwnerId: 'grower-1',
      quantityClaimed: '1',
      status: 'cancelled',
      notes: null,
      claimedAt: '2026-02-20T11:00:00.000Z',
      confirmedAt: null,
      completedAt: null,
      cancelledAt: '2026-02-20T11:05:00.000Z',
    });
  });

  it('lets a searcher discover a listing and submit a request in one session', async () => {
    const user = userEvent.setup();

    renderPanel();

    expect(await screen.findByText('Tomatoes Basket')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /request this item/i }));
    await user.clear(screen.getByLabelText(/quantity/i));
    await user.type(screen.getByLabelText(/quantity/i), '2');
    await user.type(screen.getByLabelText(/notes/i), 'Need for family meal prep');

    await user.click(screen.getByRole('button', { name: /create request/i }));

    await waitFor(() => {
      expect(mockCreateRequest).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByText(/request submitted/i)).toBeInTheDocument();
    expect(await screen.findByText(/requests this session/i)).toBeInTheDocument();
  });

  it('shows an empty state when no listings are discovered', async () => {
    mockDiscoverListings.mockResolvedValueOnce({
      items: [],
      limit: 30,
      offset: 0,
      hasMore: false,
      nextOffset: null,
    });

    renderPanel();

    expect(await screen.findByText(/no listings found in this area yet/i)).toBeInTheDocument();
  });

  it('shows an error state when discovery fails', async () => {
    mockDiscoverListings.mockRejectedValueOnce(new Error('Discovery failed'));

    renderPanel();

    await waitFor(() => {
      expect(screen.getByText(/discovery failed/i)).toBeInTheDocument();
    });
  });

  it('supports editing a request created in the current session', async () => {
    const user = userEvent.setup();

    renderPanel();

    expect(await screen.findByText('Tomatoes Basket')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /request this item/i }));
    await user.click(screen.getByRole('button', { name: /create request/i }));

    expect(await screen.findByRole('button', { name: /edit request/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /edit request/i }));
    await user.clear(screen.getByLabelText(/quantity/i));
    await user.type(screen.getByLabelText(/quantity/i), '5');

    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const neededByLocal = new Date(tomorrow.getTime() - tomorrow.getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 16);
    fireEvent.change(screen.getByLabelText(/needed by/i), { target: { value: neededByLocal } });

    await user.click(screen.getByRole('button', { name: /update request/i }));

    await waitFor(() => {
      expect(mockUpdateRequest).toHaveBeenCalledTimes(1);
    });

    expect(mockUpdateRequest).toHaveBeenCalledWith(
      'request-1',
      expect.objectContaining({ quantity: 5 })
    );
  });

  it('creates a claim and allows valid transitions from pending', async () => {
    const user = userEvent.setup();

    renderPanel();

    expect(await screen.findByText('Tomatoes Basket')).toBeInTheDocument();
    window.dispatchEvent(new Event('online'));
    await user.click(screen.getByRole('button', { name: /claim this listing/i }));

    await waitFor(() => {
      expect(mockCreateClaim).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByText(/claim submitted/i)).toBeInTheDocument();
    const claimSectionHeading = await screen.findByRole('heading', { name: /my claim coordination/i });
    const claimSection = claimSectionHeading.closest('.rounded-base');
    expect(claimSection).not.toBeNull();

    await user.click(within(claimSection as HTMLElement).getByRole('button', { name: /^cancel$/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /my claim coordination/i })).toBeInTheDocument();
    });
  });

  it('restores previous claim state when transition fails', async () => {
    const user = userEvent.setup();
    mockUpdateClaimStatus.mockRejectedValueOnce(new Error('Transition failed'));

    renderPanel();

    expect(await screen.findByText('Tomatoes Basket')).toBeInTheDocument();
    window.dispatchEvent(new Event('online'));
    await user.click(screen.getByRole('button', { name: /claim this listing/i }));

    await waitFor(() => {
      expect(mockCreateClaim).toHaveBeenCalledTimes(1);
    });

    const claimSectionHeading = await screen.findByRole('heading', { name: /my claim coordination/i });
    const claimSection = claimSectionHeading.closest('.rounded-base');
    expect(claimSection).not.toBeNull();
    expect(within(claimSection as HTMLElement).getByRole('button', { name: /^cancel$/i })).toBeInTheDocument();

    await user.click(within(claimSection as HTMLElement).getByRole('button', { name: /^cancel$/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /my claim coordination/i })).toBeInTheDocument();
    });
  });

  it('queues claim creation while offline and replays when online', async () => {
    const user = userEvent.setup();

    renderPanel();

    expect(await screen.findByText('Tomatoes Basket')).toBeInTheDocument();

    setOnlineStatus(false);
    window.dispatchEvent(new Event('offline'));

    await user.click(screen.getByRole('button', { name: /claim this listing/i }));

    expect(mockCreateClaim).not.toHaveBeenCalled();
    expect(await screen.findByText(/claim was queued/i)).toBeInTheDocument();

    setOnlineStatus(true);
    window.dispatchEvent(new Event('online'));

    await waitFor(() => {
      expect(mockCreateClaim).toHaveBeenCalledTimes(1);
    });
  });

  it('does not incorrectly link a claim when multiple open requests match', async () => {
    const user = userEvent.setup();
    mockCreateRequest
      .mockResolvedValueOnce({
        id: 'request-1',
        userId: 'gatherer-1',
        cropId: 'crop-1',
        varietyId: null,
        unit: 'lb',
        quantity: '2',
        neededBy: '2026-02-21T18:00:00.000Z',
        notes: 'Need for family meal prep',
        geoKey: '9v6kn',
        lat: 30.2672,
        lng: -97.7431,
        status: 'open',
        createdAt: '2026-02-20T10:15:00.000Z',
      })
      .mockResolvedValueOnce({
        id: 'request-2',
        userId: 'gatherer-1',
        cropId: 'crop-1',
        varietyId: null,
        unit: 'lb',
        quantity: '2',
        neededBy: '2026-02-21T18:00:00.000Z',
        notes: 'Need for family meal prep',
        geoKey: '9v6kn',
        lat: 30.2672,
        lng: -97.7431,
        status: 'open',
        createdAt: '2026-02-20T10:16:00.000Z',
      });

    renderPanel();
    window.dispatchEvent(new Event('online'));

    expect(await screen.findByText('Tomatoes Basket')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /request this item/i }));
    await user.click(screen.getByRole('button', { name: /create request/i }));
    await user.click(screen.getByRole('button', { name: /request this item/i }));
    await user.click(screen.getByRole('button', { name: /create request/i }));

    await waitFor(() => {
      expect(mockCreateRequest).toHaveBeenCalledTimes(2);
    });

    await user.click(screen.getByRole('button', { name: /claim this listing/i }));

    await waitFor(() => {
      expect(mockCreateClaim).toHaveBeenCalledTimes(1);
      const firstArg = mockCreateClaim.mock.calls[0]?.[0];
      expect(firstArg).toEqual(
        expect.objectContaining({
          listingId: 'listing-1',
          requestId: undefined,
        })
      );
    });
  });

  it('shows AI label when AI summary is displayed', async () => {
    renderPanel();

    const aiSummaryCard = await screen.findByTestId('ai-summary-card');
    expect(aiSummaryCard).toBeInTheDocument();
    expect(within(aiSummaryCard).getByText(/ai-assisted/i)).toBeInTheDocument();
    expect(within(aiSummaryCard).getByText(/ai summary for local produce trends/i)).toBeInTheDocument();

    const marketSnapshot = await screen.findByTestId('market-snapshot-card');
    expect(marketSnapshot).toBeInTheDocument();
    expect(within(marketSnapshot).getByText(/likely scarce/i)).toBeInTheDocument();
    expect(within(marketSnapshot).getByText(/likely abundant/i)).toBeInTheDocument();
  });

  it('shows pro upgrade prompt when AI entitlement is missing', async () => {
    mockGetEntitlements.mockResolvedValueOnce({
      tier: 'free',
      entitlementsVersion: 'v1',
      entitlements: [],
      policy: {
        aiIsProOnly: true,
        freeRemindersDeterministicOnly: true,
      },
    });

    renderPanel();

    expect(await screen.findByText(/ai insights are a pro feature/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /unlock pro ai/i })).toBeInTheDocument();
  });

  it('supports opt-out for AI insights while preserving core listing flow', async () => {
    const user = userEvent.setup();

    renderPanel();

    expect(await screen.findByText('Tomatoes Basket')).toBeInTheDocument();

    const toggle = screen.getByRole('checkbox', { name: /show ai-assisted insights/i });
    expect(toggle).toBeChecked();

    await user.click(toggle);

    expect(toggle).not.toBeChecked();
    expect(await screen.findByText(/ai insights are off for this account on this device/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /request this item/i }));
    await user.click(screen.getByRole('button', { name: /create request/i }));

    await waitFor(() => {
      expect(mockCreateRequest).toHaveBeenCalledTimes(1);
    });
  });
});
