import { useQuery } from '@tanstack/react-query';
import { getMe } from '../../services/api';
import { useAuth } from '../../hooks/useAuth';
import { AppShell } from '../layout/AppShell';
import { PlantLoader } from '../branding/PlantLoader';
import { Button } from '../ui/Button';
import { GrowerListingPanel } from '../Listings/GrowerListingPanel';
import { SearcherRequestPanel } from '../Listings/SearcherRequestPanel';
import { ReminderPanel } from '../Reminders/ReminderPanel';
import { TipsModule } from '../Tips/TipsModule';

/**
 * ProfileView Component
 *
 * Displays the authenticated user's profile information.
 * Uses TanStack Query to fetch and cache user data from GET /me endpoint.
 */
export function ProfileView() {
  const { signOut } = useAuth();

  const {
    data: profile,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['userProfile'],
    queryFn: getMe,
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (signOutError) {
      console.error('Sign-out failed:', signOutError);
    }
  };

  if (isLoading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center min-h-[calc(100vh-4rem)] p-4">
          <div className="text-center">
            <PlantLoader size="md" />
            <p className="text-gray-600 mt-4">Loading your profile...</p>
          </div>
        </div>
      </AppShell>
    );
  }

  if (isError) {
    return (
      <AppShell>
        <div className="flex items-center justify-center min-h-[calc(100vh-4rem)] p-4">
          <div className="max-w-md w-full bg-white rounded-lg shadow-md p-6">
            <div className="text-center">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-8 h-8 text-red-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                Failed to load profile
              </h2>
              <p className="text-gray-600 mb-6">
                {error instanceof Error ? error.message : 'An unexpected error occurred'}
              </p>
              <div className="space-y-3">
                <Button
                  onClick={() => refetch()}
                  variant="primary"
                  fullWidth
                >
                  Try Again
                </Button>
                <Button
                  onClick={handleSignOut}
                  variant="secondary"
                  fullWidth
                >
                  Sign Out
                </Button>
              </div>
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  if (!profile) {
    return null;
  }

  const tierLabels: Record<string, string> = {
    neighbor: 'Neighbor',
    supporter: 'Supporter',
    caretaker: 'Caretaker',
  };

  const tierColors: Record<string, string> = {
    neighbor: 'bg-blue-100 text-blue-800',
    supporter: 'bg-purple-100 text-purple-800',
    caretaker: 'bg-green-100 text-green-800',
  };

  const phaseLabel = profile.userType === 'gatherer'
    ? 'Phase 2: Search and Request Flow'
    : 'Phase 1: Grower Listing Flow';

  return (
    <AppShell>
      <div className="bg-gray-50 p-4">
        <div className="max-w-md mx-auto pt-8 space-y-4">
          <div className="bg-white rounded-lg shadow-md overflow-hidden">
            <div className="bg-primary-600 h-24 flex items-center justify-center">
              <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center">
                <span className="text-3xl font-bold text-primary-600">
                  {profile.firstName.charAt(0)}{profile.lastName.charAt(0)}
                </span>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">
                  Name
                </label>
                <p className="text-lg font-semibold text-gray-900">
                  {profile.firstName} {profile.lastName}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">
                  Email
                </label>
                <p className="text-gray-900">{profile.email}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">
                  Membership Tier
                </label>
                <span
                  className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${
                    tierColors[profile.tier] || 'bg-gray-100 text-gray-800'
                  }`}
                >
                  {tierLabels[profile.tier] || profile.tier}
                </span>
              </div>
            </div>
          </div>

          {profile.userType === 'grower' && (
            <GrowerListingPanel
              viewerUserId={profile.userId}
              defaultLat={profile.growerProfile?.lat}
              defaultLng={profile.growerProfile?.lng}
            />
          )}

          {profile.userType === 'gatherer' && (
            <SearcherRequestPanel
              viewerUserId={profile.userId}
              gathererGeoKey={profile.gathererProfile?.geoKey}
              defaultLat={profile.gathererProfile?.lat}
              defaultLng={profile.gathererProfile?.lng}
              defaultRadiusMiles={profile.gathererProfile?.searchRadiusMiles}
            />
          )}

          <TipsModule
            tips={profile.curatedTips}
            experienceLevel={profile.experienceLevel}
          />

          <ReminderPanel />

          <Button
            onClick={handleSignOut}
            variant="outline"
            fullWidth
            className="!border-error !text-error hover:!bg-red-50"
          >
            Sign Out
          </Button>

          <p className="text-center text-sm text-gray-500 mt-6">
            {phaseLabel}
          </p>
        </div>
      </div>
    </AppShell>
  );
}

export default ProfileView;
