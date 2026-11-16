import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SharedGardenPage } from './SharedGardenPage';
import { ApiError, type SharedGardenSnapshot } from '../services/api';

vi.mock('../services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/api')>();
  return {
    ...actual,
    fetchSharedGarden: vi.fn(),
  };
});

import { fetchSharedGarden } from '../services/api';

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  // jsdom lacks matchMedia; PlantLoader queries prefers-reduced-motion.
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  );
});

beforeEach(() => {
  vi.mocked(fetchSharedGarden).mockReset();
});

const snapshot: SharedGardenSnapshot = {
  canvas: { widthInches: 360, heightInches: 240, northOffsetDeg: 0 },
  beds: [
    {
      id: 'bed-1',
      name: 'Herb spiral',
      bedType: 'raised',
      shape: 'rect',
      sunExposure: 'full_sun',
      soilType: null,
      lengthInches: 96,
      widthInches: 48,
      positionX: 24,
      positionY: 24,
      rotationDeg: 0,
      points: null,
      color: null,
      sortOrder: 0,
    },
  ],
  annotations: [],
  crops: [{ bedId: 'bed-1', cropName: 'Tomato', plantCount: 4 }],
};

function renderPage(token = 'a'.repeat(32)) {
  return render(
    <MemoryRouter initialEntries={[`/shared/${token}`]}>
      <Routes>
        <Route path="/shared/:token" element={<SharedGardenPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('SharedGardenPage', () => {
  it('renders the shared masterplan with its beds', async () => {
    vi.mocked(fetchSharedGarden).mockResolvedValue(snapshot);
    renderPage();
    expect(
      await screen.findByRole('button', { name: /herb spiral/i })
    ).toBeInTheDocument();
    expect(screen.getByText(/a shared garden/i)).toBeInTheDocument();
    expect(
      screen.getByText(/made with the free good roots garden planner/i)
    ).toBeInTheDocument();
  });

  it('shows a friendly not-found state for dead links', async () => {
    vi.mocked(fetchSharedGarden).mockRejectedValue(new ApiError('nope', 404));
    renderPage();
    expect(
      await screen.findByText(/doesn’t exist or was turned off/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/ask the gardener for a fresh link/i)).toBeInTheDocument();
  });

  it('shows a retry message on other errors', async () => {
    vi.mocked(fetchSharedGarden).mockRejectedValue(new ApiError('boom', 500));
    renderPage();
    expect(
      await screen.findByText(/couldn’t load this garden right now/i)
    ).toBeInTheDocument();
  });
});
