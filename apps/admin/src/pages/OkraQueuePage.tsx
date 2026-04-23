import { useEffect, useState } from 'react';
import { Button, Card, FormFeedback, SectionHeading } from '@olivias/ui';
import {
  listOkraReviewQueue,
  reviewOkraSubmission,
  type OkraSubmission,
} from '../api';
import type { AdminSession } from '../auth/session';

export interface OkraQueuePageProps {
  session: AdminSession;
}

export function OkraQueuePage({ session }: OkraQueuePageProps) {
  const [queue, setQueue] = useState<OkraSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listOkraReviewQueue(session.accessToken)
      .then((next) => {
        if (!active) return;
        setQueue(next);
        setError(null);
      })
      .catch((err: Error) => {
        if (!active) return;
        setError(err.message || 'Unable to load Okra review queue.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session.accessToken]);

  const refresh = async () => {
    setLoading(true);
    try {
      const next = await listOkraReviewQueue(session.accessToken);
      setQueue(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to refresh Okra queue.');
    } finally {
      setLoading(false);
    }
  };

  const handleReview = async (submission: OkraSubmission, action: 'approved' | 'denied') => {
    setBusyId(submission.id);
    setError(null);
    try {
      if (action === 'approved') {
        await reviewOkraSubmission(session.accessToken, submission.id, { status: 'approved' });
      } else {
        await reviewOkraSubmission(session.accessToken, submission.id, {
          status: 'denied',
          reason: 'other',
          review_notes: 'Reviewed in admin dashboard.',
        });
      }
      setQueue((current) => current.filter((item) => item.id !== submission.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update submission status.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="admin-section">
      <div className="admin-section__header">
        <SectionHeading
          eyebrow="Okra queue"
          title="Pending submissions"
          body="Approve or deny community submissions before they appear on the public map."
        />
        <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
          Refresh
        </Button>
      </div>

      {error ? (
        <FormFeedback tone="error" className="admin-load-error">{error}</FormFeedback>
      ) : null}

      {loading && queue.length === 0 ? (
        <Card><p>Loading okra submissions…</p></Card>
      ) : queue.length === 0 ? (
        <Card><p>No pending okra submissions.</p></Card>
      ) : (
        <div className="admin-stack">
          {queue.map((submission) => (
            <Card key={submission.id} className="admin-submission-card">
              <div className="admin-submission-card__meta">
                <div>
                  <h3>{submission.contributor_name || 'Anonymous contributor'}</h3>
                  <p>{submission.contributor_email || 'No email provided'}</p>
                </div>
                <span>{new Date(submission.created_at).toLocaleString()}</span>
              </div>
              <p className="admin-submission-card__story">
                {submission.story_text || 'No story provided.'}
              </p>
              <p className="admin-submission-card__location">
                {submission.raw_location_text || 'No location text provided.'}
              </p>
              {submission.photos?.[0] ? (
                <img
                  className="admin-submission-card__photo"
                  src={submission.photos[0]}
                  alt="Okra submission"
                />
              ) : null}
              <div className="admin-submission-card__actions">
                <Button
                  onClick={() => void handleReview(submission, 'approved')}
                  loading={busyId === submission.id}
                  disabled={busyId !== null}
                >
                  Approve
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void handleReview(submission, 'denied')}
                  disabled={busyId !== null}
                >
                  Deny
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
