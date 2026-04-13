import { useState, useEffect, useCallback } from 'react';
import { getMe, ApiError } from '../services/api';
import type { UserProfile } from '../types/user';
import { logger } from '../utils/logging';

/**
 * User state interface
 */
export interface UserState {
  user: UserProfile | null;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Custom hook for managing user profile data
 *
 * Features:
 * - Fetches user profile including onboarding status
 * - Includes growerProfile and gathererProfile when available
 * - Manages loading and error states
 * - Provides refresh method to reload user data
 * - Automatically fetches on mount
 *
 * @returns User state and methods
 */
export function useUser() {
  const [userState, setUserState] = useState<UserState>({
    user: null,
    isLoading: true,
    error: null,
  });

  /**
   * Fetch user profile from the API
   */
  const fetchUser = useCallback(async () => {
    try {
      setUserState((prev) => ({ ...prev, isLoading: true, error: null }));

      const userProfile = await getMe();

      setUserState({
        user: userProfile,
        isLoading: false,
        error: null,
      });

      logger.info('User profile fetched successfully', {
        userId: userProfile.userId,
        userType: userProfile.userType,
        onboardingCompleted: userProfile.onboardingCompleted,
      });
    } catch (error) {
      const err = error as ApiError;
      logger.error('Failed to fetch user profile', err, {
        statusCode: err.statusCode,
        correlationId: err.correlationId,
      });

      setUserState({
        user: null,
        isLoading: false,
        error: err,
      });
    }
  }, []);

  /**
   * Clear any errors
   */
  const clearError = useCallback(() => {
    setUserState((prev) => ({ ...prev, error: null }));
  }, []);

  // Fetch user profile on mount
  useEffect(() => {
    let isMounted = true;

    const loadUser = async () => {
      try {
        setUserState((prev) => ({ ...prev, isLoading: true, error: null }));

        const userProfile = await getMe();

        if (isMounted) {
          setUserState({
            user: userProfile,
            isLoading: false,
            error: null,
          });

          logger.info('User profile fetched successfully', {
            userId: userProfile.userId,
            userType: userProfile.userType,
            onboardingCompleted: userProfile.onboardingCompleted,
          });
        }
      } catch (error) {
        const err = error as ApiError;
        logger.error('Failed to fetch user profile', err, {
          statusCode: err.statusCode,
          correlationId: err.correlationId,
        });

        if (isMounted) {
          setUserState({
            user: null,
            isLoading: false,
            error: err,
          });
        }
      }
    };

    void loadUser();

    return () => {
      isMounted = false;
    };
  }, []);

  return {
    ...userState,
    refreshUser: fetchUser,
    clearError,
  };
}

export default useUser;
