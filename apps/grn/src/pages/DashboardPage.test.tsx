import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { DashboardPage } from './DashboardPage';
import { getDerivedFeed, listMyBeds, listMyCrops, listReminders } from '../services/api';
import { listClaims } from '../services/claims';
import type { GrowerCropItem } from '../types/listing';
import type { UserProfile } from '../types/user';

vi.mock('../services/api', () => ({
  getDerivedFeed: vi.fn(),
  listMyBeds: vi.fn(),
  listMyCrops: vi.fn(),
  listReminders: vi.fn(),
}));

vi.mock('../services/claims', () => ({
  listClaims: vi.fn(),
}));

const mockGetDerivedFeed = vi.mocked(getDerivedFeed);
const mockListMyBeds = vi.mocked(listMyBeds);
const mockListMyCrops = vi.mocked(listMyCrops);
const mockListReminders = vi.mocked(listReminders);
const mockListClaims = vi.mocked(listClaims);

const profile = {
  id: 'grower-1',
  email: 'ada@example.com',
  displayName: 'Ada Lovelace',
  userType: 'grower',
  onboardingCompleted: true,
  subscription: { tier: 'free' },
} as UserProfile;

function crop(overrides: Partial<GrowerCropItem>): GrowerCropItem {
  return {
    id: 'c1',
    userId: 'grower-1',
    canonicalId: null,
    cropName: 'Tomato',
    varietyId: null,
    status: 'growing',
    visibility: 'private',
    surplusEnabled: false,
    nickname: null,
    defaultUnit: null,
    notes: null,
    bedId: null,
    bedName: null,
    plantingDate: null,
    expectedHarvestDate: null,
    plantCount: null,
    spacingInches: null,
    pyramidTier: null,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  };
}

