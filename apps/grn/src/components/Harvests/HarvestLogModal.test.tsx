import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HarvestLogModal } from './HarvestLogModal';

const listHarvests = vi.hoisted(() => vi.fn());
const recordHarvest = vi.hoisted(() => vi.fn());
const updateHarvest = vi.hoisted(() => vi.fn());
const deleteHarvest = vi.hoisted(() => vi.fn());

vi.mock('../../services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/api')>();
  return { ...actual, listHarvests, recordHarvest, updateHarvest, deleteHarvest };
});

function renderModal(
  onShareHarvest?: Parameters<typeof HarvestLogModal>[0]['onShareHarvest'],
  highlightedHarvestId?: string
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <HarvestLogModal
        cropId="crop-1"
        cropName="Tomato"
        defaultUnit="lb"
        onClose={() => {}}
        onShareHarvest={onShareHarvest}
        highlightedHarvestId={highlightedHarvestId}
      />
    </QueryClientProvider>
  );
}

describe('HarvestLogModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listHarvests.mockResolvedValue({
      growerCropId: 'crop-1',
      totalHarvested: '3.5',
      harvestCount: 1,
      harvests: [
        {
          id: 'h1',
          growerCropId: 'crop-1',
          amount: '3.5',
          unit: 'lb',
          harvestedOn: '2026-06-20',
          notes: 'First picking',
          createdAt: '2026-06-20T00:00:00Z',
        },
      ],
    });
  });

  it('shows the running total and existing harvests', async () => {
    renderModal();
    expect(await screen.findByText(/3.5 lb brought in across 1 harvest/i)).toBeInTheDocument();
    expect(screen.getByText(/first picking/i)).toBeInTheDocument();
  });

  it('focuses the exact harvest linked from the journal', async () => {
    renderModal(undefined, 'h1');
    const row = (await screen.findByText(/first picking/i)).closest('li');
    expect(row).toHaveAttribute('aria-current', 'true');
    await waitFor(() => expect(row).toHaveFocus());
  });

  it('logs a new harvest', async () => {
    recordHarvest.mockResolvedValue({
      harvest: {
        id: 'h2',
        growerCropId: 'crop-1',
        amount: '2',
        unit: 'lb',
        harvestedOn: '2026-06-22',
        notes: null,
        createdAt: '2026-06-22T00:00:00Z',
      },
      totalHarvested: '5.5',
      harvestCount: 2,
    });

    renderModal();
    await screen.findByTestId('harvest-total');

    await userEvent.type(screen.getByPlaceholderText('3.5'), '2');
    await userEvent.click(screen.getByRole('button', { name: /log harvest/i }));

    await waitFor(() => expect(recordHarvest).toHaveBeenCalledTimes(1));
    expect(recordHarvest.mock.calls[0][0]).toBe('crop-1');
    expect(recordHarvest.mock.calls[0][1]).toMatchObject({ amount: 2, unit: 'lb' });
  });

  it('starts a food share from the harvest that was just saved', async () => {
    const onShareHarvest = vi.fn();
    const savedHarvest = {
      id: 'h2',
      growerCropId: 'crop-1',
      amount: '2',
      unit: 'lb',
      harvestedOn: '2026-06-22',
      notes: null,
      createdAt: '2026-06-22T00:00:00Z',
    };
    recordHarvest.mockResolvedValue({
      harvest: savedHarvest,
      totalHarvested: '5.5',
      harvestCount: 2,
    });

    renderModal(onShareHarvest);
    await screen.findByTestId('harvest-total');
    await userEvent.type(screen.getByPlaceholderText('3.5'), '2');
    await userEvent.click(screen.getByRole('button', { name: /log harvest/i }));
    await screen.findByRole('button', { name: /share some food/i });
    expect(onShareHarvest).not.toHaveBeenCalled();
    expect(screen.getByText(/2 lb of.*added to your garden story/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /share some food/i }));

    expect(onShareHarvest).toHaveBeenCalledWith(savedHarvest);
  });

  it('starts a food share from an existing harvest', async () => {
    const onShareHarvest = vi.fn();
    renderModal(onShareHarvest);
    const row = (await screen.findByText(/first picking/i)).closest('li') as HTMLElement;

    await userEvent.click(within(row).getByRole('button', { name: /share food/i }));

    expect(onShareHarvest).toHaveBeenCalledWith(expect.objectContaining({ id: 'h1' }));
  });

  it('rejects a non-positive amount before calling the API', async () => {
    renderModal();
    await screen.findByTestId('harvest-total');

    await userEvent.click(screen.getByRole('button', { name: /log harvest/i }));

    expect(recordHarvest).not.toHaveBeenCalled();
    expect(screen.getByText(/amount greater than 0/i)).toBeInTheDocument();
  });

  it('edits an existing harvest', async () => {
    updateHarvest.mockResolvedValue({
      harvest: {
        id: 'h1',
        growerCropId: 'crop-1',
        amount: '6',
        unit: 'lb',
        harvestedOn: '2026-06-20',
        notes: 'First picking',
        createdAt: '2026-06-20T00:00:00Z',
      },
      totalHarvested: '6',
      harvestCount: 1,
    });

    renderModal();
    await screen.findByText(/first picking/i);

    await userEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    const amountInput = screen.getByLabelText(/edit amount/i);
    await userEvent.clear(amountInput);
    await userEvent.type(amountInput, '6');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(updateHarvest).toHaveBeenCalledTimes(1));
    expect(updateHarvest.mock.calls[0][0]).toBe('crop-1');
    expect(updateHarvest.mock.calls[0][1]).toBe('h1');
    expect(updateHarvest.mock.calls[0][2]).toMatchObject({ amount: 6 });
  });

  it('deletes a harvest after confirmation', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    deleteHarvest.mockResolvedValue(undefined);

    renderModal();
    await screen.findByText(/first picking/i);

    const row = screen.getByText(/first picking/i).closest('li') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: /delete/i }));

    await waitFor(() => expect(deleteHarvest).toHaveBeenCalledWith('crop-1', 'h1'));
    confirmSpy.mockRestore();
  });
  it('lets a grower keep a saved harvest without starting a share', async () => {
    const onShareHarvest = vi.fn();
    recordHarvest.mockResolvedValue({ harvest: { id: 'h2', growerCropId: 'crop-1', amount: '2', unit: 'lb', harvestedOn: '2026-06-22', notes: null, createdAt: '2026-06-22T00:00:00Z' }, totalHarvested: '5.5', harvestCount: 2 });
    renderModal(onShareHarvest);
    await userEvent.type(screen.getByPlaceholderText('3.5'), '2');
    await userEvent.click(screen.getByRole('button', { name: /log harvest/i }));
    await userEvent.click(await screen.findByRole('button', { name: /keep for my household/i }));
    expect(screen.queryByRole('button', { name: /share some food/i })).not.toBeInTheDocument();
    expect(onShareHarvest).not.toHaveBeenCalled();
    expect(recordHarvest).toHaveBeenCalledTimes(1);
  });

});
