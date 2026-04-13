import { useState, useCallback } from 'react';
import { updateMe, ApiError, type UpdateUserProfileRequest } from '../services/api';
import type { UserType } from '../types/user';
import { logger } from '../utils/logging';

/**
 * Onboarding state interface
 */
export interface OnboardingState {
  isSubmitting: boolean;
  error: Error | null;
}

/**
 * Grower profile input data (without server-computed fields)
 */
export interface GrowerProfileInput {
  homeZone: string;
  address: string;
  shareRadiusMiles: number;
  units: 'metric' | 'imperial';
  locale: string;
}

/**
 * Gatherer profile input data (without server-computed fields)
 */
export interface GathererProfileInput {
  address: string;
  searchRadiusMiles: number;
  organizationAffiliation?: string;
  units: 'metric' | 'imperial';
  locale: string;
}

/**
 * Custom hook for managing user onboarding flow
 */
export function useOnboarding(onSuccess?: () => void) {
  const [state, setState] = useState<OnboardingState>({
    isSubmitting: false,
    error: null,
  });

  const submitUserType = useCallback(
    async (userType: UserType): Promise<void> => {
      try {
        setState({ isSubmitting: true, error: null });

        logger.info('Submitting user type selection', { userType });

        await updateMe({ userType });

        setState({ isSubmitting: false, error: null });

        logger.info('User type submitted successfully', { userType });

        onSuccess?.();
      } catch (error) {
        const err = error as ApiError;
        logger.error('Failed to submit user type', err, {
          userType,
          statusCode: err.statusCode,
          correlationId: err.correlationId,
        });

        setState({ isSubmitting: false, error: err });
        throw err;
      }
    },
    [onSuccess]
  );

  const submitGrowerProfile = useCallback(
    async (profileData: GrowerProfileInput): Promise<void> => {
      try {
        setState({ isSubmitting: true, error: null });

        logger.info('Submitting grower profile', {
          homeZone: profileData.homeZone,
          hasAddress: !!profileData.address,
          shareRadiusMiles: profileData.shareRadiusMiles,
        });

        const payload: UpdateUserProfileRequest = {
          userType: 'grower',
          growerProfile: profileData,
        };

        await updateMe(payload);

        setState({ isSubmitting: false, error: null });

        logger.info('Grower profile submitted successfully');

        onSuccess?.();
      } catch (error) {
        const err = error as ApiError;
        logger.error('Failed to submit grower profile', err, {
          statusCode: err.statusCode,
          correlationId: err.correlationId,
        });

        setState({ isSubmitting: false, error: err });
        throw err;
      }
    },
    [onSuccess]
  );

  const submitGathererProfile = useCallback(
    async (profileData: GathererProfileInput): Promise<void> => {
      try {
        setState({ isSubmitting: true, error: null });

        logger.info('Submitting gatherer profile', {
          hasAddress: !!profileData.address,
          searchRadiusMiles: profileData.searchRadiusMiles,
          hasOrganization: !!profileData.organizationAffiliation,
        });

        const payload: UpdateUserProfileRequest = {
          userType: 'gatherer',
          gathererProfile: profileData,
        };

        await updateMe(payload);

        setState({ isSubmitting: false, error: null });

        logger.info('Gatherer profile submitted successfully');

        onSuccess?.();
      } catch (error) {
        const err = error as ApiError;
        logger.error('Failed to submit gatherer profile', err, {
          statusCode: err.statusCode,
          correlationId: err.correlationId,
        });

        setState({ isSubmitting: false, error: err });
        throw err;
      }
    },
    [onSuccess]
  );

  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  return {
    ...state,
    submitUserType,
    submitGrowerProfile,
    submitGathererProfile,
    clearError,
  };
}

export default useOnboarding;
