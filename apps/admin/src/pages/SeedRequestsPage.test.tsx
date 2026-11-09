// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SeedRequestQueueItem } from '../api';

const api = vi.hoisted(() => ({
  addSeedRequestMapPin: vi.fn(),
  cancelSeedRequest: vi.fn(),
  listSeedRequestQueue: vi.fn(),
  markSeedRequestHandled: vi.fn(),
  removeSeedRequestMapPin: vi.fn(),
  reopenSeedRequest: vi.fn(),
  setSeedRequestPinAddress: vi.fn(),
}));
const geocoder = vi.hoisted(() => ({ findSeedPinLocation: vi.fn() }));

vi.mock('../api', () => api);
vi.mock('../services/seed-pin-geocoder', () => geocoder);

import { SeedRequestsPage } from './SeedRequestsPage';

const session = { accessToken: 'token', email: 'admin@example.com', displayName: 'Admin', isAdmin: true };

function doneInPerson(overrides: Partial<SeedRequestQueueItem> = {}): SeedRequestQueueItem {
  return {
    id: 'req-1',
    name: 'Sam Visitor',
    email: 'sam@example.com',
    fulfillmentMethod: 'in_person',
    shippingAddress: null,
    pinAddress: { city: 'Austin', region: 'TX', country: 'US' },
    visitDetails: null,
    message: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    requestStatus: 'handled',
    handledAt: '2026-10-02T00:00:00.000Z',
    pinVisibility: 'anonymous',
    mapPin: { locality: 'Austin, TX', country: 'US' },
    ...overrides,
  };
}

async function saveNewAddress() {
  render(<SeedRequestsPage session={session} />);
  fireEvent.click(await screen.findByRole('tab', { name: 'Done' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Edit map address' }));
  const form = await screen.findByRole('form', { name: 'Map address' });
  fireEvent.change(form.querySelector('input[id*="city"]')!, { target: { value: 'Dallas' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save map address' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  api.listSeedRequestQueue.mockResolvedValue({ data: [doneInPerson()], total: 1, page: 1, limit: 10 });
  geocoder.findSeedPinLocation.mockResolvedValue({ lat: 32.78, lng: -96.8, precision: 'city' });
});

afterEach(cleanup);

describe('saving an in-person map address', () => {
  it('reloads the row and says the address was saved when placing the pin fails', async () => {
    api.setSeedRequestPinAddress.mockResolvedValue({
      id: 'req-1',
      pinAddress: { city: 'Dallas', region: 'TX', country: 'US' },
      mapPinRemoved: true,
    });
    api.addSeedRequestMapPin.mockRejectedValue(new Error('Could not write the map pin'));

    const loadsBefore = api.listSeedRequestQueue.mock.calls.length;
    await saveNewAddress();

    expect(await screen.findByText(/Map address saved, but placing the pin failed/)).toBeTruthy();
    expect(screen.getByText(/Could not write the map pin/)).toBeTruthy();
    expect(screen.getByText(/Use "Add to map" to try again/)).toBeTruthy();
    // The committed change is reloaded, not left stale on screen.
    await waitFor(() => expect(api.listSeedRequestQueue.mock.calls.length).toBeGreaterThan(loadsBefore + 1));
  });

  it('warns when the old pin could not be taken off the map', async () => {
    api.setSeedRequestPinAddress.mockResolvedValue({
      id: 'req-1',
      pinAddress: { city: 'Dallas', region: 'TX', country: 'US' },
      mapPinRemoved: null,
    });
    api.addSeedRequestMapPin.mockResolvedValue({ id: 'req-1', mapPin: null });

    await saveNewAddress();

    expect(await screen.findByText(/previous pin couldn’t be taken off the map/)).toBeTruthy();
  });

  it('reports a failed save as an error and does not try to place a pin', async () => {
    api.setSeedRequestPinAddress.mockRejectedValue(new Error('Seed request changed or is missing'));

    await saveNewAddress();

    expect(await screen.findByText(/Seed request changed or is missing/)).toBeTruthy();
    expect(api.addSeedRequestMapPin).not.toHaveBeenCalled();
  });
});
