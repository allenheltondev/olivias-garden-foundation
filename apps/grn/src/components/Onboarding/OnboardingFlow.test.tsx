import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { OnboardingFlow } from './OnboardingFlow';
import * as useOnboardingModule from '../../hooks/useOnboarding';
import type { UserProfile } from '../../types/user';

vi.mock('../../hooks/useOnboarding');

vi.mock('../../utils/logging', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

const baseUser: UserProfile = {
  id: 'test-user-id',
  email: 'test@example.com',
  displayName: 'Test User',
  userType: null,
  onboardingCompleted: false,
  subscription: { tier: 'free' },
  growerProfile: null,
};

function LocationDisplay() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

describe('OnboardingFlow', () => {
  const mockUseOnboarding = vi.mocked(useOnboardingModule.useOnboarding);

  beforeEach(() => {
    vi.clearAllMocks();

    mockUseOnboarding.mockReturnValue({
      submitGrowerProfile: vi.fn().mockResolvedValue(undefined),
      clearError: vi.fn(),
      isSubmitting: false,
      error: null,
    });
  });

  it('goes straight into the grower setup wizard — grower-only', () => {
    render(
      <MemoryRouter>
        <OnboardingFlow user={baseUser} refreshUser={vi.fn()} />
      </MemoryRouter>
    );

    // The wizard opens on its own welcome screen — no participation-mode picker.
    expect(screen.getByText(/Welcome to Good Roots/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /set up my garden/i })).toBeInTheDocument();
  });

  it('does not render a dead Back button on the first step', () => {
    render(
      <MemoryRouter>
        <OnboardingFlow user={baseUser} refreshUser={vi.fn()} />
      </MemoryRouter>
    );

    expect(screen.queryByRole('button', { name: /^Back$/i })).not.toBeInTheDocument();
  });

  it('starts in the grower wizard for a user resuming onboarding', () => {
    const resuming: UserProfile = { ...baseUser, userType: 'grower' };

    render(
      <MemoryRouter>
        <OnboardingFlow user={resuming} refreshUser={vi.fn()} />
        <LocationDisplay />
      </MemoryRouter>
    );

    expect(screen.getByText(/Welcome to Good Roots/i)).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/');
  });
  it.each([
    ['/', '/garden/plants/new'],
    ['/share/find?radius=5', '/share/find?radius=5'],
  ])('continues setup from %s to %s', async (entry, destination) => {
    const refreshUser = vi.fn();
    render(<MemoryRouter initialEntries={[entry]}><OnboardingFlow user={baseUser} refreshUser={refreshUser} /><LocationDisplay /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /set up my garden/i }));
    fireEvent.change(screen.getByLabelText(/Address/i), { target: { value: '123 Main St, Springfield, IL' } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.change(screen.getByLabelText(/USDA Hardiness Zone/i), { target: { value: '8a' } });
    fireEvent.click(screen.getByRole('button', { name: /complete setup/i }));
    await waitFor(() => expect(refreshUser).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(destination));
  });

  it('does not send a grower with an existing profile into first-plant setup', async () => {
    const user = { ...baseUser, userType: 'grower' as const, growerProfile: { homeZone: '8a', address: '123 Main St, Springfield, IL', geoKey: 'abc', shareRadiusMiles: 5, isOrganization: false, units: 'imperial' as const, locale: 'en-US' } };
    const refreshUser = vi.fn();
    render(<MemoryRouter><OnboardingFlow user={user} refreshUser={refreshUser} /><LocationDisplay /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /set up my garden/i }));
    fireEvent.change(screen.getByLabelText(/Address/i), { target: { value: '123 Main St, Springfield, IL' } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.change(screen.getByLabelText(/USDA Hardiness Zone/i), { target: { value: '8a' } });
    fireEvent.click(screen.getByRole('button', { name: /complete setup/i }));
    await waitFor(() => expect(refreshUser).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('location').textContent).toBe('/');
  });

});
