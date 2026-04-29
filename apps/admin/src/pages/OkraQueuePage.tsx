import { useEffect, useState } from 'react';
import { Button, Card, FormFeedback, SectionHeading } from '@olivias/ui';
import {
  listOkraReviewQueue,
  reviewOkraSubmission,
  type OkraDenialReason,
  type OkraSubmission,
} from '../api';
import type { AdminSession } from '../auth/session';

const DENIAL_REASON_OPTIONS: Array<{ value: OkraDenialReason; label: string }> = [
  { value: 'spam', label: 'Spam' },
  { value: 'invalid_location', label: 'Invalid location' },
  { value: 'inappropriate', label: 'Inappropriate content' },
  { value: 'other', label: 'Other (notes required)' },
];

const DEFAULT_VISIBLE_PHOTOS = 3;
const MOBILE_PHOTO_QUERY = '(max-width: 640px)';

type ReviewPhoto = {
  id: string;
  url: string;
  review_status: string;
  edit_action: 'add' | 'remove' | null;
};

function reviewPhotosFor(submission: OkraSubmission): ReviewPhoto[] {
  if ((submission.photo_details ?? []).length > 0) {
    return submission.photo_details ?? [];
  }
  return submission.photos.map((url, index) => ({
    id: `${submission.id}-${index}`,
    url,
    review_status: 'approved',
    edit_action: null,
  }));
}

function PhotoCarousel({ photos, alt }: { photos: ReviewPhoto[]; alt: string }) {
  const [startIndex, setStartIndex] = useState(0);
  const [visiblePhotos, setVisiblePhotos] = useState<number>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return DEFAULT_VISIBLE_PHOTOS;
    }
    return window.matchMedia(MOBILE_PHOTO_QUERY).matches ? 1 : DEFAULT_VISIBLE_PHOTOS;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(MOBILE_PHOTO_QUERY);
    const update = () => setVisiblePhotos(mq.matches ? 1 : DEFAULT_VISIBLE_PHOTOS);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  if (photos.length === 0) return null;

  const total = photos.length;
  const canScroll = total > visiblePhotos;
  const maxStart = Math.max(0, total - visiblePhotos);
  const clampedStart = Math.min(startIndex, maxStart);
  const visible = photos.slice(clampedStart, clampedStart + visiblePhotos);
  const atStart = clampedStart === 0;
  const atEnd = clampedStart >= maxStart;

  return (
    <div className="admin-photo-carousel">
      <div className="admin-photo-carousel__viewport" role="group" aria-label={alt}>
        {visible.map((photo, i) => (
          <div
            key={`${clampedStart + i}-${photo.id}`}
            className={`admin-photo-carousel__item ${photo.edit_action ? `admin-photo-carousel__item--${photo.edit_action}` : ''}`.trim()}
          >
            <img
              className="admin-photo-carousel__thumb"
              src={photo.url}
              alt={`${alt} photo ${clampedStart + i + 1} of ${total}`}
            />
            {photo.edit_action ? (
              <span className="admin-photo-carousel__badge">
                {photo.edit_action === 'add' ? 'Added' : 'Remove requested'}
              </span>
            ) : null}
          </div>
        ))}
      </div>
      {canScroll ? (
        <>
          <button
            type="button"
            className="admin-photo-carousel__nav admin-photo-carousel__nav--prev"
            aria-label="Previous photos"
            disabled={atStart}
            onClick={() => setStartIndex((i) => Math.max(0, i - 1))}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M15.4 6.4 14 5l-7 7 7 7 1.4-1.4L9.8 12Z" fill="currentColor" />
            </svg>
          </button>
          <button
            type="button"
            className="admin-photo-carousel__nav admin-photo-carousel__nav--next"
            aria-label="Next photos"
            disabled={atEnd}
            onClick={() => setStartIndex((i) => Math.min(maxStart, i + 1))}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M8.6 6.4 10 5l7 7-7 7-1.4-1.4L14.2 12Z" fill="currentColor" />
            </svg>
          </button>
          <div className="admin-photo-carousel__counter" aria-hidden="true">
            {visiblePhotos === 1
              ? `${clampedStart + 1} of ${total}`
              : `${clampedStart + 1}–${Math.min(clampedStart + visiblePhotos, total)} of ${total}`}
          </div>
        </>
      ) : null}
    </div>
  );
}

