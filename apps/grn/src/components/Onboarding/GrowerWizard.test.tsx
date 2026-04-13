import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GrowerWizard } from './GrowerWizard';

describe('GrowerWizard', () => {
  const mockOnComplete = vi.fn();

  const mockGeolocation = {
    getCurrentPosition: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ display_name: '123 Main St, Springfield, IL' }),
    }));

    // @ts-expect-error test geolocation override
    global.navigator.geolocation = mockGeolocation;
    mockGeolocation.getCurrentPosition.mockImplementation(
      (_success: unknown, error: (e: { code: number; message: string; }) => void) => {
        error({ code: 1, message: 'denied' });
      }
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders address-based location step', () => {
    render(<GrowerWizard onComplete={mockOnComplete} />);

    expect(screen.getByText('Where are you growing?')).toBeInTheDocument();
    expect(screen.getByLabelText(/Address/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Latitude/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Longitude/i)).not.toBeInTheDocument();
  });

  it('fills address from geolocation when reverse geocoding succeeds', async () => {
    mockGeolocation.getCurrentPosition.mockImplementation((success: (v: { coords: { latitude: number; longitude: number; }; }) => void) => {
      success({
        coords: {
          latitude: 37.7749,
          longitude: -122.4194,
        },
      });
    });

    render(<GrowerWizard onComplete={mockOnComplete} />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('123 Main St, Springfield, IL')).toBeInTheDocument();
    });
  });

  it('submits address in grower payload', async () => {
    render(<GrowerWizard onComplete={mockOnComplete} />);

    const addressInput = screen.getByLabelText(/Address/i);
    fireEvent.change(addressInput, {
      target: { value: '123 Main St, Springfield, IL' },
    });

    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    const zoneInput = await screen.findByLabelText(/USDA Hardiness Zone/i);
    fireEvent.change(zoneInput, { target: { value: '8a' } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    fireEvent.click(await screen.findByRole('button', { name: /complete setup/i }));

    await waitFor(() => {
      expect(mockOnComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          homeZone: '8a',
          address: '123 Main St, Springfield, IL',
          shareRadiusMiles: 5,
        })
      );
    });
  });
});
