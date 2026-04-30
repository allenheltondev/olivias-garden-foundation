import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../../hooks/useUser';
import { useOnboarding } from '../../hooks/useOnboarding';
import type { UserType } from '../../types/user';
import { logger } from '../../utils/logging';
import { GrowerWizard } from './GrowerWizard';
import { GathererWizard } from './GathererWizard';
import { UserTypeSelection } from './UserTypeSelection';

/**
 * Onboarding step types
 */
export type OnboardingStep = 'user-type' | 'grower-wizard' | 'gatherer-wizard';

/**
 * Onboarding flow state
 */
export interface OnboardingFlowState {
  step: OnboardingStep;
  userType: UserType | null;
}

/**
 * OnboardingFlow Component
 *
 * Orchestrates the onboarding wizard experience.
 * - Manages state for onboarding steps
 * - Tracks current step: 'user-type', 'grower-wizard', or 'gatherer-wizard'
 * - Tracks selected userType
 * - Resumes correct step if userType already set but onboarding incomplete
 * - Renders appropriate step component based on state
 * - Handles navigation between steps
 *
 * Validates Requirements 2.1, 1.4, 7.3
 */
export function OnboardingFlow() {
  const { user, refreshUser } = useUser();
  const navigate = useNavigate();
  const isInitialMount = useRef(true);
  const { submitUserType, submitGrowerProfile, submitGathererProfile } = useOnboarding(
    () => {
      logger.info('Onboarding step completed');
      // Refetch user data to update onboardingCompleted status
      refreshUser();
    }
  );

  // Initialize state based on user's current onboarding status
  const [state, setState] = useState<OnboardingFlowState>(() => {
    // If user already has a userType but onboarding is incomplete,
    // resume at the appropriate wizard step
    if (user?.userType) {
      const wizardStep: OnboardingStep =
        user.userType === 'grower' ? 'grower-wizard' : 'gatherer-wizard';

      logger.info('Resuming onboarding flow', {
        userType: user.userType,
        step: wizardStep,
      });

      return {
        step: wizardStep,
        userType: user.userType,
      };
    }

    // Otherwise, start at user type selection
    return {
      step: 'user-type',
      userType: null,
    };
  });

  // Update state if user data changes (e.g., after selecting user type)
  useEffect(() => {
    // Skip on initial mount to avoid double setState
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    if (user?.userType && state.userType !== user.userType) {
      const wizardStep: OnboardingStep =
        user.userType === 'grower' ? 'grower-wizard' : 'gatherer-wizard';

      logger.info('User type updated, advancing to wizard', {
        userType: user.userType,
        step: wizardStep,
      });

      // Use a microtask to avoid setState during render
      Promise.resolve().then(() => {
        setState({
          step: wizardStep,
          userType: user.userType,
        });
      });
    }
  }, [user?.userType, state.userType]);

  /**
   * Handle user type selection
   */
  const handleUserTypeSelect = async (userType: UserType) => {
    logger.info('User type selected', { userType });

    // Submit user type to backend
    await submitUserType(userType);

    const wizardStep: OnboardingStep =
      userType === 'grower' ? 'grower-wizard' : 'gatherer-wizard';

    setState({
      step: wizardStep,
      userType,
    });
  };

  /**
   * Handle navigation back to user type selection
   */
  const handleBack = () => {
    logger.info('Navigating back to user type selection');

    setState({
      step: 'user-type',
      userType: null,
    });
  };

  // Render appropriate step component based on current state
  if (state.step === 'user-type') {
    return <UserTypeSelection onSelect={handleUserTypeSelect} />;
  }

  if (state.step === 'grower-wizard') {
    return (
      <GrowerWizard
        onComplete={async (data) => {
          await submitGrowerProfile(data);
          // Drop the new grower straight onto Listings — their primary first action.
          navigate('/listings');
        }}
        onBack={handleBack}
      />
    );
  }

  if (state.step === 'gatherer-wizard') {
    return (
      <GathererWizard
        onComplete={async (data) => {
          await submitGathererProfile(data);
          // Drop the new gatherer straight onto Requests — their primary first action.
          navigate('/requests');
        }}
        onBack={handleBack}
      />
    );
  }

  return null;
}
