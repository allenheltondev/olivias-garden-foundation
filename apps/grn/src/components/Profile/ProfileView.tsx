import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AvatarBadge, Button, KeyValueList, Panel, SectionHeading, SummaryChip } from '@olivias/ui';
import { getMe } from '../../services/api';
import { useAuth } from '../../hooks/useAuth';
import { AppShell } from '../layout/AppShell';
import { PlantLoader } from '../branding/PlantLoader';
import { GrowerListingPanel } from '../Listings/GrowerListingPanel';
import { SearcherRequestPanel } from '../Listings/SearcherRequestPanel';
import { ReminderPanel } from '../Reminders/ReminderPanel';
import { CropLibraryPanel } from './CropLibraryPanel';

/**
 * ProfileView Component
 *
 * Displays the authenticated user's profile information.
 * Uses TanStack Query to fetch and cache user data from GET /me endpoint.
 */
export function ProfileView() {
  const { signOut } = useAuth();
  const [activeSection, setActiveSection] = useState('profile-overview');

  useEffect(() => {
    const updateActiveSection = () => {
      const hash = window.location.hash.replace('#', '');
      setActiveSection(hash || 'profile-overview');
    };

    updateActiveSection();
    window.addEventListener('hashchange', updateActiveSection);

    return () => {
      window.removeEventListener('hashchange', updateActiveSection);
    };
  }, []);

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
    free: 'Free',
    supporter: 'Supporter',
    pro: 'Pro',
  };

  const tierColors: Record<string, string> = {
    free: 'bg-blue-100 text-blue-800',
    supporter: 'bg-purple-100 text-purple-800',
    pro: 'bg-green-100 text-green-800',
  };

  const phaseLabel = profile.userType === 'gatherer'
    ? 'Phase 2: Search and Request Flow'
    : 'Phase 1: Grower Listing Flow';
  const roleLabel = profile.userType === 'gatherer' ? 'Gatherer' : 'Grower';
  const sectionItems = profile.userType === 'grower'
    ? [
        { id: 'profile-overview', label: 'Overview' },
        { id: 'profile-crops', label: 'Crop Library' },
        { id: 'profile-listings', label: 'Listings' },
        { id: 'profile-reminders', label: 'Reminders' },
      ]
    : [
        { id: 'profile-overview', label: 'Overview' },
        { id: 'profile-requests', label: 'Requests' },
        { id: 'profile-reminders', label: 'Reminders' },
      ];
  const initials = `${profile.firstName.charAt(0)}${profile.lastName.charAt(0)}`;
  const overviewItems = [
    {
      key: 'name',
      label: 'Name',
      value: <p className="text-lg font-semibold text-gray-900">{profile.firstName} {profile.lastName}</p>,
    },
    {
      key: 'email',
      label: 'Email',
      value: <p className="text-gray-900">{profile.email}</p>,
    },
    {
      key: 'tier',
      label: 'Membership Tier',
      value: (
        <span
          className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${
            tierColors[profile.tier] || 'bg-gray-100 text-gray-800'
          }`}
        >
          {tierLabels[profile.tier] || profile.tier}
        </span>
      ),
    },
  ];

  return (
    <AppShell>
      <div className="og-side-layout">
        <div className="og-side-layout__inner">
          <aside className="og-side-layout__sidebar">
            <Panel className="og-side-nav">
              <SectionHeading
                eyebrow="Good Roots Network"
                title="Your dashboard"
                body="Move between your main tools without losing the shared Olivia&apos;s Garden shell."
              />

              <div className="mt-4 flex flex-wrap gap-2">
                <SummaryChip>{roleLabel}</SummaryChip>
                <SummaryChip>{tierLabels[profile.tier] || profile.tier}</SummaryChip>
              </div>

              <nav className="og-side-nav__list" aria-label="Dashboard sections">
                {sectionItems.map((item) => (
                  <a
                    key={item.id}
                    href={`#${item.id}`}
                    className={`og-side-nav__link ${activeSection === item.id ? 'is-active' : ''}`.trim()}
                  >
                    {item.label}
                  </a>
                ))}
              </nav>

              <button
                type="button"
                className="og-side-nav__action og-side-nav__action--danger"
                onClick={() => void handleSignOut()}
              >
                Sign Out
              </button>
            </Panel>
          </aside>

          <div className="og-side-layout__content">
            <section id="profile-overview" className="og-content-section">
              <SectionHeading eyebrow="Profile" title="Overview" body="Your account details and current access." />
              <Panel className="overflow-hidden" tone="paper" padding="none">
                <div className="bg-primary-600 h-24 flex items-center justify-center">
                  <div className="bg-white rounded-full p-2">
                    <AvatarBadge initials={initials} className="w-20 h-20 text-3xl shadow-none" />
                  </div>
                </div>

                <div className="p-6 space-y-5">
                  <KeyValueList items={overviewItems} />
                  <p className="text-sm text-gray-500">{phaseLabel}</p>
                </div>
              </Panel>
            </section>

            {profile.userType === 'grower' && (
              <>
                <section id="profile-crops" className="og-content-section">
                  <SectionHeading eyebrow="Grower tools" title="Crop library" />
                  <CropLibraryPanel viewerUserId={profile.userId} />
                </section>

                <section id="profile-listings" className="og-content-section">
                  <SectionHeading eyebrow="Market activity" title="Listings" />
                  <GrowerListingPanel
                    viewerUserId={profile.userId}
                    defaultLat={profile.growerProfile?.lat}
                    defaultLng={profile.growerProfile?.lng}
                  />
                </section>
              </>
            )}

            {profile.userType === 'gatherer' && (
              <section id="profile-requests" className="og-content-section">
                <SectionHeading eyebrow="Request flow" title="Requests" />
                <SearcherRequestPanel
                  viewerUserId={profile.userId}
                  gathererGeoKey={profile.gathererProfile?.geoKey}
                  defaultLat={profile.gathererProfile?.lat}
                  defaultLng={profile.gathererProfile?.lng}
                  defaultRadiusMiles={profile.gathererProfile?.searchRadiusMiles}
                />
              </section>
            )}

            <section id="profile-reminders" className="og-content-section">
              <SectionHeading eyebrow="Planning" title="Reminders" />
              <ReminderPanel />
            </section>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

export default ProfileView;
