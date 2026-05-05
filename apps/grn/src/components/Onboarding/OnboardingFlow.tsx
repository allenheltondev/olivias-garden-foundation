import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOnboarding } from '../../hooks/useOnboarding';
import type { UserProfile, UserType } from '../../types/user';
import { logger } from '../../utils/logging';
import { GrowerWizard } from './GrowerWizard';
import { GathererWizard } from './GathererWizard';
import { UserTypeSelection } from './UserTypeSelection';

export type OnboardingStep = 'user-type' | 'grower-wizard' | 'gatherer-wizard';

export interface OnboardingFlowProps {
  user: UserProfile | null;
  refreshUser: () => Promise<void> | void;
}

function initialStepFor(user: UserProfile | null): OnboardingStep {
  if (user?.userType === 'grower') return 'grower-wizard';
  if (user?.userType === 'gatherer') return 'gatherer-wizard';
  return 'user-type';
}

/**
 * OnboardingFlow Component
 *
 * Orchestrates the onboarding wizard experience. Receives the user from
 * OnboardingGuard so there's a single source of truth — without that, the
 * guard's user stayed stale after wizard submission and the user got stuck
 * on an empty wizard re-render even after navigating away.
 */
export function OnboardingFlow({ user, refreshUser }: OnboardingFlowProps) {
  const navigate = useNavigate();
  const { submitUserType, submitGrowerProfile, submitGathererProfile } = useOnboarding();
  const [step, setStep] = useState<OnboardingStep>(() => initialStepFor(user));

  const handleUserTypeSelect = async (userType: UserType) => {
    logger.info('User type selected', { userType });
    await submitUserType(userType);
    setStep(userType === 'grower' ? 'grower-wizard' : 'gatherer-wizard');
  };

  const handleBack = () => {
    logger.info('Navigating back to user type selection');
    setStep('user-type');
  };

  if (step === 'grower-wizard') {
    return (
      <GrowerWizard
        onComplete={async (data) => {
          await submitGrowerProfile(data);
          await refreshUser();
          navigate('/listings');
        }}
        onBack={handleBack}
      />
    );
  }

  if (step === 'gatherer-wizard') {
    return (
      <GathererWizard
        onComplete={async (data) => {
          await submitGathererProfile(data);
          await refreshUser();
          navigate('/requests');
        }}
        onBack={handleBack}
      />
    );
  }

  return <UserTypeSelection onSelect={handleUserTypeSelect} />;
}
