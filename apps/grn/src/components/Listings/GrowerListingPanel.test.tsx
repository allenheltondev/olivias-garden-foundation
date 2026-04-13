import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GrowerListingPanel } from './GrowerListingPanel';
import type { Listing } from '../../types/listing';
import {
  createListing,
  getMyListing,
  listCatalogCrops,
  listCatalogVarieties,
  listMyCrops,
  listMyListings,
  updateListing,
} from '../../services/api';
import { updateClaimStatus } from '../../services/claims';

vi.mock('../../services/api', () => ({
  createListing: vi.fn(),
  getMyListing: vi.fn(),
  listCatalogCrops: vi.fn(),
  listCatalogVarieties: vi.fn(),
  listMyCrops: vi.fn(),
  listMyListings: vi.fn(),
  updateListing: vi.fn(),
}));

vi.mock('../../services/claims', () => ({
  updateClaimStatus: vi.fn(),
}));

const mockListCatalogCrops = vi.mocked(listCatalogCrops);
const mockListCatalogVarieties = vi.mocked(listCatalogVarieties);
const mockListMyCrops = vi.mocked(listMyCrops);
const mockListMyListings = vi.mocked(listMyListings);
const mockGetMyListing = vi.mocked(getMyListing);
const mockCreateListing = vi.mocked(createListing);
const mockUpdateListing = vi.mocked(updateListing);
const mockUpdateClaimStatus = vi.mocked(updateClaimStatus);

function setOnlineStatus(isOnline: boolean) {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value: isOnline,
  });
}

function makeListing(overrides: Partial<Listing>): Listing {
  return {
    id: 'listing-1',
    userId: 'user-1',
    growerCropId: null,
    cropId: 'crop-1',
    varietyId: null,
    title: 'Tomatoes Basket',
    unit: 'lb',
    quantityTotal: '10',
    quantityRemaining: '6',
    availableStart: '2026-02-20T10:00:00.000Z',
    availableEnd: '2026-02-20T18:00:00.000Z',
    status: 'active',
    pickupLocationText: 'Front porch',
    pickupAddress: null,
    pickupDisclosurePolicy: 'after_confirmed',
    pickupNotes: null,
    contactPref: 'app_message',
    geoKey: 'dr5ru',
    lat: 30.2672,
    lng: -97.7431,
    createdAt: '2026-02-20T08:00:00.000Z',
    ...overrides,
  };
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
      <GrowerListingPanel viewerUserId="user-1" defaultLat={30.2672} defaultLng={-97.7431} />
    </QueryClientProvider>
  );
}

