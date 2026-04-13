import type { ReactNode } from 'react';
import { useUser } from '../../hooks/useUser';
import { PlantLoader } from '../branding/PlantLoader';
import { OnboardingFlow } from './OnboardingFlow';

export interface OnboardingGuardProps {
  children: ReactNode;
}

/**
 * OnboardingGuard Component
 *
 * Wraps the main application and enforces onboarding completion.
 * - Shows loading screen while fetching user data
 * - Redirects to OnboardingFlow if onboarding is incomplete
 * - Renders children (main app) if onboarding is complete
 *
 * Validates Requirements 1.1, 1.2, 7.1, 7.2
 */
export function OnboardingGuard({ children }: OnboardingGuardProps) {
  const { user, isLoading } = useUser();

  // Show loading screen while fetching user data
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <PlantLoader size="md" />
          <p className="text-gray-600 mt-4">Loading...</p>
        </div>
      </div>
    );
  }

  // Redirect to OnboardingFlow if onboarding is incomplete
  if (!user?.onboardingCompleted) {
    return <OnboardingFlow />;
  }

  // Render children if onboarding is complete
  return <>{children}</>;
}
