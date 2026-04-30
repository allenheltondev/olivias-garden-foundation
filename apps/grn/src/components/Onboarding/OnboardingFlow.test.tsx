import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { OnboardingFlow } from './OnboardingFlow';
import * as useUserModule from '../../hooks/useUser';
import * as useOnboardingModule from '../../hooks/useOnboarding';
import type { UserProfile } from '../../types/user';

// Mock the useUser hook
vi.mock('../../hooks/useUser');

// Mock the useOnboarding hook
vi.mock('../../hooks/useOnboarding');

// Mock the logger
vi.mock('../../utils/logging', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('OnboardingFlow', () => {
  const mockUseUser = vi.mocked(useUserModule.useUser);
  const mockUseOnboarding = vi.mocked(useOnboardingModule.useOnboarding);

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mock for useOnboarding
    mockUseOnboarding.mockReturnValue({
      submitUserType: vi.fn().mockResolvedValue(undefined),
      submitGrowerProfile: vi.fn().mockResolvedValue(undefined),
      submitGathererProfile: vi.fn().mockResolvedValue(undefined),
      clearError: vi.fn(),
      isSubmitting: false,
      error: null,
    });
  });

  describe('Initial state - no userType selected', () => {
    it('should display user type selection when user has no userType', () => {
      const mockUser: UserProfile = {
        userId: 'test-user-id',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        tier: 'free',
        userType: null,
        onboardingCompleted: false,
        growerProfile: null,
        gathererProfile: null,
      };

      mockUseUser.mockReturnValue({
        user: mockUser,
        isLoading: false,
        error: null,
        refreshUser: vi.fn(),
        clearError: vi.fn(),
      });

      render(<MemoryRouter><OnboardingFlow /></MemoryRouter>);

      expect(screen.getByText(/How would you like to participate/i)).toBeInTheDocument();
      expect(screen.getByText(/I'm a Grower/i)).toBeInTheDocument();
      expect(screen.getByText(/I'm a Gatherer/i)).toBeInTheDocument();
    });

    it('should show grower description', () => {
      const mockUser: UserProfile = {
        userId: 'test-user-id',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        tier: 'free',
        userType: null,
        onboardingCompleted: false,
        growerProfile: null,
        gathererProfile: null,
      };

      mockUseUser.mockReturnValue({
        user: mockUser,
        isLoading: false,
        error: null,
        refreshUser: vi.fn(),
        clearError: vi.fn(),
      });

      render(<MemoryRouter><OnboardingFlow /></MemoryRouter>);

      expect(screen.getByText(/I grow food and want to share my surplus/i)).toBeInTheDocument();
    });

    it('should show gatherer description', () => {
      const mockUser: UserProfile = {
        userId: 'test-user-id',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        tier: 'free',
        userType: null,
        onboardingCompleted: false,
        growerProfile: null,
        gathererProfile: null,
      };

      mockUseUser.mockReturnValue({
        user: mockUser,
        isLoading: false,
        error: null,
        refreshUser: vi.fn(),
        clearError: vi.fn(),
      });

      render(<MemoryRouter><OnboardingFlow /></MemoryRouter>);

      expect(screen.getByText(/I'm looking for locally grown food/i)).toBeInTheDocument();
    });
  });

  describe('User type selection', () => {
    it('should navigate to grower wizard when grower is selected', async () => {
      const user = userEvent.setup();
      const mockUser: UserProfile = {
        userId: 'test-user-id',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        tier: 'free',
        userType: null,
        onboardingCompleted: false,
        growerProfile: null,
        gathererProfile: null,
      };

      mockUseUser.mockReturnValue({
        user: mockUser,
        isLoading: false,
        error: null,
        refreshUser: vi.fn(),
        clearError: vi.fn(),
      });

      render(<MemoryRouter><OnboardingFlow /></MemoryRouter>);

      const growerButton = screen.getByRole('button', { name: /I'm a Grower/i });
      await user.click(growerButton);

      // Click continue button
      const continueButton = screen.getByRole('button', { name: /Continue/i });
      await user.click(continueButton);

      await waitFor(() => {
        expect(screen.getByText(/Where are you growing/i)).toBeInTheDocument();
      });
    });

    it('should navigate to gatherer wizard when gatherer is selected', async () => {
      const user = userEvent.setup();
      const mockUser: UserProfile = {
        userId: 'test-user-id',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        tier: 'free',
        userType: null,
        onboardingCompleted: false,
        growerProfile: null,
        gathererProfile: null,
      };

      mockUseUser.mockReturnValue({
        user: mockUser,
        isLoading: false,
        error: null,
        refreshUser: vi.fn(),
        clearError: vi.fn(),
      });

      render(<MemoryRouter><OnboardingFlow /></MemoryRouter>);

      const gathererButton = screen.getByRole('button', { name: /I'm a Gatherer/i });
      await user.click(gathererButton);

      // Click continue button
      const continueButton = screen.getByRole('button', { name: /Continue/i });
      await user.click(continueButton);

      await waitFor(() => {
        expect(screen.getByText(/Where are you looking/i)).toBeInTheDocument();
      });
    });
  });

  describe('Resume onboarding', () => {
    it('should resume at grower wizard if userType is grower but onboarding incomplete', () => {
      const mockUser: UserProfile = {
        userId: 'test-user-id',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        tier: 'free',
        userType: 'grower',
        onboardingCompleted: false,
        growerProfile: null,
        gathererProfile: null,
      };

      mockUseUser.mockReturnValue({
        user: mockUser,
        isLoading: false,
        error: null,
        refreshUser: vi.fn(),
        clearError: vi.fn(),
      });

      render(<MemoryRouter><OnboardingFlow /></MemoryRouter>);

      expect(screen.getByText(/Where are you growing/i)).toBeInTheDocument();
      expect(screen.queryByText(/How would you like to participate/i)).not.toBeInTheDocument();
    });

    it('should resume at gatherer wizard if userType is gatherer but onboarding incomplete', () => {
      const mockUser: UserProfile = {
        userId: 'test-user-id',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        tier: 'free',
        userType: 'gatherer',
        onboardingCompleted: false,
        growerProfile: null,
        gathererProfile: null,
      };

      mockUseUser.mockReturnValue({
        user: mockUser,
        isLoading: false,
        error: null,
        refreshUser: vi.fn(),
        clearError: vi.fn(),
      });

      render(<MemoryRouter><OnboardingFlow /></MemoryRouter>);

      expect(screen.getByText(/Where are you looking/i)).toBeInTheDocument();
      expect(screen.queryByText(/How would you like to participate/i)).not.toBeInTheDocument();
    });
  });

  describe('Navigation', () => {
    it('should allow navigating back from grower wizard to user type selection', async () => {
      const user = userEvent.setup();
      const mockUser: UserProfile = {
        userId: 'test-user-id',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        tier: 'free',
        userType: null,
        onboardingCompleted: false,
        growerProfile: null,
        gathererProfile: null,
      };

      mockUseUser.mockReturnValue({
        user: mockUser,
        isLoading: false,
        error: null,
        refreshUser: vi.fn(),
        clearError: vi.fn(),
      });

      render(<MemoryRouter><OnboardingFlow /></MemoryRouter>);

      // Navigate to grower wizard
      const growerButton = screen.getByRole('button', { name: /I'm a Grower/i });
      await user.click(growerButton);

      const continueButton = screen.getByRole('button', { name: /Continue/i });
      await user.click(continueButton);

      await waitFor(() => {
        expect(screen.getByText(/Where are you growing/i)).toBeInTheDocument();
      });

      // Navigate back
      const backButton = screen.getByRole('button', { name: /Back/i });
      await user.click(backButton);

      await waitFor(() => {
        expect(screen.getByText(/How would you like to participate/i)).toBeInTheDocument();
      });
    });

    it('should allow navigating back from gatherer wizard to user type selection', async () => {
      const user = userEvent.setup();
      const mockUser: UserProfile = {
        userId: 'test-user-id',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        tier: 'free',
        userType: null,
        onboardingCompleted: false,
        growerProfile: null,
        gathererProfile: null,
      };

      mockUseUser.mockReturnValue({
        user: mockUser,
        isLoading: false,
        error: null,
        refreshUser: vi.fn(),
        clearError: vi.fn(),
      });

      render(<MemoryRouter><OnboardingFlow /></MemoryRouter>);

      // Navigate to gatherer wizard
      const gathererButton = screen.getByRole('button', { name: /I'm a Gatherer/i });
      await user.click(gathererButton);

      const continueButton = screen.getByRole('button', { name: /Continue/i });
      await user.click(continueButton);

      await waitFor(() => {
        expect(screen.getByText(/Where are you looking/i)).toBeInTheDocument();
      });

      // Navigate back
      const backButton = screen.getByRole('button', { name: /Back/i });
      await user.click(backButton);

      await waitFor(() => {
        expect(screen.getByText(/How would you like to participate/i)).toBeInTheDocument();
      });
    });
  });

  describe('User data updates', () => {
    it('should update to wizard step when user data changes with userType', async () => {
      const mockUser: UserProfile = {
        userId: 'test-user-id',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        tier: 'free',
        userType: null,
        onboardingCompleted: false,
        growerProfile: null,
        gathererProfile: null,
      };

      const { rerender } = render(<MemoryRouter><OnboardingFlow /></MemoryRouter>);

      mockUseUser.mockReturnValue({
        user: mockUser,
        isLoading: false,
        error: null,
        refreshUser: vi.fn(),
        clearError: vi.fn(),
      });

      // Initially at user type selection
      expect(screen.getByText(/How would you like to participate/i)).toBeInTheDocument();

      // Update user with userType
      const updatedUser: UserProfile = {
        ...mockUser,
        userType: 'grower',
      };

      mockUseUser.mockReturnValue({
        user: updatedUser,
        isLoading: false,
        error: null,
        refreshUser: vi.fn(),
        clearError: vi.fn(),
      });

      rerender(<MemoryRouter><OnboardingFlow /></MemoryRouter>);

      await waitFor(() => {
        expect(screen.getByText(/Where are you growing/i)).toBeInTheDocument();
      });
    });
  });
});
