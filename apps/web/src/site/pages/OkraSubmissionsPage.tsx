import { useCallback, useEffect, useState } from 'react';
import { Button, Card, FormFeedback } from '@olivias/ui';
import type { AuthSession } from '../../auth/session';
import { createOkraHeaders, okraApiUrl } from '../../okra/api';
import { SubmissionModal } from '../../okra/components/SubmissionModal';
import type { PrivacyMode } from '../../okra/hooks/useSubmissionForm';
import { PageHero } from '../chrome';

type OkraSubmissionPhoto = {
  id: string;
  url: string;
};

type OkraSubmission = {
  id: string;
  contributorName: string | null;
  storyText: string | null;
  rawLocationText: string;
  privacyMode: PrivacyMode;
  displayLat: number;
  displayLng: number;
  status: string;
  createdAt: string;
  editedAt: string | null;
  editCount: number;
  hasPendingEdit: boolean;
  photos: OkraSubmissionPhoto[];
};

async function fetchOkraSubmissions(authSession: AuthSession): Promise<OkraSubmission[]> {
  const response = await fetch(okraApiUrl('/me/submissions'), {
    method: 'GET',
    headers: createOkraHeaders({ accessToken: authSession.accessToken }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.message ?? body?.error?.message ?? body?.error ?? 'Unable to load your okra submissions.');
  }

  const body = await response.json() as { submissions?: OkraSubmission[] };
  return body.submissions ?? [];
}

function formatDate(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function getSubmissionStatus(submission: OkraSubmission) {
  if (submission.hasPendingEdit) {
    return { label: 'Edit pending', tone: 'pending' };
  }
  if (submission.status === 'approved') {
    return { label: 'Live on map', tone: 'live' };
  }
  if (submission.status === 'denied') {
    return { label: 'Needs follow-up', tone: 'denied' };
  }
  return { label: 'Pending review', tone: 'pending' };
}

const PRIVACY_LABELS: Record<PrivacyMode, { label: string; help: string }> = {
  exact: { label: 'Exact location', help: 'Your pin sits on the precise coordinates.' },
  nearby: { label: 'Nearby (~100 m)', help: 'Pin is fuzzed within roughly a block.' },
  neighborhood: { label: 'Neighborhood', help: 'Pin is fuzzed within a few streets.' },
  city: { label: 'City only', help: 'Pin shows the surrounding city, not the address.' },
};

function PinIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M12 2c-3.87 0-7 3.13-7 7 0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7Zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Z"
      />
    </svg>
  );
}

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M12 2 4 5v6c0 4.97 3.4 9.6 8 11 4.6-1.4 8-6.03 8-11V5l-8-3Zm0 9.5h6c-.4 3.5-2.7 6.7-6 7.93V11.5H6V6.3l6-2.25v7.45Z"
      />
    </svg>
  );
}

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="m14.06 4.94 5 5L8.94 20.06 4 21l.94-4.94L14.06 4.94Zm1.41-1.41 2.12-2.12a1 1 0 0 1 1.42 0l3.58 3.58a1 1 0 0 1 0 1.42l-2.12 2.12-5-5Z"
      />
    </svg>
  );
}

