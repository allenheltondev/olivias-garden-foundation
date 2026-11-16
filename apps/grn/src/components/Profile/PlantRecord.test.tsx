import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { onlineManager, QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { PlantRecord } from './PlantRecord';
import { listHarvests, updateMyCrop, type HarvestItem } from '../../services/api';
import type { GrowerCropItem } from '../../types/listing';

vi.mock('../../services/api', () => ({ listHarvests: vi.fn(), updateMyCrop: vi.fn() }));

const crop: GrowerCropItem = {
  id: 'okra', userId: 'grower', canonicalId: null, cropName: 'Okra', varietyId: null,
  status: 'growing', visibility: 'private', surplusEnabled: false, nickname: 'Backyard okra',
  defaultUnit: 'lb', notes: 'Pick the pods young.', bedId: 'bed-1', bedName: 'Sunny bed',
  plantingDate: '2026-04-01', expectedHarvestDate: '2026-06-01', plantCount: 3, spacingInches: 12,
  createdAt: '2026-03-01T12:00:00Z', updatedAt: '2026-03-01T12:00:00Z',
};
const harvest: HarvestItem = { id: 'h1', growerCropId: 'okra', amount: '2.5', unit: 'lb', harvestedOn: '2026-06-10', notes: 'Tender pods.', createdAt: '2026-06-10T12:00:00Z' };

function setup(initial = crop, cached?: HarvestItem[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(['myCrops'], [initial]);
  if (cached) client.setQueryData(['harvests', initial.id], { harvests: cached, harvestCount: cached.length, totalHarvested: '0', growerCropId: initial.id });
  const share = vi.fn();
  const manage = vi.fn();
  function BoundRecord() {
    const { data } = useQuery<GrowerCropItem[]>({ queryKey: ['myCrops'], queryFn: async () => [initial], enabled: false });
    return <PlantRecord crop={data![0]} onOpenHarvests={manage} onShareHarvest={share} />;
  }
  render(<QueryClientProvider client={client}><BoundRecord /></QueryClientProvider>);
  return { share, manage };
}

beforeEach(() => {
  vi.resetAllMocks();
  onlineManager.setOnline(true);
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  vi.mocked(listHarvests).mockResolvedValue({ growerCropId: 'okra', totalHarvested: '0', harvestCount: 0, harvests: [] });
});
afterEach(() => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  onlineManager.setOnline(true);
});

describe('PlantRecord', () => {
  it('shows crop-specific history newest first without adding mixed units together', async () => {
    const newer = { ...harvest, id: 'h2', amount: '6', unit: 'pods', harvestedOn: '2026-06-12' };
    vi.mocked(listHarvests).mockResolvedValue({ growerCropId: 'okra', totalHarvested: '8.5', harvestCount: 3, harvests: [harvest, { ...harvest, id: 'foreign', growerCropId: 'tomato', amount: '99' }, newer] });
    const { share, manage } = setup();
    expect(await screen.findByRole('heading', { name: 'Harvested 6 pods' })).toBeInTheDocument();
    const entries = within(screen.getByRole('list', { name: 'Plant history' })).getAllByRole('listitem');
    expect(entries.map((entry) => within(entry).getByRole('heading').textContent)).toEqual(['Harvested 6 pods', 'Harvested 2.5 lb', 'Planted', 'Added to your garden']);
    expect(screen.queryByText(/99/)).not.toBeInTheDocument();
    expect(screen.queryByText(/8.5/)).not.toBeInTheDocument();
    expect(screen.getAllByText('Tender pods.')).toHaveLength(2);
    await userEvent.click(within(entries[0]).getByRole('button', { name: 'Share from this harvest' }));
    expect(share).toHaveBeenCalledWith(newer);
    await userEvent.click(screen.getByRole('button', { name: 'Manage harvests' }));
    expect(manage).toHaveBeenCalledOnce();
  });

  it('does not invent a planting milestone or harvest when dates are absent', async () => {
    setup({ ...crop, plantingDate: null, notes: null });
    expect(await screen.findByText(/No harvests recorded yet/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Planted' })).not.toBeInTheDocument();
    expect(screen.getByText(/No growing notes yet/)).toBeInTheDocument();
  });

  it('saves and clears notes while preserving the existing crop fields', async () => {
    vi.mocked(updateMyCrop).mockImplementation(async (_id, payload) => ({ ...crop, notes: payload.notes ?? null }));
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Edit notes' }));
    const input = screen.getByRole('textbox', { name: 'What would you like to remember?' });
    await userEvent.clear(input);
    await userEvent.type(input, 'Mulched after rain.');
    await userEvent.click(screen.getByRole('button', { name: 'Save notes' }));
    expect(await screen.findByText('Notes saved.')).toBeInTheDocument();
    expect(screen.getByText('Mulched after rain.')).toBeInTheDocument();
    expect(updateMyCrop).toHaveBeenCalledWith('okra', expect.objectContaining({ notes: 'Mulched after rain.', bedId: 'bed-1', plantingDate: '2026-04-01', plantCount: 3, visibility: 'private', surplusEnabled: false }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit notes' }));
    await userEvent.clear(screen.getByRole('textbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Save notes' }));
    await waitFor(() => expect(updateMyCrop).toHaveBeenLastCalledWith('okra', expect.objectContaining({ notes: '' })));
  });

  it('retains an unsaved draft on failure and cancels without another write', async () => {
    vi.mocked(updateMyCrop).mockRejectedValue(new Error('Unavailable'));
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Edit notes' }));
    await userEvent.type(screen.getByRole('textbox'), ' More mulch.');
    await userEvent.click(screen.getByRole('button', { name: 'Save notes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your draft is still here');
    expect(screen.getByRole('textbox')).toHaveValue('Pick the pods young. More mulch.');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Pick the pods young.')).toBeInTheDocument();
    expect(updateMyCrop).toHaveBeenCalledTimes(1);
  });

  it('preserves cached history during failed refresh and retries', async () => {
    vi.mocked(listHarvests).mockRejectedValue(new Error('Unavailable'));
    setup(crop, [harvest]);
    expect(await screen.findByRole('alert')).toHaveTextContent('Available records are still shown');
    expect(screen.getByRole('heading', { name: 'Harvested 2.5 lb' })).toBeInTheDocument();
    vi.mocked(listHarvests).mockResolvedValue({ growerCropId: 'okra', totalHarvested: '2.5', harvestCount: 1, harvests: [harvest] });
    await userEvent.click(screen.getByRole('button', { name: 'Retry harvest history' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('blocks note writes offline without discarding the draft', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Edit notes' }));
    fireEvent(window, new Event('offline'));
    expect(screen.getByRole('button', { name: 'Save notes' })).toBeDisabled();
    expect(screen.getByRole('textbox')).toHaveValue('Pick the pods young.');
    expect(updateMyCrop).not.toHaveBeenCalled();
    fireEvent(window, new Event('online'));
    expect(screen.getByRole('button', { name: 'Save notes' })).toBeEnabled();
  });
});
