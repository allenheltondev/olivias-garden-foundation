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
              return (
                <Card key={submission.id} className="admin-submission-card okra-submission-card">
                  <div className="admin-submission-card__meta">
                    <div>
                      <h3>{submission.contributorName || 'Anonymous contributor'}</h3>
                      <p>{submission.rawLocationText || 'No location text provided.'}</p>
                    </div>
                    <span>{formatDate(submission.createdAt)}</span>
                  </div>
                  <div className="okra-submission-card__status-row">
                    <span className={`okra-submission-card__status okra-submission-card__status--${status.tone}`}>
                      {status.label}
                    </span>
                    {submission.editCount > 0 ? <span className="okra-submission-card__edited">edited</span> : null}
                  </div>
                  <p className="admin-submission-card__story">
                    {submission.storyText || 'No story provided.'}
                  </p>
                  {submission.photos.length > 0 ? (
                    <div className="profile-activity__photos okra-submission-card__photos">
                      {submission.photos.slice(0, 5).map((photo) => (
                        <img key={photo.id} src={photo.url} alt="" />
                      ))}
                      {submission.photos.length > 5 ? (
                        <span className="okra-submission-card__photo-count">+{submission.photos.length - 5}</span>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="admin-submission-card__actions">
                    {submission.hasPendingEdit ? (
                      <p className="page-text okra-submission-card__pending-note">
                        An edit is awaiting review. You can submit another edit once it&rsquo;s approved or denied.
                      </p>
                    ) : (
                      <Button type="button" onClick={() => {
                        setNotice(null);
                        setEditing(submission);
                      }}>
                        Edit submission
                      </Button>
                    )}
                  </div>
                </Card>
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
