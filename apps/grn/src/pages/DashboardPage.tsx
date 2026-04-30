import { useQuery } from '@tanstack/react-query';
import {
  AvatarBadge,
  Button,
  KeyValueList,
  Panel,
  SectionHeading,
  SummaryChip,
} from '@olivias/ui';
import { getMe } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { PlantLoader } from '../components/branding/PlantLoader';

const tierLabels: Record<string, string> = {
  free: 'Free',
  supporter: 'Supporter',
  pro: 'Pro',
};

const tierClassNames: Record<string, string> = {
  free: 'grn-tier-chip--free',
  supporter: 'grn-tier-chip--supporter',
  pro: 'grn-tier-chip--pro',
};

export function DashboardPage() {
  const { signOut } = useAuth();

  const { data: profile, isLoading, isError, error, refetch } = useQuery({
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
      <section className="grn-section">
        <SectionHeading
          eyebrow="Overview"
          title="Your dashboard"
          body="A quick look at your Good Roots Network profile."
        />
        <Panel className="grn-page-status">
          <PlantLoader size="md" />
          <p>Loading your profile…</p>
        </Panel>
      </section>
    );
  }

  if (isError || !profile) {
    return (
      <section className="grn-section">
        <SectionHeading
          eyebrow="Overview"
          title="Your dashboard"
          body="A quick look at your Good Roots Network profile."
        />
        <Panel className="grn-page-error">
          <span className="grn-page-error__icon" aria-hidden="true">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </span>
          <h2>Failed to load profile</h2>
          <p>{error instanceof Error ? error.message : 'An unexpected error occurred.'}</p>
          <div className="grn-page-error__actions">
            <Button onClick={() => void refetch()} variant="primary">Try again</Button>
            <Button onClick={() => void handleSignOut()} variant="secondary">Sign out</Button>
          </div>
        </Panel>
      </section>
    );
  }

  const isOrganizationGrower = profile.userType === 'grower' && profile.growerProfile?.isOrganization;
  const roleLabel = profile.userType === 'gatherer'
    ? 'Gatherer'
    : isOrganizationGrower
      ? 'Organization grower'
      : profile.userType === 'grower'
        ? 'Individual grower'
        : 'Member';

  const phaseLabel = profile.userType === 'gatherer'
    ? 'Phase 2: Search and Request Flow'
    : profile.userType === 'grower'
      ? 'Phase 1: Grower Listing Flow'
      : 'Pick a participation mode to get started.';

  const initials = `${profile.firstName.charAt(0)}${profile.lastName.charAt(0)}`.toUpperCase() || 'G';
  const tierLabel = tierLabels[profile.tier] || profile.tier;
  const tierClass = tierClassNames[profile.tier] ?? '';

  const overviewItems = [
    {
      key: 'name',
      label: 'Name',
      value: `${profile.firstName} ${profile.lastName}`,
    },
    {
      key: 'email',
      label: 'Email',
      value: profile.email,
    },
    {
      key: 'tier',
      label: 'Membership tier',
      value: <SummaryChip className={tierClass}>{tierLabel}</SummaryChip>,
    },
  ];

  if (profile.userType === 'grower') {
    overviewItems.push({
      key: 'grower-type',
      label: 'Grower setup',
      value: isOrganizationGrower
        ? profile.growerProfile?.organizationName ?? 'Organization grower'
        : 'Individual grower',
    });
  }

  return (
    <section className="grn-section">
      <SectionHeading
        eyebrow="Overview"
        title="Your dashboard"
        body="A quick look at your Good Roots Network profile."
      />

      <Panel className="grn-profile-card" padding="none">
        <div className="grn-profile-card__banner">
          <span className="grn-profile-card__avatar-ring">
            <AvatarBadge initials={initials} />
          </span>
        </div>
        <div className="grn-profile-card__body">
          <div className="grn-summary-row">
            <SummaryChip>{roleLabel}</SummaryChip>
            <SummaryChip className={tierClass}>{tierLabel}</SummaryChip>
          </div>
          <KeyValueList items={overviewItems} />
          <p className="grn-profile-card__phase">{phaseLabel}</p>
        </div>
      </Panel>
    </section>
  );
}

export default DashboardPage;
