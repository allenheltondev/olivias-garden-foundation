import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, FormFeedback, SectionHeading } from '@olivias/ui';
import { listActivity, type ActivityEvent } from '../api';
import type { AdminSession } from '../auth/session';

export interface ActivityPageProps {
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

export function ActivityPage({ session }: ActivityPageProps) {
  const [activeFilterId, setActiveFilterId] = useState<string>('all');
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);

  const activeFilter = useMemo(
    () => TYPE_FILTERS.find((f) => f.id === activeFilterId) ?? TYPE_FILTERS[0],
    [activeFilterId]
  );

  const loadInitial = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await listActivity(session.accessToken, {
        detailType: activeFilter.detailType ?? undefined,
        limit: 25,
      });
      setEvents(response.items);
      setCursor(response.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load activity.');
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
      setError(err instanceof Error ? err.message : 'Unable to load more activity.');
    } finally {
      setIsLoadingMore(false);
    }
  };

  return (
    <section className="admin-section admin-activity">
      <SectionHeading
        eyebrow="Activity"
        title="Foundation activity feed"
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

      {error ? <FormFeedback tone="error">{error}</FormFeedback> : null}

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
