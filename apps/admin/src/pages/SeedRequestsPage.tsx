import { useEffect, useState } from 'react';
import { Button, Card, FormFeedback, SectionHeading } from '@olivias/ui';
import {
  listSeedRequestQueue,
  markSeedRequestHandled,
  type SeedRequestQueueItem,
} from '../api';
import type { AdminSession } from '../auth/session';

export interface SeedRequestsPageProps {
  session: AdminSession;
}

const PAGE_SIZE = 10;

function formatAddress(request: SeedRequestQueueItem): string {
  if (request.fulfillmentMethod !== 'mail' || !request.shippingAddress) {
    return 'In-person exchange';
  }
  const a = request.shippingAddress;
  const street = [a.line1, a.line2].filter(Boolean).join(', ');
  const locality = [a.city, a.region, a.postalCode].filter(Boolean).join(' ');
  return [street, locality, a.country].filter(Boolean).join(' · ') || 'Mail — address incomplete';
}

export function SeedRequestsPage({ session }: SeedRequestsPageProps) {
  const [requests, setRequests] = useState<SeedRequestQueueItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useEffect(() => {
    let active = true;
    setLoading(true);
    listSeedRequestQueue(session.accessToken, { page, limit: PAGE_SIZE })
      .then((next) => {
        if (!active) return;
        setRequests(next.data);
        setTotal(next.total);
        setError(null);
      })
      .catch((err: Error) => {
        if (!active) return;
        setError(err.message || 'Unable to load seed requests.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session.accessToken, page]);

  const load = async (targetPage = page) => {
    setLoading(true);
    try {
      const next = await listSeedRequestQueue(session.accessToken, {
        page: targetPage,
        limit: PAGE_SIZE,
      });
      setRequests(next.data);
      setTotal(next.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load seed requests.');
    } finally {
      setLoading(false);
    }
  };

  const handleMarkDone = async (request: SeedRequestQueueItem) => {
    setBusyId(request.id);
    setError(null);
    try {
      await markSeedRequestHandled(session.accessToken, request.id, {
        status: 'handled',
      });
      // Refetch the current page so the list stays correctly paginated
      // and total reflects the server's post-update view.
      const newTotal = Math.max(0, total - 1);
      const newPageCount = Math.max(1, Math.ceil(newTotal / PAGE_SIZE));
      const nextPage = Math.min(page, newPageCount);
      if (nextPage !== page) {
        setPage(nextPage);
      } else {
        await load(nextPage);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to mark request as done.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="admin-section">
      <div className="admin-section__header">
        <SectionHeading
          eyebrow="Seed requests"
          title={`Open requests (${total})`}
          body="Mark a request as done once the seeds are on their way or picked up."
        />
        <Button
          className="admin-refresh-action"
          variant="outline"
          size="sm"
          onClick={() => void load(page)}
          disabled={loading}
        >
          Refresh
        </Button>
      </div>

      {error ? (
        <FormFeedback tone="error" className="admin-load-error">{error}</FormFeedback>
      ) : null}

      {loading && requests.length === 0 ? (
        <Card><p>Loading seed requests…</p></Card>
      ) : requests.length === 0 ? (
        <Card><p>No open seed requests right now.</p></Card>
      ) : (
        <>
          <div className="admin-stack">
            {requests.map((request) => (
              <Card key={request.id} className="admin-request-card">
                <div className="admin-request-card__meta">
                  <div>
                    <h3>{request.name || 'Unknown contributor'}</h3>
                    <p>{request.email || 'No email provided'}</p>
                  </div>
                  <span>{request.createdAt ? new Date(request.createdAt).toLocaleString() : '—'}</span>
                </div>
                <dl className="admin-request-card__details">
                  <div>
                    <dt>Fulfillment</dt>
                    <dd>{request.fulfillmentMethod === 'mail' ? 'Mail' : 'In-person exchange'}</dd>
                  </div>
                  <div>
                    <dt>Address / visit</dt>
                    <dd>
                      {request.fulfillmentMethod === 'mail'
                        ? formatAddress(request)
                        : request.visitDetails?.approximateDate || 'No date provided'}
                    </dd>
                  </div>
                  {request.visitDetails?.notes ? (
                    <div>
                      <dt>Visit notes</dt>
                      <dd>{request.visitDetails.notes}</dd>
                    </div>
                  ) : null}
                  {request.message ? (
                    <div>
                      <dt>Message</dt>
                      <dd>{request.message}</dd>
                    </div>
                  ) : null}
                </dl>
                <div className="admin-request-card__actions">
                  <Button
                    onClick={() => void handleMarkDone(request)}
                    loading={busyId === request.id}
                    disabled={busyId !== null}
                  >
                    Mark as done
                  </Button>
                </div>
              </Card>
            ))}
          </div>

          {pageCount > 1 ? (
            <nav className="admin-pagination" aria-label="Seed request pages">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <span className="admin-pagination__status" aria-live="polite">
                Page {page} of {pageCount}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pageCount || loading}
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              >
                Next
              </Button>
            </nav>
          ) : null}
        </>
      )}
    </section>
  );
}
