import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { PlannerPage } from './PlannerPage';
import { getMe, listMyCrops } from '../services/api';
import type { GrowerCropItem } from '../types/listing';
import type { UserProfile } from '../types/user';

vi.mock('../services/api', () => ({
  getMe: vi.fn(),
  listMyCrops: vi.fn(),
}));

const mockGetMe = vi.mocked(getMe);
const mockListMyCrops = vi.mocked(listMyCrops);

const growerProfile = {
  id: 'grower-1',
  userType: 'grower',
} as unknown as UserProfile;

function crop(id: string, cropName: string, pyramidTier?: number | null): GrowerCropItem {
  return {
    id,
    userId: 'grower-1',
    canonicalId: null,
    cropName,
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
    pyramidTier: pyramidTier ?? null,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  };
}

function renderPage(initialEntry = '/', state: { savedCropId: string } | null = null) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[{ pathname: initialEntry.split('?')[0], search: initialEntry.includes('?') ? '?' + initialEntry.split('?')[1] : '', state }]}>
        <PlannerPage />
        <LocationDisplay />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function LocationDisplay() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

describe('PlannerPage', () => {
  it('confirms a saved plant from another layer without changing the selected layer', async () => {
    mockGetMe.mockResolvedValue(growerProfile);
    mockListMyCrops.mockResolvedValue([crop('new-crop', 'Tomato', 2)]);
    renderPage('/garden/plan?tier=4&season=fall&crop=new-crop', { savedCropId: 'new-crop' });
    expect(await screen.findByText(/Plant saved to your garden/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Flavor' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View saved plant' })).toHaveAttribute('href', '/garden/plants?tier=4&season=fall&crop=new-crop');
    expect(screen.getByTestId('location')).toHaveTextContent('tier=4&season=fall');
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss confirmation' }));
    expect(screen.queryByText(/Plant saved to your garden/)).not.toBeInTheDocument();
  });
  it('does not claim an ordinary linked plant was just saved', async () => {
    renderPage('/garden/plan?crop=existing&tier=4');
    await screen.findByTestId('pyramid-band-foundation');
    expect(screen.queryByText(/Plant saved to your garden/)).not.toBeInTheDocument();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMe.mockResolvedValue(growerProfile);
    mockListMyCrops.mockResolvedValue([]);

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it('renders the five pyramid layers', async () => {
    renderPage();
    expect(await screen.findByTestId('pyramid-band-foundation')).toBeInTheDocument();
    expect(screen.getByTestId('pyramid-band-workhorse')).toBeInTheDocument();
    expect(screen.getByTestId('pyramid-band-fresh')).toBeInTheDocument();
    expect(screen.getByTestId('pyramid-band-flavor')).toBeInTheDocument();
    expect(screen.getByTestId('pyramid-band-joy')).toBeInTheDocument();
  });

  it('counts the grower crops that fall into each layer', async () => {
    mockListMyCrops.mockResolvedValue([
      crop('c1', 'Potato'),
      crop('c2', 'Tomato'),
      crop('c3', 'Cucumber'),
    ]);
    renderPage();

    // Foundation has 1 (potato), Workhorse has 2 (tomato, cucumber).
    await waitFor(() =>
      expect(screen.getByTestId('pyramid-count-foundation')).toHaveTextContent('1')
    );
    expect(screen.getByTestId('pyramid-count-workhorse')).toHaveTextContent('2');
    // The Fresh layer has nothing, so it shows the "+" add affordance.
    expect(screen.getByTestId('pyramid-count-fresh')).toHaveTextContent('+');

    expect(screen.getByText(/of 5 layers started/i)).toHaveTextContent(
      '2 of 5 layers started'
    );
  });

  it('sorts a crop by its catalog pyramidTier even when the name says otherwise', async () => {
    // "Tomato" classifies to Workhorse by name, but the catalog tier (Joy) wins.
    mockListMyCrops.mockResolvedValue([crop('c1', 'Tomato', 5)]);
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId('pyramid-count-joy')).toHaveTextContent('1')
    );
    expect(screen.getByTestId('pyramid-count-workhorse')).toHaveTextContent('+');
  });

  it('shows a plan score gauge', async () => {
    mockListMyCrops.mockResolvedValue([crop('c1', 'Potato'), crop('c2', 'Tomato')]);
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole('img', { name: /plan score \d+ out of 100/i })).toBeInTheDocument()
    );
  });

  it('connects planning directly to the garden map', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Open Map' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/garden');
  });

  it('opens a directly linked layer and preserves it in the URL while switching', async () => {
    renderPage('/garden/plan?tier=4&season=fall');

    expect(await screen.findByRole('heading', { name: 'Flavor' })).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('pyramid-band-joy'));

    expect(screen.getByTestId('location')).toHaveTextContent('/garden/plan?tier=5&season=fall');
  });

  it('carries the selected season and layer into the add-crop return path', async () => {
    renderPage('/garden/plan?tier=4&season=fall');
    await userEvent.click(await screen.findByRole('button', { name: /add a crop to flavor/i }));
    const location = screen.getByTestId('location').textContent ?? '';
    const destination = new URL(location, 'https://garden.invalid');
    expect(destination.pathname).toBe('/garden/plants/new');
    expect(destination.searchParams.get('returnTo')).toBe('/garden/plan?tier=4&season=fall');
  });

  it('explains that local recommendations are optional context', async () => {
    renderPage('/garden/plan');

    expect(await screen.findByRole('heading', { name: 'Local planting context' })).toBeInTheDocument();
    expect(screen.getByText(/optional community signals, not instructions/i)).toBeInTheDocument();
  });

  it('guides the grower to their next unfilled layer', async () => {
    mockListMyCrops.mockResolvedValue([crop('c1', 'Potato'), crop('c2', 'Tomato')]);
    const user = userEvent.setup();
    renderPage();

    const nextStep = await screen.findByRole('button', { name: /start with fresh/i });
    await user.click(nextStep);

    expect(await screen.findByRole('heading', { name: 'Fresh' })).toBeInTheDocument();
  });

  it('shows the selected layer detail and switches when another band is clicked', async () => {
    mockListMyCrops.mockResolvedValue([crop('c1', 'Basil')]);
    const user = userEvent.setup();
    renderPage();

    // Default focus is the Foundation layer.
    const detail = await screen.findByRole('heading', { name: 'Foundation' });
    expect(detail).toBeInTheDocument();

    await user.click(screen.getByTestId('pyramid-band-flavor'));

    expect(await screen.findByRole('heading', { name: 'Flavor' })).toBeInTheDocument();
    // The grower's basil should appear in the Flavor layer's crop list.
    // (Scoped to span chips — the pyramid silhouette also carries an svg
    // <title>Basil</title> tooltip.)
    expect(screen.getByText('Basil', { selector: 'span' })).toBeInTheDocument();
  });

  it('keeps the selected layer in a loading state until the garden is available', async () => {
    let resolveCrops!: (crops: GrowerCropItem[]) => void;
    mockListMyCrops.mockImplementation(
      () => new Promise<GrowerCropItem[]>((resolve) => {
        resolveCrops = resolve;
      })
    );

    renderPage();

    expect(await screen.findByText(/checking this layer/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add a crop to foundation/i })).not.toBeInTheDocument();

    resolveCrops([]);

    expect(await screen.findByRole('button', { name: /add a crop to foundation/i })).toBeInTheDocument();
  });

  it('offers a retry when the garden cannot be loaded', async () => {
    mockListMyCrops.mockRejectedValue(new Error('Network unavailable'));
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't load your garden/i);

    await user.click(screen.getByRole('button', { name: /try again/i }));

    await waitFor(() => expect(mockListMyCrops).toHaveBeenCalledTimes(2));
  });

  it('surfaces crops it cannot place in a "Not yet placed" section', async () => {
    mockListMyCrops.mockResolvedValue([crop('c1', 'Dragonfruit cactus')]);
    renderPage();

    expect(await screen.findByText(/Not yet placed/i)).toBeInTheDocument();
    expect(screen.getByText('Dragonfruit cactus')).toBeInTheDocument();
  });

  it('redirects users without a grower type home', async () => {
    mockGetMe.mockResolvedValue({ id: 'g1', userType: null } as unknown as UserProfile);
    renderPage();
    await waitFor(() => {
      expect(screen.queryByTestId('pyramid-band-foundation')).not.toBeInTheDocument();
    });
  });
});