function ReviewDiff({ submission }: { submission: OkraSubmission }) {
  if (submission.review_kind !== 'edit') return null;

  const rows = [
    ['Name', submission.current_contributor_name || 'Anonymous contributor', submission.contributor_name || 'Anonymous contributor'],
    ['Story', submission.current_story_text || 'No story provided.', submission.story_text || 'No story provided.'],
    ['Location', submission.current_raw_location_text || 'No location text provided.', submission.raw_location_text || 'No location text provided.'],
    ['Privacy', submission.current_privacy_mode || 'Unknown', submission.privacy_mode || 'Unknown'],
    [
      'Coordinates',
      submission.current_display_lat != null && submission.current_display_lng != null
        ? `${submission.current_display_lat.toFixed(4)}, ${submission.current_display_lng.toFixed(4)}`
        : 'Unknown',
      submission.display_lat != null && submission.display_lng != null
        ? `${submission.display_lat.toFixed(4)}, ${submission.display_lng.toFixed(4)}`
        : 'Unknown',
    ],
  ].filter(([, before, after]) => before !== after);

  return (
    <div className="admin-submission-card__diff" aria-label="Edited fields">
      <strong>Proposed changes</strong>
      {rows.length === 0 ? (
        <p>No text or location fields changed.</p>
      ) : (
        <dl>
          {rows.map(([label, before, after]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd><span>Before</span>{before}</dd>
              <dd><span>After</span>{after}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

export interface OkraQueuePageProps {
  session: AdminSession;
}

export function OkraQueuePage({ session }: OkraQueuePageProps) {
  const [queue, setQueue] = useState<OkraSubmission[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [denyNotes, setDenyNotes] = useState<Record<string, string>>({});
  const [denyReasons, setDenyReasons] = useState<Record<string, OkraDenialReason>>({});

  useEffect(() => {
    let active = true;
    listOkraReviewQueue(session.accessToken)
      .then((next) => {
        if (!active) return;
        setQueue(next.data);
        setTotal(next.total);
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
      setQueue(next.data);
      setTotal(next.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to refresh Okra queue.');
    } finally {
      setLoading(false);
    }
  };

  const handleReview = async (submission: OkraSubmission, action: 'approved' | 'denied') => {
    const targetEditId = submission.review_kind === 'edit' ? submission.edit_id ?? undefined : undefined;
    if (action === 'denied') {
      const reason = denyReasons[submission.id] ?? 'spam';
      const trimmedNote = denyNotes[submission.id]?.trim() ?? '';
      if (reason === 'other' && trimmedNote.length === 0) {
        setError('Add a deny note when the reason is "Other".');
        return;
      }
      setBusyId(submission.id);
      setError(null);
      try {
        await reviewOkraSubmission(session.accessToken, submission.id, {
          status: 'denied',
          reason,
          ...(trimmedNote.length > 0 ? { review_notes: trimmedNote } : {}),
          ...(targetEditId ? { target_edit_id: targetEditId } : {}),
        });
        clearReviewState(submission.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to update submission status.');
      } finally {
        setBusyId(null);
      }
      return;
    }

    setBusyId(submission.id);
    setError(null);
    try {
      await reviewOkraSubmission(session.accessToken, submission.id, {
        status: 'approved',
        ...(targetEditId ? { target_edit_id: targetEditId } : {}),
      });
      clearReviewState(submission.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update submission status.');
    } finally {
      setBusyId(null);
    }
  };

  const clearReviewState = (submissionId: string) => {
    setQueue((current) => current.filter((item) => item.id !== submissionId));
    setDenyNotes((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== submissionId)));
    setDenyReasons((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== submissionId)));
    setTotal((current) => Math.max(0, current - 1));
  };

  return (
    <section className="admin-section">
      <div className="admin-section__header">
        <SectionHeading
          eyebrow="Okra"
          title={`Pending submissions (${total})`}
          body="Approve new submissions and edits. Approved submissions stay live while proposed edits wait here."
        />
        <Button
          className="admin-refresh-action"
          variant="outline"
          size="sm"
          onClick={() => void refresh()}
          disabled={loading}
        >
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
              {submission.review_kind === 'edit' ? (
                <div className="admin-submission-card__edit-note">
                  <strong>Edited submission</strong>
                  <p>
                    Current: {submission.current_contributor_name || 'Anonymous contributor'}
                    {' '}in {submission.current_raw_location_text || 'unknown location'}
                  </p>
                </div>
              ) : null}
              <ReviewDiff submission={submission} />
              <p className="admin-submission-card__story">
                {submission.story_text || 'No story provided.'}
              </p>
              <p className="admin-submission-card__location">
                {submission.raw_location_text || 'No location text provided.'}
              </p>
              {submission.photos && submission.photos.length > 0 ? (
                <PhotoCarousel
                  photos={reviewPhotosFor(submission)}
                  alt={`Okra submission from ${submission.contributor_name || 'anonymous contributor'}`}
                />
              ) : null}
              {submission.review_kind === 'edit' && submission.photo_details?.some((photo) => photo.edit_action) ? (
                <div className="admin-submission-card__photo-actions">
                  {submission.photo_details.filter((photo) => photo.edit_action).map((photo) => (
                    <span key={`${photo.id}-${photo.edit_action}`}>
                      {photo.edit_action === 'add' ? 'Added photo' : 'Removed photo'}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="admin-submission-card__deny-fields">
                <label className="admin-submission-card__deny-reason">
                  <span>Deny reason</span>
                  <select
                    value={denyReasons[submission.id] ?? 'spam'}
                    onChange={(event) => setDenyReasons((current) => ({
                      ...current,
                      [submission.id]: event.target.value as OkraDenialReason,
                    }))}
                    disabled={busyId !== null}
                  >
                    {DENIAL_REASON_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="admin-submission-card__deny-note">
                  <span>Deny note{(denyReasons[submission.id] ?? 'spam') === 'other' ? ' (required)' : ''}</span>
                  <textarea
                    value={denyNotes[submission.id] ?? ''}
                    onChange={(event) => setDenyNotes((current) => ({
                      ...current,
                      [submission.id]: event.target.value,
                    }))}
                    placeholder={submission.review_kind === 'edit' ? 'Optional context for this edit review' : 'Optional context shared with the contributor'}
                    rows={2}
                    disabled={busyId !== null}
                  />
                </label>
              </div>
              <div className="admin-submission-card__actions">
                <Button
                  onClick={() => void handleReview(submission, 'approved')}
                  loading={busyId === submission.id}
                  disabled={busyId !== null}
                >
                  {submission.review_kind === 'edit' ? 'Approve edit' : 'Approve'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void handleReview(submission, 'denied')}
                  disabled={busyId !== null}
                >
                  {submission.review_kind === 'edit' ? 'Deny edit' : 'Deny'}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
