import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, FormFeedback, SectionHeading } from '@olivias/ui';
import {
  getAdminStats,
  listActivity,
  type ActivityEvent,
  type AdminStats,
} from '../api';
import type { AdminSession } from '../auth/session';

export interface DashboardPageProps {
  session: AdminSession;
}

const TYPE_FILTERS: Array<{ id: string; label: string; detailType: string | null }> = [
  { id: 'all', label: 'All activity', detailType: null },
  { id: 'donations', label: 'Donations', detailType: 'donation.completed' },
  { id: 'signups', label: 'Signups', detailType: 'user.signed-up' },
  { id: 'okra', label: 'Okra submissions', detailType: 'submission.created' },
  { id: 'seed-requests', label: 'Seed requests', detailType: 'seed-request.created' },
  { id: 'inquiries', label: 'Good Roots inquiries', detailType: 'org-inquiry.received' },
];

const TYPE_TONE: Record<string, string> = {
  'donation.completed': 'admin-activity__chip--donation',
  'user.signed-up': 'admin-activity__chip--signup',
  'submission.created': 'admin-activity__chip--okra',
  'seed-request.created': 'admin-activity__chip--seed',
  'org-inquiry.received': 'admin-activity__chip--inquiry',
};

function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value.toLocaleString();
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return iso;
  return date.toLocaleString();
}

function formatTypeLabel(detailType: string): string {
  const filter = TYPE_FILTERS.find((f) => f.detailType === detailType);
  if (filter) return filter.label.replace(/s$/, '');
  return detailType;
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
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);

  const [activeFilterId, setActiveFilterId] = useState<string>('all');
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);

  const activeFilter = useMemo(
    () => TYPE_FILTERS.find((f) => f.id === activeFilterId) ?? TYPE_FILTERS[0],
    [activeFilterId]
  );

  useEffect(() => {
    let active = true;
    setStatsLoading(true);
    getAdminStats(session.accessToken)
      .then((next) => {
        if (!active) return;
        setStats(next);
        setStatsError(null);
      })
      .catch((err: Error) => {
        if (!active) return;
        setStatsError(err.message || 'Unable to load admin stats.');
      })
      .finally(() => {
        if (active) setStatsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session.accessToken]);

  const loadInitial = useCallback(async () => {
    setIsLoading(true);
    setActivityError(null);
    try {
      const response = await listActivity(session.accessToken, {
        detailType: activeFilter.detailType ?? undefined,
        limit: 25,
      });
      setEvents(response.items);
      setCursor(response.nextCursor);
    } catch (err) {
      setActivityError(err instanceof Error ? err.message : 'Unable to load activity.');
    } finally {
      setIsLoading(false);
    }
  }, [session.accessToken, activeFilter.detailType]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  const loadMore = async () => {
    if (!cursor) return;
    setIsLoadingMore(true);
    try {
      const response = await listActivity(session.accessToken, {
        cursor,
        detailType: activeFilter.detailType ?? undefined,
        limit: 25,
      });
      setEvents((current) => [...current, ...response.items]);
      setCursor(response.nextCursor);
    } catch (err) {
      setActivityError(err instanceof Error ? err.message : 'Unable to load more activity.');
    } finally {
      setIsLoadingMore(false);
    }
  };

  return (
    <section className="admin-section admin-activity">
      <SectionHeading
        eyebrow="Overview"
        title="Admin dashboard"
        body="A quick look at the foundation's active work across users, seeds, and okra submissions."
      />

      {statsError ? (
        <FormFeedback tone="error" className="admin-load-error">{statsError}</FormFeedback>
      ) : null}

      <div className="admin-stat-grid">
        <StatTile
          label="Registered users"
          value={statsLoading ? '…' : formatCount(stats?.userCount)}
          helper="Estimated from the shared Cognito user pool."
        />
        <StatTile
          label="Open seed requests"
          value={statsLoading ? '…' : formatCount(stats?.openSeedRequestCount)}
          helper="Waiting for fulfillment."
        />
        <StatTile
          label="Pending okra submissions"
          value={statsLoading ? '…' : formatCount(stats?.pendingOkraCount)}
          helper="Awaiting review in the public map."
        />
      </div>

      <SectionHeading
        eyebrow="Activity"
        title="Recent activity"
        body="Donations, signups, seed requests, okra submissions, and Good Roots inquiries — newest first. Events are kept for 30 days."
      />

      <div className="admin-activity__filters" role="tablist">
        {TYPE_FILTERS.map((filter) => (
          <button
            key={filter.id}
            type="button"
            role="tab"
            aria-selected={filter.id === activeFilterId}
            className={`admin-activity__filter${filter.id === activeFilterId ? ' is-active' : ''}`}
            onClick={() => setActiveFilterId(filter.id)}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {activityError ? <FormFeedback tone="error">{activityError}</FormFeedback> : null}

      {isLoading ? (
        <Card className="admin-activity__loading">
          <p>Loading activity…</p>
        </Card>
      ) : events.length === 0 ? (
        <Card className="admin-activity__empty">
          <p>No activity yet for this filter.</p>
        </Card>
      ) : (
        <ul className="admin-activity__list" role="list">
          {events.map((event) => {
            const isExpanded = expandedEventId === event.eventId;
            return (
              <li key={event.eventId} className="admin-activity__item">
                <Card className="admin-activity__card">
                  <div className="admin-activity__row">
                    <span className={`admin-activity__chip ${TYPE_TONE[event.detailType] ?? ''}`.trim()}>
                      {formatTypeLabel(event.detailType)}
                    </span>
                    <time className="admin-activity__time" dateTime={event.occurredAt}>
                      {formatTimestamp(event.occurredAt)}
                    </time>
                  </div>
                  <p className="admin-activity__summary">{event.summary ?? '(no summary)'}</p>
                  <button
                    type="button"
                    className="admin-activity__details-toggle"
                    onClick={() => setExpandedEventId(isExpanded ? null : event.eventId)}
                    aria-expanded={isExpanded}
                  >
                    {isExpanded ? 'Hide details' : 'Show details'}
                  </button>
                  {isExpanded ? (
                    <pre className="admin-activity__details">{JSON.stringify(event.data, null, 2)}</pre>
                  ) : null}
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {cursor ? (
        <div className="admin-activity__pagination">
          <Button onClick={loadMore} disabled={isLoadingMore}>
            {isLoadingMore ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