export function OkraSubmissionsPage({
  authSession,
  authReady,
  onNavigate,
}: {
  authSession: AuthSession | null;
  authReady: boolean;
  onNavigate: (path: string) => void;
}) {
  const [submissions, setSubmissions] = useState<OkraSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<OkraSubmission | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (authReady && !authSession) {
      onNavigate('/login');
    }
  }, [authReady, authSession, onNavigate]);

  const refresh = useCallback(async () => {
    if (!authSession) return;
    setLoading(true);
    try {
      const next = await fetchOkraSubmissions(authSession);
      setSubmissions(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load your okra submissions.');
    } finally {
      setLoading(false);
    }
  }, [authSession]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!authSession) {
    return (
      <section className="page-section profile-empty">
        <p className="page-text">{authReady ? 'Redirecting to log in...' : 'Loading your session...'}</p>
      </section>
    );
  }

  return (
    <>
      <PageHero
        title="Your okra submissions"
        body="Approved patches stay live while edits are reviewed."
        className="profile-hero"
      />

      <section className="page-section">
        {notice ? <FormFeedback tone="success">{notice}</FormFeedback> : null}
        {error ? <FormFeedback tone="error">{error}</FormFeedback> : null}
        {loading ? (
          <p className="page-text">Loading...</p>
        ) : submissions.length === 0 ? (
          <Card className="okra-submissions-empty">
            <p className="page-text">You haven&rsquo;t added a patch yet.</p>
            <Button type="button" onClick={() => onNavigate('/okra')}>
              Go to the okra map
            </Button>
          </Card>
        ) : (
          <div className="okra-submissions-list">
            {submissions.map((submission) => {
              const status = getSubmissionStatus(submission);
              const privacy = PRIVACY_LABELS[submission.privacyMode];
              const heroPhoto = submission.photos[0];
              const moreThumbs = submission.photos.slice(1, 5);
              const remaining = Math.max(0, submission.photos.length - (1 + moreThumbs.length));
              return (
                <article key={submission.id} className="okra-submission-card">
                  {heroPhoto ? (
                    <div className="okra-submission-card__media">
                      <img className="okra-submission-card__hero" src={heroPhoto.url} alt="" />
                      <span className={`okra-submission-card__status okra-submission-card__status--${status.tone}`}>
                        <span className="okra-submission-card__status-dot" aria-hidden="true" />
                        {status.label}
                      </span>
                      {moreThumbs.length > 0 ? (
                        <div className="okra-submission-card__thumbs" aria-label="More photos">
                          {moreThumbs.map((photo) => (
                            <img key={photo.id} src={photo.url} alt="" />
                          ))}
                          {remaining > 0 ? (
                            <span className="okra-submission-card__thumb-more">+{remaining}</span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="okra-submission-card__media okra-submission-card__media--empty" aria-hidden="true">
                      <span className={`okra-submission-card__status okra-submission-card__status--${status.tone}`}>
                        <span className="okra-submission-card__status-dot" aria-hidden="true" />
                        {status.label}
                      </span>
                      <span className="okra-submission-card__no-photo">No photo</span>
                    </div>
                  )}

                  <div className="okra-submission-card__body">
                    <header className="okra-submission-card__head">
                      <h3 className="okra-submission-card__title">
                        {submission.contributorName || 'Anonymous contributor'}
                      </h3>
                      <p className="okra-submission-card__date">
                        Added {formatDate(submission.createdAt)}
                        {submission.editCount > 0 && submission.editedAt
                          ? ` · Last edited ${formatDate(submission.editedAt)}`
                          : null}
                      </p>
                    </header>

                    <ul className="okra-submission-card__chips" aria-label="Submission details">
                      <li className="okra-submission-card__chip">
                        <PinIcon className="okra-submission-card__chip-icon" />
                        <span>{submission.rawLocationText || 'No location text'}</span>
                      </li>
                      <li className="okra-submission-card__chip" title={privacy.help}>
                        <ShieldIcon className="okra-submission-card__chip-icon" />
                        <span>{privacy.label}</span>
                      </li>
                    </ul>

                    {submission.storyText ? (
                      <p className="okra-submission-card__story">{submission.storyText}</p>
                    ) : (
                      <p className="okra-submission-card__story okra-submission-card__story--empty">
                        No story shared.
                      </p>
                    )}

                    <footer className="okra-submission-card__footer">
                      {submission.hasPendingEdit ? (
                        <p className="okra-submission-card__pending-note">
                          An edit is awaiting review. You can submit another once it&rsquo;s approved or denied.
                        </p>
                      ) : (
                        <Button
                          type="button"
                          onClick={() => {
                            setNotice(null);
                            setEditing(submission);
                          }}
                        >
                          <PencilIcon className="okra-submission-card__btn-icon" />
                          Edit submission
                        </Button>
                      )}
                    </footer>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <SubmissionModal
        open={editing !== null}
        onClose={() => setEditing(null)}
        authEnabled
        authSession={authSession}
        mode="edit"
        editSubmission={editing}
        onSubmitted={() => {
          setNotice('Your edits were sent for review. Your approved pin stays visible while we review them.');
          void refresh();
        }}
      />
    </>
  );
}
