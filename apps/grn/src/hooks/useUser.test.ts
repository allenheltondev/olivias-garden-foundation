import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useUser } from './useUser';
import * as api from '../services/api';
import type { UserProfile } from '../types/user';

// Mock the API module
vi.mock('../services/api');

// Mock the logger
vi.mock('../utils/logging', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe('useUser', () => {
  const mockUserProfile: UserProfile = {
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
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch user profile on mount', async () => {
    vi.mocked(api.getMe).mockResolvedValue(mockUserProfile);

    const { result } = renderHook(() => useUser());

    // Initially loading
    expect(result.current.isLoading).toBe(true);
    expect(result.current.user).toBeNull();
    expect(result.current.error).toBeNull();

    // Wait for the fetch to complete
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Should have user data
    expect(result.current.user).toEqual(mockUserProfile);
    expect(result.current.error).toBeNull();
    expect(api.getMe).toHaveBeenCalledTimes(1);
  });

  it('should include onboardingCompleted and userType in response', async () => {
    vi.mocked(api.getMe).mockResolvedValue(mockUserProfile);

    const { result } = renderHook(() => useUser());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.user?.onboardingCompleted).toBe(true);
    expect(result.current.user?.userType).toBe('grower');
  });

  it('should include growerProfile when user is a grower', async () => {
    vi.mocked(api.getMe).mockResolvedValue(mockUserProfile);

    const { result } = renderHook(() => useUser());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.user?.growerProfile).toBeDefined();
    expect(result.current.user?.growerProfile?.homeZone).toBe('8a');
    expect(result.current.user?.growerProfile?.shareRadiusMiles).toBe(5.0);
    expect(result.current.user?.gathererProfile).toBeNull();
  });

  it('should include gathererProfile when user is a gatherer', async () => {
    const gathererProfile: UserProfile = {
      ...mockUserProfile,
      userType: 'gatherer',
      growerProfile: null,
      gathererProfile: {
        address: '456 Oak Ave, Springfield, IL',
        geoKey: '9q8yy9',
        lat: 37.7749,
        lng: -122.4194,
        searchRadiusMiles: 10.0,
        organizationAffiliation: 'SF Food Bank',
        units: 'metric',
        locale: 'en-US',
      },
    };

    vi.mocked(api.getMe).mockResolvedValue(gathererProfile);

    const { result } = renderHook(() => useUser());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.user?.gathererProfile).toBeDefined();
    expect(result.current.user?.gathererProfile?.searchRadiusMiles).toBe(10.0);
    expect(result.current.user?.gathererProfile?.organizationAffiliation).toBe('SF Food Bank');
    expect(result.current.user?.growerProfile).toBeNull();
  });

  it('should handle incomplete onboarding', async () => {
    const incompleteUser: UserProfile = {
      ...mockUserProfile,
      userType: null,
      onboardingCompleted: false,
      growerProfile: null,
      gathererProfile: null,
    };

    vi.mocked(api.getMe).mockResolvedValue(incompleteUser);

    const { result } = renderHook(() => useUser());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.user?.onboardingCompleted).toBe(false);
    expect(result.current.user?.userType).toBeNull();
    expect(result.current.user?.growerProfile).toBeNull();
    expect(result.current.user?.gathererProfile).toBeNull();
  });

  it('should handle API errors', async () => {
    const apiError = new api.ApiError('Failed to fetch user', 500, 'correlation-id');
    vi.mocked(api.getMe).mockRejectedValue(apiError);

    const { result } = renderHook(() => useUser());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.user).toBeNull();
    expect(result.current.error).toBeDefined();
    expect(result.current.error).toBeInstanceOf(api.ApiError);
  });

  it('should refresh user data when refreshUser is called', async () => {
    vi.mocked(api.getMe).mockResolvedValue(mockUserProfile);

    const { result } = renderHook(() => useUser());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(api.getMe).toHaveBeenCalledTimes(1);

    // Call refreshUser
    act(() => {
      result.current.refreshUser();
    });

    await waitFor(() => {
      expect(api.getMe).toHaveBeenCalledTimes(2);
    });
  });

  it('should clear errors when clearError is called', async () => {
    const apiError = new api.ApiError('Failed to fetch user', 500, 'correlation-id');
    vi.mocked(api.getMe).mockRejectedValue(apiError);

    const { result } = renderHook(() => useUser());

    await waitFor(() => {
      expect(result.current.error).toBeDefined();
    });

    // Clear the error
    act(() => {
      result.current.clearError();
    });

    expect(result.current.error).toBeNull();
  });
});
