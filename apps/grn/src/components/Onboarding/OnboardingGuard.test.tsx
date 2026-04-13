import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OnboardingGuard } from './OnboardingGuard';
import * as useUserModule from '../../hooks/useUser';

// Mock the useUser hook
vi.mock('../../hooks/useUser');

// Mock child components
vi.mock('../branding/PlantLoader', () => ({
  PlantLoader: () => <div data-testid="plant-loader">Loading...</div>,
}));

vi.mock('./OnboardingFlow', () => ({
  OnboardingFlow: () => <div data-testid="onboarding-flow">Onboarding Flow</div>,
}));

describe('OnboardingGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading screen while fetching user data', () => {
    vi.spyOn(useUserModule, 'useUser').mockReturnValue({
      user: null,
      isLoading: true,
      error: null,
      refreshUser: vi.fn(),
      clearError: vi.fn(),
    });

    render(
      <OnboardingGuard>
        <div>Main App</div>
      </OnboardingGuard>
    );

    expect(screen.getByTestId('plant-loader')).toBeInTheDocument();
    expect(screen.queryByText('Main App')).not.toBeInTheDocument();
  });

  it('redirects to OnboardingFlow if onboarding is incomplete', () => {
    vi.spyOn(useUserModule, 'useUser').mockReturnValue({
      user: {
        userId: 'test-user-id',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        tier: 'free',
        userType: null,
        onboardingCompleted: false,
        growerProfile: null,
        gathererProfile: null,
      },
      isLoading: false,
      error: null,
      refreshUser: vi.fn(),
      clearError: vi.fn(),
    });

    render(
      <OnboardingGuard>
        <div>Main App</div>
      </OnboardingGuard>
    );

    expect(screen.getByTestId('onboarding-flow')).toBeInTheDocument();
    expect(screen.queryByText('Main App')).not.toBeInTheDocument();
  });

  it('renders children if onboarding is complete', () => {
    vi.spyOn(useUserModule, 'useUser').mockReturnValue({
      user: {
        userId: 'test-user-id',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        tier: 'free',
        userType: 'grower',
        onboardingCompleted: true,
        growerProfile: {
          homeZone: '8a',
          address: '123 Main St, Springfield, IL',
          geoKey: '9q8yy9',
          lat: 37.7749,
          lng: -122.4194,
          shareRadiusMiles: 5.0,
          units: 'imperial',
          locale: 'en-US',
        },
        gathererProfile: null,
      },
      isLoading: false,
      error: null,
      refreshUser: vi.fn(),
      clearError: vi.fn(),
    });

    render(
      <OnboardingGuard>
        <div>Main App</div>
      </OnboardingGuard>
    );

    expect(screen.getByText('Main App')).toBeInTheDocument();
    expect(screen.queryByTestId('onboarding-flow')).not.toBeInTheDocument();
    expect(screen.queryByTestId('plant-loader')).not.toBeInTheDocument();
  });

  it('redirects to OnboardingFlow when user is null and not loading', () => {
    vi.spyOn(useUserModule, 'useUser').mockReturnValue({
      user: null,
      isLoading: false,
      error: null,
      refreshUser: vi.fn(),
      clearError: vi.fn(),
    });

    render(
      <OnboardingGuard>
        <div>Main App</div>
      </OnboardingGuard>
    );

    expect(screen.getByTestId('onboarding-flow')).toBeInTheDocument();
    expect(screen.queryByText('Main App')).not.toBeInTheDocument();
  });
});
