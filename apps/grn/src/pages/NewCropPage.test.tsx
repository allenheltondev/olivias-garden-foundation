import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { NewCropPage } from './NewCropPage';
import { getMe, listMyBeds } from '../services/api';
import type { CropFormProps } from '../components/CropPlanner/CropForm';

vi.mock('../services/api', () => ({ getMe: vi.fn(), listMyBeds: vi.fn() }));
vi.mock('../utils/todayActionTracking', () => ({ completeTodayAction: vi.fn() }));
vi.mock('../components/CropPlanner/CropForm', () => ({
  CropForm: ({ onSuccess, onCancel, initialBedId }: CropFormProps) => <>
    <button onClick={() => onSuccess({ id: 'new-crop', bedId: initialBedId } as Parameters<CropFormProps['onSuccess']>[0])}>Save crop</button>
    <button onClick={onCancel}>Cancel</button>
  </>,
}));
function Location() {
  const location = useLocation();
  return <><output data-testid="save-state">{location.state?.savedCropId}</output><output data-testid="location">{location.pathname}{location.search}{location.hash}</output></>;
}
function setup(query = '') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/garden/plants/new${query}`]}><NewCropPage /><Location /></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  vi.mocked(getMe).mockResolvedValue({ id: 'user', userType: 'grower' } as Awaited<ReturnType<typeof getMe>>);
  vi.mocked(listMyBeds).mockResolvedValue([{ id: 'kitchen', name: 'Kitchen bed' }] as Awaited<ReturnType<typeof listMyBeds>>);
});
describe('NewCropPage context', () => {
  it('returns a saved crop to its originating bed', async () => {
    setup('?bedId=kitchen');
    await userEvent.click(await screen.findByRole('button', { name: 'Save crop' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/garden?bed=kitchen&crop=new-crop');
  });
  it('preserves season context when returning to the planner', async () => {
    setup(`?returnTo=${encodeURIComponent('/garden/plan?season=2026')}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Save crop' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/garden/plan?season=2026&crop=new-crop');
    expect(screen.getByTestId('save-state')).toHaveTextContent('new-crop');
  });
  it('clears an old plant modal when opening a newly saved plant', async () => {
    setup(`?returnTo=${encodeURIComponent('/garden/plants?season=fall&crop=old&action=harvest&harvest=old-harvest')}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Save crop' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/garden/plants?season=fall&crop=new-crop');
    expect(screen.getByTestId('location').textContent).not.toContain('action=');
    expect(screen.getByTestId('location').textContent).not.toContain('harvest=');
  });
  it('retains the original modal context when cancelling', async () => {
    setup(`?returnTo=${encodeURIComponent('/garden/plants?crop=old&action=timing&season=fall')}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/garden/plants?crop=old&action=timing&season=fall');
  });
  it('does not silently assign a crop when its requested bed was removed', async () => {
    setup('?bedId=removed-bed');
    expect(await screen.findByRole('alert')).toHaveTextContent('This garden bed is no longer available');
    expect(screen.queryByRole('button', { name: 'Save crop' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open garden' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/garden');
  });
  it('cancels back to the selected planning season and layer', async () => {
    setup(`?returnTo=${encodeURIComponent('/garden/plan?tier=4&season=fall')}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/garden/plan?tier=4&season=fall');
  });
  it('cancels back to the originating view without creating crop context', async () => {
    setup(`?returnTo=${encodeURIComponent('/garden?bed=bed-2&season=2026')}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/garden?bed=bed-2&season=2026');
  });
  it.each(['https://example.com/garden', '//example.com/garden', '/settings', '/garden/plants/new'])('rejects an unsafe or unsupported return path: %s', async (path) => {
    setup(`?returnTo=${encodeURIComponent(path)}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/garden/plants');
  });
  it('shows a recoverable error instead of rendering an uninitialized crop form', async () => {
    vi.mocked(listMyBeds).mockRejectedValue(new Error('Unavailable'));
    setup('?bedId=kitchen');
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not load your garden');
    expect(screen.queryByRole('button', { name: 'Save crop' })).not.toBeInTheDocument();
  });
});
