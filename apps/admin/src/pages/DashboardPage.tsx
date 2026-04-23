import { useEffect, useState } from 'react';
import { Card, FormFeedback, SectionHeading } from '@olivias/ui';
import { getAdminStats, type AdminStats } from '../api';
import type { AdminSession } from '../auth/session';

export interface DashboardPageProps {
  session: AdminSession;
}

function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value.toLocaleString();
}

function StatTile({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper?: string;
}) {
  return (
    <Card className="admin-stat">
      <p className="admin-stat__label">{label}</p>
      <p className="admin-stat__value">{value}</p>
      {helper ? <p className="admin-stat__helper">{helper}</p> : null}
    </Card>
  );
}

export function DashboardPage({ session }: DashboardPageProps) {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getAdminStats(session.accessToken)
      .then((next) => {
        if (!active) return;
        setStats(next);
        setError(null);
      })
      .catch((err: Error) => {
        if (!active) return;
        setError(err.message || 'Unable to load admin stats.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session.accessToken]);

  return (
    <section className="admin-section">
      <SectionHeading
        eyebrow="Overview"
        title="Admin dashboard"
        body="A quick look at the foundation's active work across users, seeds, and okra submissions."
      />

      {error ? (
        <FormFeedback tone="error" className="admin-load-error">{error}</FormFeedback>
      ) : null}

      <div className="admin-stat-grid">
        <StatTile
          label="Registered users"
          value={loading ? '…' : formatCount(stats?.userCount)}
          helper="Estimated from the shared Cognito user pool."
        />
        <StatTile
          label="Open seed requests"
          value={loading ? '…' : formatCount(stats?.openSeedRequestCount)}
          helper="Waiting for fulfillment."
        />
        <StatTile
          label="Pending okra submissions"
          value={loading ? '…' : formatCount(stats?.pendingOkraCount)}
          helper="Awaiting review in the public map."
        />
      </div>
    </section>
  );
}
