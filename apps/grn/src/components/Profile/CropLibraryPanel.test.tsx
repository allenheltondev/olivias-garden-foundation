import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { CropLibraryPanel } from './CropLibraryPanel';
import { listMyBeds, listMyCrops, updateMyCrop } from '../../services/api';

vi.mock('../../services/api', () => ({
  deleteMyCrop: vi.fn(),
  listMyBeds: vi.fn(),
  listMyCrops: vi.fn(),
  updateMyCrop: vi.fn(),
}));

vi.mock('../Harvests/HarvestLogModal', () => ({
  HarvestLogModal: ({ cropName, highlightedHarvestId }: { cropName: string; highlightedHarvestId?: string }) => (
    <div role="dialog" aria-label={`Harvest ${cropName}`} data-highlighted-harvest={highlightedHarvestId}>
      Harvest {cropName}
    </div>
  ),
}));

function LocationDisplay() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

describe('CropLibraryPanel deep links', () => {
  it('opens the harvest workflow for the linked crop', async () => {
    vi.mocked(listMyBeds).mockResolvedValue([]);
    vi.mocked(listMyCrops).mockResolvedValue([
      {
        id: 'crop-1',
        userId: 'grower-1',
        canonicalId: null,
        cropName: 'Tomato',
        varietyId: null,
        status: 'growing',
        visibility: 'private',
        surplusEnabled: false,
        nickname: 'Cherry tomatoes',
        defaultUnit: 'lb',
        notes: null,
        bedId: null,
        bedName: null,
        plantingDate: null,
        expectedHarvestDate: null,
        plantCount: null,
        spacingInches: null,
        pyramidTier: null,
        createdAt: '2026-07-01T00:00:00Z',
        updatedAt: '2026-07-01T00:00:00Z',
      },
    ]);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/garden/plants?crop=crop-1&action=harvest']}>
          <CropLibraryPanel viewerUserId="grower-1" />
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(await screen.findByRole('dialog', { name: 'Harvest Cherry tomatoes' })).toBeInTheDocument();
  });

  it('passes an exact harvest deep link into the harvest log', async () => {
    vi.mocked(listMyBeds).mockResolvedValue([]);
    vi.mocked(listMyCrops).mockResolvedValue([{
      id: 'crop-1', userId: 'grower-1', canonicalId: null, cropName: 'Tomato', varietyId: null,
      status: 'growing', visibility: 'private', surplusEnabled: false, nickname: null,
      defaultUnit: 'lb', notes: null, bedId: null, bedName: null, plantingDate: null,
      expectedHarvestDate: null, plantCount: null, spacingInches: null, pyramidTier: null,
      createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T00:00:00Z',
    }]);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/garden/plants?crop=crop-1&action=harvest&harvest=h1']}>
          <CropLibraryPanel viewerUserId="grower-1" />
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(await screen.findByRole('dialog')).toHaveAttribute('data-highlighted-harvest', 'h1');
  });

  it('opens a linked timing editor and saves the estimate onto the crop', async () => {
    const tomato = {
      id: 'crop-1', userId: 'grower-1', canonicalId: 'catalog-tomato', cropName: 'Tomato',
      varietyId: null, status: 'growing', visibility: 'private', surplusEnabled: false,
      nickname: null, defaultUnit: 'lb', notes: null, bedId: null, bedName: null,
      plantingDate: '2026-05-20', expectedHarvestDate: null, plantCount: null,
      spacingInches: null, pyramidTier: null, createdAt: '2026-05-20T00:00:00Z',
      updatedAt: '2026-05-20T00:00:00Z',
    };
    vi.mocked(listMyBeds).mockResolvedValue([]);
    vi.mocked(listMyCrops).mockResolvedValue([tomato]);
    vi.mocked(updateMyCrop).mockClear();
    vi.mocked(updateMyCrop).mockResolvedValue({
      ...tomato,
      expectedHarvestDate: '2026-07-19',
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/garden/plants?crop=crop-1&action=timing']}>
          <CropLibraryPanel viewerUserId="grower-1" />
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(await screen.findByRole('dialog', { name: 'Timing for Tomato' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '60 days' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save timing' }));

    await waitFor(() =>
      expect(updateMyCrop).toHaveBeenCalledWith(
        'crop-1',
        expect.objectContaining({
          cropName: 'Tomato',
          plantingDate: '2026-05-20',
          expectedHarvestDate: '2026-07-19',
        })
      )
    );
  });

  it('edits a user-defined crop without adding a catalog link', async () => {
    const customCrop = {
      id: 'crop-1',
      userId: 'grower-1',
      canonicalId: null,
      cropName: 'Purple yard bean',
      varietyId: null,
      status: 'growing',
      visibility: 'private',
      surplusEnabled: false,
      nickname: null,
      defaultUnit: 'lb',
      notes: null,
      bedId: null,
      bedName: null,
      plantingDate: null,
      expectedHarvestDate: null,
      plantCount: null,
      spacingInches: null,
      pyramidTier: 2,
      createdAt: '2026-07-01T00:00:00Z',
      updatedAt: '2026-07-01T00:00:00Z',
    };
    vi.mocked(listMyBeds).mockResolvedValue([
      {
        id: 'bed-1',
        userId: 'grower-1',
        name: 'Kitchen bed',
        description: null,
        sunExposure: null,
        soilType: null,
        lengthInches: 96,
        widthInches: 48,
        locationNotes: null,
        sortOrder: 0,
        bedType: 'raised',
        shape: 'rect',
        positionX: 0,
        positionY: 0,
        rotationDeg: 0,
        points: null,
        color: null,
        createdAt: '2026-07-01T00:00:00Z',
        updatedAt: '2026-07-01T00:00:00Z',
      },
    ]);
    const updatedCustomCrop = {
      ...customCrop,
      bedId: 'bed-1',
      bedName: 'Kitchen bed',
    };
    vi.mocked(listMyCrops)
      .mockResolvedValueOnce([customCrop])
      .mockResolvedValue([updatedCustomCrop]);
    vi.mocked(updateMyCrop).mockResolvedValue(updatedCustomCrop);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/garden/plants']}>
          <CropLibraryPanel viewerUserId="grower-1" />
        </MemoryRouter>
      </QueryClientProvider>
    );

    await userEvent.selectOptions(
      await screen.findByRole('combobox', { name: 'Bed assignment for Purple yard bean' }),
      'bed-1'
    );

    expect(
      screen.getByRole('combobox', { name: 'Bed assignment for Purple yard bean' })
    ).toHaveValue('bed-1');
    await waitFor(() =>
      expect(updateMyCrop).toHaveBeenCalledWith(
        'crop-1',
        expect.objectContaining({
          canonicalId: undefined,
          cropName: 'Purple yard bean',
          bedId: 'bed-1',
        })
      )
    );
  });

  it('starts an editable food share from a crop', async () => {
    vi.mocked(listMyBeds).mockResolvedValue([]);
    vi.mocked(listMyCrops).mockResolvedValue([
      {
        id: 'crop-1',
        userId: 'grower-1',
        canonicalId: 'catalog-tomato',
        cropName: 'Tomato',
        varietyId: null,
        status: 'growing',
        visibility: 'private',
        surplusEnabled: true,
        nickname: null,
        defaultUnit: 'lb',
        notes: null,
        bedId: null,
        bedName: null,
        plantingDate: null,
        expectedHarvestDate: null,
        plantCount: null,
        spacingInches: null,
        pyramidTier: null,
        createdAt: '2026-07-01T00:00:00Z',
        updatedAt: '2026-07-01T00:00:00Z',
      },
    ]);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/garden/plants']}>
          <CropLibraryPanel viewerUserId="grower-1" />
          <LocationDisplay />
        </MemoryRouter>
      </QueryClientProvider>
    );

    await userEvent.click(await screen.findByRole('button', { name: /share food/i }));

    expect(screen.getByTestId('location')).toHaveTextContent('/share/listings?crop=crop-1');
  });
});

const journeyCrop = {
  id: 'crop-journey', userId: 'grower-1', canonicalId: null, cropName: 'Tomato', varietyId: null,
  status: 'growing', visibility: 'private', surplusEnabled: false, nickname: 'Patio tomatoes',
  defaultUnit: 'lb', notes: 'Keep the soil evenly moist.', bedId: 'bed-1', bedName: 'Kitchen bed',
  plantingDate: null, expectedHarvestDate: null, plantCount: null, spacingInches: null, pyramidTier: null,
  createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T00:00:00Z',
} as Awaited<ReturnType<typeof listMyCrops>>[number];
function renderJourney(path: string, cachedCrops?: Awaited<ReturnType<typeof listMyCrops>>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (cachedCrops) client.setQueryData(['myCrops'], cachedCrops);
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><CropLibraryPanel /><LocationDisplay /></MemoryRouter></QueryClientProvider>);
}
describe('plant journey', () => {
  it('opens one plant with its notes, care reminder, journal, and map context', async () => {
    vi.mocked(listMyBeds).mockResolvedValue([]);
    vi.mocked(listMyCrops).mockResolvedValue([journeyCrop, { ...journeyCrop, id: 'other', cropName: 'Bean', nickname: null }]);
    renderJourney('/garden/plants?crop=crop-journey');
    expect(await screen.findByText('Keep the soil evenly moist.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Bean' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open garden journal' })).toHaveAttribute('href', '/garden/journal');
    expect(screen.getByRole('link', { name: 'Add a care reminder' })).toHaveAttribute('href', '/today/reminders?new=true&title=Check+Patio+tomatoes&type=custom');
    await userEvent.click(screen.getByRole('button', { name: 'View on Map' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/garden?bed=bed-1&crop=crop-journey');
  });
  it('preserves bed and season when opening a plant record and clears old modal context', async () => {
    vi.mocked(listMyBeds).mockResolvedValue([]);
    vi.mocked(listMyCrops).mockResolvedValue([journeyCrop]);
    renderJourney('/garden/plants?bed=bed-1&season=fall&action=timing&harvest=old');
    const link = await screen.findByRole('link', { name: 'Patio tomatoes' });
    const target = new URL(link.getAttribute('href') ?? '', 'https://garden.invalid');
    expect(target.searchParams.get('bed')).toBe('bed-1');
    expect(target.searchParams.get('season')).toBe('fall');
    expect(target.searchParams.get('crop')).toBe('crop-journey');
    expect(target.searchParams.has('action')).toBe(false);
    expect(target.searchParams.has('harvest')).toBe(false);
  });
  it('returns from a focused plant to the full collection and preserves season', async () => {
    vi.mocked(listMyBeds).mockResolvedValue([]);
    vi.mocked(listMyCrops).mockResolvedValue([journeyCrop, { ...journeyCrop, id: 'other', cropName: 'Bean', nickname: null }]);
    renderJourney('/garden/plants?crop=crop-journey&season=2026');
    await userEvent.click(await screen.findByRole('button', { name: 'Back to all plants' }));
    expect(screen.getByRole('link', { name: 'Bean' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/garden/plants?season=2026');
  });
  it('explains a deleted plant link and keeps the collection available', async () => {
    vi.mocked(listMyBeds).mockResolvedValue([]);
    vi.mocked(listMyCrops).mockResolvedValue([journeyCrop]);
    renderJourney('/garden/plants?crop=deleted');
    expect(await screen.findByText(/That plant is no longer in your garden/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Patio tomatoes' })).toBeInTheDocument();
  });
  it('keeps cached plant records visible when a background refresh fails', async () => {
    vi.mocked(listMyBeds).mockResolvedValue([]);
    vi.mocked(listMyCrops).mockRejectedValue(new Error('Offline'));
    renderJourney('/garden/plants?crop=crop-journey', [journeyCrop]);
    expect(await screen.findByRole('alert')).toHaveTextContent('Showing the last saved garden information');
    expect(screen.getByRole('link', { name: 'Patio tomatoes' })).toBeInTheDocument();
    expect(screen.getByText('Keep the soil evenly moist.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
  it('does not present a failed request as an empty garden', async () => {
    vi.mocked(listMyBeds).mockResolvedValue([]);
    vi.mocked(listMyCrops).mockRejectedValue(new Error('Unavailable'));
    renderJourney('/garden/plants');
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not refresh your plants');
    expect(screen.queryByText('Your garden is a blank slate')).not.toBeInTheDocument();
  });
});
