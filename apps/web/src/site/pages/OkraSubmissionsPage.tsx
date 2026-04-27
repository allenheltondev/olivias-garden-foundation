import { useCallback, useEffect, useState } from 'react';
import { Button, Card, FormFeedback } from '@olivias/ui';
import type { AuthSession } from '../../auth/session';
import { createOkraHeaders, okraApiUrl } from '../../okra/api';
import { SubmissionModal } from '../../okra/components/SubmissionModal';
import type { PrivacyMode } from '../../okra/hooks/useSubmissionForm';
import { PageHero, Section } from '../chrome';

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
    return {
      label: 'Edit pending',
      tone: 'pending',
      detail: 'Your live pin stays unchanged while the edit is reviewed.',
    };
  }
  if (submission.status === 'approved') {
    return {
      label: 'Live on map',
      tone: 'live',
      detail: submission.editCount > 0 ? 'Approved and marked edited.' : 'Approved and visible.',
    };
  }
  if (submission.status === 'denied') {
    return {
      label: 'Needs follow-up',
      tone: 'denied',
      detail: 'Message us if you want help revising this submission.',
    };
  }
  return {
    label: 'Pending review',
    tone: 'pending',
    detail: 'We will review it before it appears on the map.',
  };
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
        eyebrow="The Okra Project"
        title="Your okra submissions"
        body="Review the okra patches tied to your account and submit edits for approval."
        className="profile-hero"
      />

      <Section title="Submissions" intro="Approved submissions stay visible while edits are reviewed.">
        {notice ? <FormFeedback tone="success">{notice}</FormFeedback> : null}
        {error ? <FormFeedback tone="error">{error}</FormFeedback> : null}
        {loading ? (
          <p className="page-text">Loading your okra submissions...</p>
        ) : submissions.length === 0 ? (
          <Card className="okra-submissions-empty">
            <h3>No okra submissions yet</h3>
            <p className="page-text">Add your patch from the Okra Project map while signed in, then it will show up here for future edits.</p>
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
                    <p>{status.detail}</p>
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
                    <Button type="button" onClick={() => {
                      setNotice(null);
                      setEditing(submission);
                    }}>
                      {submission.hasPendingEdit ? 'Edit pending changes' : 'Edit submission'}
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </Section>

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
