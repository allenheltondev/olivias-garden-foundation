import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Card, FormFeedback, PageHeading, Textarea, EmptyState } from '@olivias/ui';
import {
  decideApiAccessRequest,
  listApiAccessRequests,
  type ApiAccessRequestQueueItem,
} from '../api';
import type { AdminSession } from '../auth/session';

export interface ApiAccessPageProps {
  session: AdminSession;
}

type QueueStatus = 'pending' | 'approved' | 'denied';

const STATUS_TABS: Array<{ id: QueueStatus; label: string }> = [
  { id: 'pending', label: 'Awaiting review' },
  { id: 'approved', label: 'Approved' },
  { id: 'denied', label: 'Denied' },
];

function requesterLabel(request: ApiAccessRequestQueueItem): string {
  const name = request.userDisplayName?.trim();
  const email = request.userEmail?.trim();
  if (name && email) return `${name} · ${email}`;
  return name || email || request.userId;
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export function ApiAccessPage({ session }: ApiAccessPageProps) {
  const [status, setStatus] = useState<QueueStatus>('pending');
  const [requests, setRequests] = useState<ApiAccessRequestQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  // Switching tabs starts a new load without cancelling the old one, and the
  // slower of the two can land last. Only the most recent load may write to
  // state, or the queue shows one status under another status's tab.
  const loadId = useRef(0);

  const load = useCallback(() => {
    loadId.current += 1;
    const thisLoad = loadId.current;
    setLoading(true);
    return listApiAccessRequests(session.accessToken, status)
      .then((next) => {
        if (loadId.current !== thisLoad) return;
        setRequests(next.items);
        setError(null);
      })
      .catch((err: Error) => {
        if (loadId.current !== thisLoad) return;
        setError(err.message || 'Unable to load API access requests.');
      })
      .finally(() => {
        // A superseded load must not clear the spinner the live one set.
        if (loadId.current === thisLoad) setLoading(false);
      });
  }, [session.accessToken, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (request: ApiAccessRequestQueueItem, decision: 'approve' | 'deny') => {
    setBusyId(request.id);
    try {
      await decideApiAccessRequest(
        session.accessToken,
        request.id,
        decision,
        notes[request.id]
      );
      setNotes((current) => {
        const next = { ...current };
        delete next[request.id];
        return next;
      });
      await load();
    } catch (err) {
      setError((err as Error).message || 'That decision could not be saved.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="admin-section">
      <PageHeading title="API access">
        <p>Growers asking to integrate with the Good Roots API. Approving lets them create one key from their own settings — the key itself never passes through here.</p>
      </PageHeading>

      <div className="admin-tabs" role="tablist">
        {STATUS_TABS.map((tab) => (
          <Button
            key={tab.id}
            variant={tab.id === status ? 'primary' : 'ghost'}
            size="sm"
            role="tab"
            aria-selected={tab.id === status}
            onClick={() => setStatus(tab.id)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {error ? <FormFeedback tone="error">{error}</FormFeedback> : null}

      {loading ? <p>Loading requests…</p> : null}

      {!loading && !error && requests.length === 0 ? (
        <EmptyState compact icon="journal" title={status === 'pending' ? 'Nothing waiting for review' : `No ${status} requests yet`}><p>Use the status filters to review other API access requests.</p></EmptyState>
      ) : null}

      <ul className="admin-list" aria-label="API access requests">
        {requests.map((request) => (
          <li key={request.id}>
            <Card padding="6">
              <h3>{request.integrationName}</h3>
              <p>
                {requesterLabel(request)}
                {request.userTier ? ` · ${request.userTier} tier` : ''}
              </p>
              <p>Requested {formatDate(request.createdAt)}</p>
              {request.contactEmail ? <p>Contact: {request.contactEmail}</p> : null}

              <p>{request.intendedUse}</p>

              {request.decisionNote ? <p>Note: {request.decisionNote}</p> : null}
              {request.decidedAt ? <p>Decided {formatDate(request.decidedAt)}</p> : null}

              {status === 'pending' ? (
                <>
                  <Textarea
                    label="Note (optional)"
                    value={notes[request.id] ?? ''}
                    onChange={(event) =>
                      setNotes((current) => ({
                        ...current,
                        [request.id]: event.target.value,
                      }))
                    }
                    placeholder="Recorded with the decision and shown to the grower"
                  />
                  <div className="admin-actions">
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={busyId === request.id}
                      onClick={() => void decide(request, 'approve')}
                    >
                      Approve
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busyId === request.id}
                      onClick={() => void decide(request, 'deny')}
                    >
                      Deny
                    </Button>
                  </div>
                </>
              ) : null}
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default ApiAccessPage;
