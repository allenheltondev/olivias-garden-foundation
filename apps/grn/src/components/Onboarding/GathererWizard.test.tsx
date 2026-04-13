import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GathererWizard } from './GathererWizard';

describe('GathererWizard', () => {
  const mockOnComplete = vi.fn();

  const mockGeolocation = {
    getCurrentPosition: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ display_name: '456 Oak Ave, Springfield, IL' }),
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
    render(<GathererWizard onComplete={mockOnComplete} />);

    expect(screen.getByText('Where are you located?')).toBeInTheDocument();
    expect(screen.getByLabelText(/Address/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('37.7749')).not.toBeInTheDocument();
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

    render(<GathererWizard onComplete={mockOnComplete} />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('456 Oak Ave, Springfield, IL')).toBeInTheDocument();
    });
  });

  it('submits address in gatherer payload', async () => {
    render(<GathererWizard onComplete={mockOnComplete} />);

    const addressInput = screen.getByLabelText(/Address/i);
    fireEvent.change(addressInput, {
      target: { value: '456 Oak Ave, Springfield, IL' },
    });

    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    const submitButton = await screen.findByRole('button', { name: /complete setup/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockOnComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          address: '456 Oak Ave, Springfield, IL',
          searchRadiusMiles: 10,
        })
      );
    });
  });
});
