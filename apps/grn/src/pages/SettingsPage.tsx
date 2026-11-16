import { Link } from 'react-router-dom';
import { Card, Panel, SectionHeading } from '@olivias/ui';
import { ProfileForm } from '../components/Settings/ProfileForm';
import type { UserProfile } from '../types/user';

const membershipLabels = {
  free: 'Free',
  supporter: 'Supporter',
  pro: 'Pro',
} as const;

export interface SettingsPageProps {
  user: UserProfile | null;
  /** Reloads the signed-in user after a profile edit. */
  refreshUser?: () => Promise<void> | void;
}

export function SettingsPage({ user, refreshUser }: SettingsPageProps) {
  return (
    <section className="grn-section">
      <SectionHeading
        title="Settings"
        body="Manage your profile, membership, and programmatic access to Good Roots."
      />

      {user ? (
        <div className="grn-settings-grid">
          <Card id="profile" padding="6" className="grn-settings-card">
            <h2>Profile</h2>
            {/* Email comes from the foundation account and stays read-only;
                the display name and grower profile are editable here. */}
            <dl className="grn-settings-details">
              <dt>Email</dt>
              <dd>{user.email || 'Not provided'}</dd>
            </dl>

            {user.growerProfile ? (
              <ProfileForm
                profile={user.growerProfile}
                displayName={user.displayName}
                refreshUser={refreshUser ?? (() => undefined)}
              />
            ) : (
              <p className="grn-settings-empty">
                Your growing location has not been set up yet. Finish setup to add it.
              </p>
            )}
          </Card>

          <Card id="membership" padding="6" className="grn-settings-card">
            <h2>Membership</h2>
            <dl className="grn-settings-details">
              <dt>Plan</dt>
              <dd>{membershipLabels[user.subscription.tier]}</dd>
              <dt>Status</dt>
              <dd>{user.subscription.subscriptionStatus || 'Active'}</dd>
            </dl>
          </Card>
        </div>
      ) : (
        <Panel className="grn-page-error">
          <h2>Profile unavailable</h2>
          <p>Refresh the page to load your profile and membership details.</p>
        </Panel>
      )}

      <Card id="api-keys" padding="6" className="grn-settings-card">
        <h2>API keys</h2>
        <p className="grn-settings-empty">
          Build your own tools on top of your garden. Keys are issued by request, and the
          reference lists every endpoint you can call with one.
        </p>
        <div className="grn-settings-actions">
          <Link className="grn-settings-link" to="/settings/api-keys">
            Manage API keys
          </Link>
          <Link className="grn-settings-link" to="/settings/api-keys/reference">
            API reference
          </Link>
        </div>
      </Card>
    </section>
  );
}

export default SettingsPage;
