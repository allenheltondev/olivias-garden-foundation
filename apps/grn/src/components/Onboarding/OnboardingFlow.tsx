import { useLocation, useNavigate } from 'react-router-dom';
import { useOnboarding } from '../../hooks/useOnboarding';
import type { UserProfile } from '../../types/user';
import { GrowerWizard } from './GrowerWizard';

export interface OnboardingFlowProps {
  user: UserProfile | null;
  refreshUser: () => Promise<void> | void;
}

/**
 * OnboardingFlow Component
 *
 * GRN is individual-growing-first: everyone is a grower, so onboarding is a
 * single grower setup wizard with no participation-mode choice. Connecting
 * with others (sharing surplus, finding food) is opt-in from the Connect hub
 * after setup, not a mode picked up front.
 *
 * Receives the user from OnboardingGuard so there's a single source of truth;
 * on completion we refresh and continue the intended journey or help a new grower add a first plant.
 */
export function OnboardingFlow({ user, refreshUser }: OnboardingFlowProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { submitGrowerProfile } = useOnboarding();

  return (
    <GrowerWizard
      onComplete={async (data) => {
        await submitGrowerProfile(data);
        await refreshUser();
        if (location.pathname === '/' && !user?.growerProfile) {
          navigate('/garden/plants/new', { replace: true });
        }
      }}
    />
  );
}