describe('GrowerListingPanel', () => {
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
    ]);
    mockListCatalogVarieties.mockResolvedValue([]);
    mockListMyCrops.mockResolvedValue([]);
    mockCreateListing.mockResolvedValue(makeListing({ id: 'new-listing' }));
    mockUpdateListing.mockResolvedValue(makeListing({ id: 'updated-listing' }));
    mockUpdateClaimStatus.mockResolvedValue({
      id: 'claim-1',
      listingId: 'listing-1',
      requestId: null,
      claimerId: 'gatherer-1',
      listingOwnerId: 'user-1',
      quantityClaimed: '1',
      status: 'confirmed',
      notes: null,
      claimedAt: '2026-02-20T11:00:00.000Z',
      confirmedAt: '2026-02-20T11:02:00.000Z',
      completedAt: null,
      cancelledAt: null,
    });
  });

  it('renders my listings, applies status filters, and opens listing details', async () => {
    const user = userEvent.setup();

    const activeListing = makeListing({ id: 'listing-1', title: 'Tomatoes Basket', status: 'active' });
    const expiredListing = makeListing({
      id: 'listing-2',
      title: 'Late Kale',
      status: 'expired',
      quantityRemaining: '0',
      unit: 'bunch',
      pickupLocationText: 'Driveway table',
    });

    mockListMyListings.mockImplementation(async (_limit, _offset, status) => {
      if (status === 'active') {
        return {
          items: [activeListing],
          limit: 50,
          offset: 0,
          hasMore: false,
          nextOffset: null,
        };
      }

      if (status === 'expired') {
        return {
          items: [expiredListing],
          limit: 50,
          offset: 0,
          hasMore: false,
          nextOffset: null,
        };
      }

      if (status === 'completed') {
        return {
          items: [],
          limit: 50,
          offset: 0,
          hasMore: false,
          nextOffset: null,
        };
      }

      return {
        items: [activeListing, expiredListing],
        limit: 50,
        offset: 0,
        hasMore: false,
        nextOffset: null,
      };
    });

    mockGetMyListing.mockImplementation(async (listingId: string) => {
      return listingId === 'listing-2' ? expiredListing : activeListing;
    });

    renderPanel();

    await user.click(screen.getByRole('tab', { name: /my listings/i }));

    expect(await screen.findByText('Tomatoes Basket')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Active' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Expired' }));

    expect(await screen.findByText('Late Kale')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /view details/i }));

    expect(await screen.findByText(/listing details/i)).toBeInTheDocument();
    expect(screen.getByText(/driveway table/i)).toBeInTheDocument();
  });

  it('shows empty states for my listings and local discovery', async () => {
    const user = userEvent.setup();

    mockListMyListings.mockResolvedValue({
      items: [],
      limit: 50,
      offset: 0,
      hasMore: false,
      nextOffset: null,
    });
    mockGetMyListing.mockResolvedValue(makeListing({ id: 'listing-1' }));

    renderPanel();

    await user.click(screen.getByRole('tab', { name: /my listings/i }));
    expect(await screen.findByText(/no listings match this filter/i)).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /local discovery/i }));
    expect(await screen.findByText(/no active listings available for local discovery yet/i)).toBeInTheDocument();
  });

  it('shows error state when listing queries fail', async () => {
    const user = userEvent.setup();

    mockListMyListings.mockRejectedValue(new Error('Listings request failed'));

    renderPanel();

    await user.click(screen.getByRole('tab', { name: /my listings/i }));

    await waitFor(() => {
      expect(screen.getByText(/listings request failed/i)).toBeInTheDocument();
    });
  });

  it('pre-seeds edit form from selected listing while detail query is loading', async () => {
    const user = userEvent.setup();
    const activeListing = makeListing({
      id: 'listing-1',
      title: 'Tomatoes Basket',
      status: 'active',
      quantityTotal: '12',
      quantityRemaining: '8',
    });

    mockListMyListings.mockResolvedValue({
      items: [activeListing],
      limit: 50,
      offset: 0,
      hasMore: false,
      nextOffset: null,
    });

    let resolveDetail: ((value: Listing) => void) | undefined;
    const pendingDetail = new Promise<Listing>((resolve) => {
      resolveDetail = resolve;
    });
    mockGetMyListing.mockReturnValue(pendingDetail);

    renderPanel();

    await user.click(screen.getByRole('tab', { name: /my listings/i }));
    expect(await screen.findByText('Tomatoes Basket')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Edit' }));

    expect(await screen.findByRole('heading', { name: /edit listing/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/listing title/i)).toHaveValue('Tomatoes Basket');

    resolveDetail?.(activeListing);
  });

  it('shows grower claim transitions and confirms pending claims', async () => {
    const user = userEvent.setup();

    mockListMyListings.mockResolvedValue({
      items: [makeListing({ id: 'listing-1', title: 'Tomatoes Basket', status: 'active' })],
      limit: 50,
      offset: 0,
      hasMore: false,
      nextOffset: null,
    });
    mockGetMyListing.mockResolvedValue(makeListing({ id: 'listing-1', title: 'Tomatoes Basket' }));

    window.localStorage.setItem(
      'claim-session-v1:user-1',
      JSON.stringify([
        {
          id: 'claim-1',
          listingId: 'listing-1',
          requestId: null,
          claimerId: 'gatherer-1',
          listingOwnerId: 'user-1',
          quantityClaimed: '1',
          status: 'pending',
          notes: null,
          claimedAt: '2026-02-20T11:00:00.000Z',
          confirmedAt: null,
          completedAt: null,
          cancelledAt: null,
        },
      ])
    );

    renderPanel();

    await user.click(screen.getByRole('tab', { name: /my listings/i }));
    expect(await screen.findByText('Tomatoes Basket')).toBeInTheDocument();
    window.dispatchEvent(new Event('online'));
    await user.click(screen.getByRole('button', { name: /view details/i }));

    const claimSectionHeading = await screen.findByRole('heading', { name: /claim coordination/i });
    const claimSection = claimSectionHeading.closest('.rounded-base');
    expect(claimSection).not.toBeNull();
    expect(within(claimSection as HTMLElement).getByRole('button', { name: /^confirm$/i })).toBeInTheDocument();
    expect(within(claimSection as HTMLElement).queryByRole('button', { name: /^complete$/i })).not.toBeInTheDocument();
  });
});
