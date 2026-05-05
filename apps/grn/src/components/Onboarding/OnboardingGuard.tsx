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
 * Owns the single useUser instance for the onboarding flow and passes
 * `user`/`refreshUser` down so OnboardingFlow doesn't keep its own copy.
 * Without this, refreshUser() inside the flow only updates the flow's
 * own state — the guard's user stays stale and never advances past
 * onboarding even after the wizard completes successfully.
 */
export function OnboardingGuard({ children }: OnboardingGuardProps) {
  const { user, isLoading, refreshUser } = useUser();

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

  if (!user?.onboardingCompleted) {
    return <OnboardingFlow user={user} refreshUser={refreshUser} />;
  }

  return <>{children}</>;
}
