import { useEffect, useState } from 'react';
import { Button, Card, FormFeedback, SectionHeading } from '@olivias/ui';
import {
  listOkraReviewQueue,
  reviewOkraSubmission,
  type OkraSubmission,
} from '../api';
import type { AdminSession } from '../auth/session';

function PhotoCarousel({ photos, alt }: { photos: string[]; alt: string }) {
  const [index, setIndex] = useState(0);

  if (photos.length === 0) return null;

  const clamped = Math.min(index, photos.length - 1);
  const showControls = photos.length > 1;

  return (
    <div className="admin-photo-carousel">
      <img
        className="admin-photo-carousel__image"
        src={photos[clamped]}
        alt={alt}
      />
      {showControls ? (
        <>
          <button
            type="button"
            className="admin-photo-carousel__nav admin-photo-carousel__nav--prev"
            aria-label="Previous photo"
            onClick={() => setIndex((i) => (i - 1 + photos.length) % photos.length)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M15.4 6.4 14 5l-7 7 7 7 1.4-1.4L9.8 12Z" fill="currentColor" />
            </svg>
          </button>
          <button
            type="button"
            className="admin-photo-carousel__nav admin-photo-carousel__nav--next"
            aria-label="Next photo"
            onClick={() => setIndex((i) => (i + 1) % photos.length)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M8.6 6.4 10 5l7 7-7 7-1.4-1.4L14.2 12Z" fill="currentColor" />
            </svg>
          </button>
          <div className="admin-photo-carousel__counter" aria-hidden="true">
            {clamped + 1} / {photos.length}
          </div>
          <div className="admin-photo-carousel__dots" role="tablist" aria-label="Select photo">
            {photos.map((_, i) => (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={i === clamped}
                aria-label={`Photo ${i + 1}`}
                className={`admin-photo-carousel__dot${i === clamped ? ' is-active' : ''}`}
                onClick={() => setIndex(i)}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

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
              {submission.photos && submission.photos.length > 0 ? (
                <PhotoCarousel
                  photos={submission.photos}
                  alt={`Okra submission from ${submission.contributor_name || 'anonymous contributor'}`}
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