function renderPage(user: UserProfile = profile) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <DashboardPage user={user} />
        <LocationDisplay />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function LocationDisplay() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
    // React Query's online manager is a module singleton, so the offline event
    // fired by one test would otherwise pause every query in the next one.
    onlineManager.setOnline(true);
    window.localStorage.clear();
    mockListMyBeds.mockResolvedValue([]);
    mockListMyCrops.mockResolvedValue([]);
    mockListReminders.mockResolvedValue({ items: [] });
    mockListClaims.mockResolvedValue({
      items: [],
      limit: 50,
      offset: 0,
      hasMore: false,
      nextOffset: null,
    });
    mockGetDerivedFeed.mockResolvedValue({
      items: [],
      signals: [],
      freshness: {
        asOf: '2026-07-14T00:00:00Z',
        isStale: false,
        staleFallbackUsed: false,
        staleReason: null,
      },
      aiSummary: null,
      growerGuidance: null,
      limit: 1,
      offset: 0,
      hasMore: false,
      nextOffset: null,
    });
  });

  it('shows one clear first step when the garden is empty', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Today, Ada' })).toBeInTheDocument();
    const actionList = await screen.findByRole('list', { name: /top actions today/i });
    expect(within(actionList).getAllByRole('listitem')).toHaveLength(1);

    await userEvent.click(within(actionList).getByRole('button', { name: 'Add a plant' }));
    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/garden/plants/new');
    });
  });

  it('puts the next action before setup and seasonal exploration', async () => {
    renderPage();

    const actions = await screen.findByRole('list', { name: /top actions today/i });
    const setup = await screen.findByRole('heading', { name: 'Getting started' });
    const season = screen.getByRole('heading', { name: 'Make Today local to your garden' });
    expect(actions.compareDocumentPosition(setup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(setup.compareDocumentPosition(season) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText(/One plant is enough to begin/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Garden at a glance' })).not.toBeInTheDocument();
  });

  it('keeps unfinished setup available after the first plant', async () => {
    mockListMyCrops.mockResolvedValue([crop({ surplusEnabled: true })]);
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Garden at a glance' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Getting started' })).toBeInTheDocument();
    const actions = screen.getByRole('list', { name: /top actions today/i });
    expect(actions.compareDocumentPosition(screen.getByRole('heading', { name: 'Getting started' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('Sharing enabled')).toBeInTheDocument();
    expect(screen.queryByText('Ready to share')).not.toBeInTheDocument();
    expect(screen.getByText(/Your next useful step/)).toBeInTheDocument();
  });

  it('ranks no more than three record-linked actions and preserves the harvest deep link', async () => {
    mockListMyCrops.mockResolvedValue([
      crop({ id: 'crop-ready', nickname: 'Cherry tomatoes', expectedHarvestDate: '2000-01-01' }),
      crop({ id: 'crop-plan', cropName: 'Kale', status: 'planning' }),
    ]);
    mockListReminders.mockResolvedValue({
      items: [
        {
          id: 'reminder-due',
          title: 'Water the raised beds',
          reminderType: 'watering',
          cadenceDays: 1,
          startDate: '2000-01-01',
          timezone: 'UTC',
          status: 'active',
          nextRunAt: '2000-01-01T09:00:00Z',
          lastRunAt: null,
          createdAt: '2000-01-01T00:00:00Z',
        },
      ],
    });
    mockListClaims.mockResolvedValue({
      items: [
        {
          id: 'claim-pending',
          listingId: 'listing-1',
          requestId: null,
          claimerId: 'neighbor-1',
          listingOwnerId: 'grower-1',
          quantityClaimed: '1',
          status: 'pending',
          notes: null,
          claimedAt: '2000-01-01T00:00:00Z',
          confirmedAt: null,
          completedAt: null,
          cancelledAt: null,
        },
      ],
      limit: 50,
      offset: 0,
      hasMore: false,
      nextOffset: null,
    });

    renderPage();

    const actionList = await screen.findByRole('list', { name: /top actions today/i });
    const actions = within(actionList).getAllByRole('listitem');
    expect(actions).toHaveLength(3);
    expect(within(actions[0]).getByText('Review a sharing request')).toBeInTheDocument();
    expect(within(actions[1]).getByText('Water the raised beds')).toBeInTheDocument();
    expect(within(actions[2]).getByText('Check Cherry tomatoes')).toBeInTheDocument();

    await userEvent.click(within(actions[2]).getByRole('button', { name: 'Log harvest' }));
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/garden/plants?crop=crop-ready&action=harvest'
    );
  });

  it('keeps successful actions visible when another source fails', async () => {
    mockListMyCrops.mockResolvedValue([
      crop({ id: 'crop-ready', expectedHarvestDate: '2000-01-01' }),
    ]);
    mockListClaims.mockRejectedValue(new Error('claims unavailable'));

    renderPage();

    expect(await screen.findByText('Check Tomato')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/could not refresh/i);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('shows an explicit offline state without hiding cached actions', async () => {
    mockListMyCrops.mockResolvedValue([
      crop({ id: 'crop-ready', expectedHarvestDate: '2000-01-01' }),
    ]);
    renderPage();

    expect(await screen.findByText('Check Tomato')).toBeInTheDocument();
    fireEvent(window, new Event('offline'));
    expect(await screen.findByText(/showing the latest garden information/i)).toBeInTheDocument();
    expect(screen.getByText('Check Tomato')).toBeInTheDocument();
  });

  it('shows the getting-started checklist until setup is done', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Getting started' })).toBeInTheDocument();
    const stepList = screen.getByRole('list', { name: 'Setup steps' });
    const steps = within(stepList).getAllByRole('listitem');
    expect(steps).toHaveLength(4);

    await userEvent.click(within(stepList).getByRole('button', { name: 'Add a plant' }));
    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/garden/plants/new');
    });
  });

  it('hides the checklist once every setup step is on record', async () => {
    mockListMyCrops.mockResolvedValue([crop({ id: 'crop-1', bedId: 'bed-1' })]);
    mockListMyBeds.mockResolvedValue([{ id: 'bed-1' } as Awaited<ReturnType<typeof listMyBeds>>[number]]);
    mockListReminders.mockResolvedValue({
      items: [
        {
          id: 'reminder-1',
          title: 'Water the beds',
          reminderType: 'watering',
          cadenceDays: 2,
          startDate: '2026-07-01',
          timezone: 'UTC',
          status: 'active',
          nextRunAt: '2999-01-01T00:00:00Z',
          lastRunAt: null,
          createdAt: '2026-07-01T00:00:00Z',
        },
      ],
    });

    renderPage();

    expect(await screen.findByRole('heading', { name: 'Today, Ada' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Getting started' })).not.toBeInTheDocument();
    });
  });

  it('offers the grow-more library without framing it as a goal', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Grow more of your own' })).toBeInTheDocument();
    expect(screen.getByText(/Ideas to browse, not a checklist to finish/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Browse ideas' }));
    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/garden/grow-more');
    });
  });

  it('shows a focused loader while the initial action sources are pending', () => {
    mockListMyCrops.mockReturnValue(new Promise(() => undefined));
    mockListReminders.mockReturnValue(new Promise(() => undefined));
    mockListClaims.mockReturnValue(new Promise(() => undefined));

    renderPage();

    expect(screen.getByText('Finding your next steps…')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: /top actions today/i })).not.toBeInTheDocument();
  });
});
