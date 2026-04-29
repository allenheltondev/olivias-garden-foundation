import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Button, FormFeedback, Input, Panel, Textarea } from '@olivias/ui';
import type { AuthSession } from '../../auth/session';
import { createOkraHeaders, okraApiUrl } from '../../okra/api';
import { PageHero, Section } from '../chrome';
import { webApiBase } from '../routes';

type AvatarStatus = 'none' | 'uploaded' | 'processing' | 'ready' | 'failed';

type ProfileResponse = {
  userId: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  bio: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  timezone: string | null;
  avatarUrl: string | null;
  avatarThumbnailUrl: string | null;
  avatarStatus: AvatarStatus;
  avatarProcessingError: string | null;
  websiteUrl: string | null;
  tier: string | null;
  gardenClubStatus: string | null;
  donationTotalCents: number;
  donationCount: number;
  lastDonatedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  profileUpdatedAt: string | null;
};

type AvatarUploadIntent = {
  avatarId: string;
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  s3Key: string;
  expiresInSeconds: number;
};

type DonationActivityItem = {
  id: string;
  type: 'donation';
  donationMode: 'one_time' | 'recurring';
  amountCents: number;
  currency: string;
  dedicationName: string | null;
  tShirtPreference: string | null;
  createdAt: string;
};

type SubmissionActivityItem = {
  id: string;
  type: 'okra_submission';
  status: string;
  storyText: string | null;
  rawLocationText: string | null;
  privacyMode: string | null;
  country: string | null;
  createdAt: string;
  photoUrls: string[];
};

type SeedRequestActivityItem = {
  id: string;
  type: 'seed_request';
  name: string | null;
  fulfillmentMethod: 'mail' | 'in_person' | null;
  shippingCity: string | null;
  shippingRegion: string | null;
  shippingCountry: string | null;
  message: string | null;
  createdAt: string;
};

type ActivityItem = DonationActivityItem | SubmissionActivityItem | SeedRequestActivityItem;

function webApiUrl(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${webApiBase}${normalizedPath}`;
}

function createCorrelationId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `ogf-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function authHeaders(authSession: AuthSession | null, includeContentType: boolean) {
  const headers: Record<string, string> = {
    'X-Correlation-Id': createCorrelationId(),
  };
  if (includeContentType) {
    headers['Content-Type'] = 'application/json';
  }
  if (authSession?.accessToken) {
    headers.Authorization = `Bearer ${authSession.accessToken}`;
  }
  return headers;
}

async function fetchProfile(authSession: AuthSession): Promise<ProfileResponse> {
  const response = await fetch(webApiUrl('/profile'), {
    method: 'GET',
    headers: authHeaders(authSession, false),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.error ?? 'Unable to load your profile.');
  }

  return (await response.json()) as ProfileResponse;
}

async function saveProfile(
  authSession: AuthSession,
  payload: Partial<ProfileResponse>,
): Promise<ProfileResponse> {
  const response = await fetch(webApiUrl('/profile'), {
    method: 'PUT',
    headers: authHeaders(authSession, true),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const detail = body?.details?.issues?.[0];
    throw new Error(detail ?? body?.error ?? 'Unable to save your profile.');
  }

  return (await response.json()) as ProfileResponse;
}

async function fetchDonationActivity(authSession: AuthSession): Promise<DonationActivityItem[]> {
  const response = await fetch(webApiUrl('/profile/activity'), {
    method: 'GET',
    headers: authHeaders(authSession, false),
  });
  if (!response.ok) {
    return [];
  }
  const body = await response.json() as { donations?: DonationActivityItem[] };
  return body.donations ?? [];
}

async function fetchOkraActivity(
  authSession: AuthSession,
): Promise<{ submissions: SubmissionActivityItem[]; seedRequests: SeedRequestActivityItem[] }> {
  const response = await fetch(okraApiUrl('/me/activity'), {
    method: 'GET',
    headers: createOkraHeaders({ accessToken: authSession.accessToken }),
  });
  if (!response.ok) {
    return { submissions: [], seedRequests: [] };
  }
  const body = await response.json() as {
    submissions?: SubmissionActivityItem[];
    seedRequests?: SeedRequestActivityItem[];
  };
  return {
    submissions: body.submissions ?? [],
    seedRequests: body.seedRequests ?? [],
  };
}

function formatCurrency(amountCents: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amountCents / 100);
  } catch {
    return `$${(amountCents / 100).toFixed(2)}`;
  }
}

function formatDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function detectBrowserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    return '';
  }
}

async function requestAvatarUploadIntent(
  authSession: AuthSession,
  contentType: string,
): Promise<AvatarUploadIntent> {
  const response = await fetch(webApiUrl('/profile/avatar'), {
    method: 'POST',
    headers: authHeaders(authSession, true),
    body: JSON.stringify({ contentType }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.error ?? 'Unable to start avatar upload.');
  }

  return (await response.json()) as AvatarUploadIntent;
}

async function putAvatarToS3(intent: AvatarUploadIntent, file: File) {
  const response = await fetch(intent.uploadUrl, {
    method: 'PUT',
    headers: intent.headers,
    body: file,
  });
  if (!response.ok) {
    throw new Error(`Upload to storage failed (${response.status}).`);
  }
}

async function completeAvatarUpload(authSession: AuthSession): Promise<void> {
  const response = await fetch(webApiUrl('/profile/avatar/complete'), {
    method: 'POST',
    headers: authHeaders(authSession, false),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.error ?? 'Unable to finalize avatar upload.');
  }
}

async function deleteAccount(authSession: AuthSession): Promise<void> {
  const response = await fetch(webApiUrl('/profile'), {
    method: 'DELETE',
    headers: authHeaders(authSession, false),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.error ?? 'Unable to delete your account. Please try again.');
  }
}

const DELETE_CONFIRMATION_PHRASE = 'DELETE';

type EditableProfile = {
  firstName: string;
  lastName: string;
  displayName: string;
  bio: string;
  city: string;
  region: string;
  country: string;
  timezone: string;
  websiteUrl: string;
};

function toEditable(
  profile: ProfileResponse | null,
  authSession: AuthSession | null,
): EditableProfile {
  // A profile that has never been saved lets us prefill from the Cognito
  // registration claims; once the user saves the form, we stop overriding.
  const neverSaved = Boolean(profile) && !profile?.profileUpdatedAt;
  const sessionFirst = authSession?.user.firstName?.trim() ?? '';
  const sessionLast = authSession?.user.lastName?.trim() ?? '';

  const firstName = profile?.firstName ?? (neverSaved ? sessionFirst : '');
  const lastName = profile?.lastName ?? (neverSaved ? sessionLast : '');

  const displayName = neverSaved
    ? [firstName, lastName].filter(Boolean).join(' ')
    : profile?.displayName ?? '';

  return {
    firstName,
    lastName,
    displayName,
    bio: profile?.bio ?? '',
    city: profile?.city ?? '',
    region: profile?.region ?? '',
    country: profile?.country ?? '',
    timezone: profile?.timezone ?? '',
    websiteUrl: profile?.websiteUrl ?? '',
  };
}

const AVATAR_POLL_INTERVAL_MS = 3000;
const AVATAR_POLL_MAX_ATTEMPTS = 20; // ~60 seconds total

export function ProfilePage({
  authSession,
  authReady,
  onNavigate,
  onAvatarUrlChange,
  onAccountDeleted,
}: {
  authSession: AuthSession | null;
  authReady: boolean;
  onNavigate: (path: string) => void;
  onAvatarUrlChange?: (url: string | null) => void;
  onAccountDeleted?: () => void;
}) {
  useEffect(() => {
    if (authReady && !authSession) {
      onNavigate('/login');
    }
  }, [authReady, authSession, onNavigate]);

  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [form, setForm] = useState<EditableProfile>(() => toEditable(null, null));
  const [isLoading, setIsLoading] = useState(true);
  const [avatarPollTimedOut, setAvatarPollTimedOut] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [donations, setDonations] = useState<DonationActivityItem[]>([]);
  const [submissions, setSubmissions] = useState<SubmissionActivityItem[]>([]);
  const [seedRequests, setSeedRequests] = useState<SeedRequestActivityItem[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);

  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!authSession) {
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);

    fetchProfile(authSession)
      .then((data) => {
        if (cancelled) return;
        setProfile(data);
        setForm(toEditable(data, authSession));
        onAvatarUrlChange?.(data.avatarThumbnailUrl ?? data.avatarUrl ?? null);
      })
      .catch((error: Error) => {
        if (cancelled) return;
        setLoadError(error.message);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [authSession?.accessToken]);

  useEffect(() => {
    if (!authSession) {
      return;
    }

    let cancelled = false;
    setActivityLoading(true);

    Promise.all([
      fetchDonationActivity(authSession),
      fetchOkraActivity(authSession),
    ])
      .then(([donationItems, okra]) => {
        if (cancelled) return;
        setDonations(donationItems);
        setSubmissions(okra.submissions);
        setSeedRequests(okra.seedRequests);
      })
      .catch(() => {
        // Non-blocking: activity is informational.
      })
      .finally(() => {
        if (!cancelled) setActivityLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [authSession?.accessToken]);

  const combinedActivity: ActivityItem[] = useMemo(() => {
    const combined: ActivityItem[] = [
      ...donations,
      ...submissions,
      ...seedRequests,
    ];
    combined.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
    return combined;
  }, [donations, submissions, seedRequests]);

  const handleInputChange = useCallback(
    (field: keyof EditableProfile) => (event: ChangeEvent<HTMLInputElement>) => {
      const { value } = event.target;
      setForm((prev) => ({ ...prev, [field]: value }));
      setSaveSuccess(false);
    },
    [],
  );

  const handleTextareaChange = useCallback(
    (field: keyof EditableProfile) => (event: ChangeEvent<HTMLTextAreaElement>) => {
      const { value } = event.target;
      setForm((prev) => ({ ...prev, [field]: value }));
      setSaveSuccess(false);
    },
    [],
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!authSession) return;

    setSaveError(null);
    setSaveSuccess(false);
    setIsSaving(true);

    try {
      const payload: Partial<ProfileResponse> = {
        firstName: form.firstName.trim() || null,
        lastName: form.lastName.trim() || null,
        displayName: form.displayName.trim() || null,
        bio: form.bio.trim() || null,
        city: form.city.trim() || null,
        region: form.region.trim() || null,
        country: form.country.trim() || null,
        timezone: form.timezone.trim() || null,
        websiteUrl: form.websiteUrl.trim() || null,
      };

      const saved = await saveProfile(authSession, payload);
      setProfile(saved);
      setForm(toEditable(saved, authSession));
      setSaveSuccess(true);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Unable to save your profile.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAvatarFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !authSession) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setAvatarError('Please choose a JPEG, PNG, or WebP image.');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setAvatarError('Image is too large. Please pick one under 8 MB.');
      return;
    }

    setAvatarError(null);
    setAvatarPollTimedOut(false);
    setAvatarUploading(true);

    try {
      const intent = await requestAvatarUploadIntent(authSession, file.type);
      await putAvatarToS3(intent, file);
      await completeAvatarUpload(authSession);
      const refreshed = await fetchProfile(authSession);
      setProfile(refreshed);
      onAvatarUrlChange?.(refreshed.avatarThumbnailUrl ?? refreshed.avatarUrl ?? null);
    } catch (error) {
      setAvatarError(error instanceof Error ? error.message : 'Unable to upload avatar.');
    } finally {
      setAvatarUploading(false);
    }
  };

  const openDeleteDialog = useCallback(() => {
    setDeleteConfirmation('');
    setDeleteError(null);
    setDeleteDialogOpen(true);
  }, []);

  const closeDeleteDialog = useCallback(() => {
    if (deleteSubmitting) return;
    setDeleteDialogOpen(false);
    setDeleteError(null);
    setDeleteConfirmation('');
  }, [deleteSubmitting]);

  const submitAccountDeletion = useCallback(async () => {
    if (!authSession) return;
    if (deleteConfirmation.trim().toUpperCase() !== DELETE_CONFIRMATION_PHRASE) {
      setDeleteError(`Type ${DELETE_CONFIRMATION_PHRASE} to confirm.`);
      return;
    }

    setDeleteError(null);
    setDeleteSubmitting(true);
    try {
      await deleteAccount(authSession);
      onAvatarUrlChange?.(null);
      setDeleteDialogOpen(false);
      if (onAccountDeleted) {
        onAccountDeleted();
      } else {
        onNavigate('/');
      }
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Unable to delete your account.');
    } finally {
      setDeleteSubmitting(false);
    }
  }, [authSession, deleteConfirmation, onAccountDeleted, onAvatarUrlChange, onNavigate]);

  useEffect(() => {
    if (!deleteDialogOpen) return;

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeDeleteDialog();
      }
    };
    document.addEventListener('keydown', handleKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [deleteDialogOpen, closeDeleteDialog]);

  const refreshAvatarManually = async () => {
    if (!authSession) return;
    setAvatarPollTimedOut(false);
    try {
      const fresh = await fetchProfile(authSession);
      setProfile(fresh);
      onAvatarUrlChange?.(fresh.avatarThumbnailUrl ?? fresh.avatarUrl ?? null);
    } catch {
      // Ignore; the user can try again.
    }
  };

  // Poll profile while the avatar is processing so the UI picks up the final URL.
  // Cap attempts so a stuck backend doesn't leave the UI spinning forever.
  useEffect(() => {
    if (!authSession || profile?.avatarStatus !== 'processing') return;

    let cancelled = false;
    let attempts = 0;
    const interval = window.setInterval(async () => {
      attempts += 1;
      try {
        const fresh = await fetchProfile(authSession);
        if (cancelled) return;
        setProfile(fresh);
        if (fresh.avatarStatus !== 'processing') {
          window.clearInterval(interval);
          onAvatarUrlChange?.(fresh.avatarThumbnailUrl ?? fresh.avatarUrl ?? null);
          return;
        }
      } catch {
        // Keep polling; transient failures are fine.
      }

      if (attempts >= AVATAR_POLL_MAX_ATTEMPTS && !cancelled) {
        window.clearInterval(interval);
        setAvatarPollTimedOut(true);
      }
    }, AVATAR_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [authSession, profile?.avatarStatus, onAvatarUrlChange]);

  if (!authSession) {
    return (
      <section className="page-section profile-empty">
        <p className="page-text">{authReady ? 'Redirecting to log in…' : 'Loading your session…'}</p>
      </section>
    );
  }

  const displayName =
    profile?.displayName?.trim()
      || [profile?.firstName, profile?.lastName].filter(Boolean).join(' ').trim()
      || [authSession.user.firstName, authSession.user.lastName].filter(Boolean).join(' ').trim()
      || authSession.user.name
      || authSession.user.email
      || 'Your profile';

  return (
    <>
      <PageHero
        eyebrow="Profile"
        title={`Welcome, ${displayName}.`}
        body="Keep your public details up to date and review what you've been part of at Olivia's Garden."
        className="profile-hero"
      />

      <Section title="Your details" intro="These fields appear anywhere we show your name — seed requests, submissions, and Garden Club.">
        {isLoading ? (
          <ProfileFormSkeleton />
        ) : loadError ? (
          <FormFeedback tone="error">{loadError}</FormFeedback>
        ) : (
          <Panel tone="paper" className="profile-form-panel">
            <form className="profile-form" onSubmit={handleSubmit}>
              <div className="profile-form__avatar-row">
                <div className="profile-form__avatar-preview" aria-hidden="true">
                  {profile?.avatarUrl ? (
                    <img src={profile.avatarUrl} alt="" />
                  ) : (
                    <span>{(displayName[0] ?? '?').toUpperCase()}</span>
                  )}
                </div>
                <div className="profile-form__avatar-actions">
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handleAvatarFile}
                    hidden
                  />
                  <Button
                    className="site-cta"
                    type="button"
                    variant="secondary"
                    onClick={() => avatarInputRef.current?.click()}
                    disabled={avatarUploading || profile?.avatarStatus === 'processing'}
                  >
                    {avatarUploading
                      ? 'Uploading…'
                      : profile?.avatarStatus === 'processing'
                        ? 'Processing…'
                        : profile?.avatarUrl
                          ? 'Replace avatar'
                          : 'Upload avatar'}
                  </Button>
                  <p className="profile-form__hint">JPEG, PNG, or WebP — up to 8 MB. We&apos;ll resize and optimize it automatically.</p>
                  {profile?.avatarStatus === 'failed' && profile.avatarProcessingError ? (
                    <FormFeedback tone="error">Avatar failed: {profile.avatarProcessingError}</FormFeedback>
                  ) : null}
                  {avatarError ? <FormFeedback tone="error">{avatarError}</FormFeedback> : null}
                  {avatarPollTimedOut && profile?.avatarStatus === 'processing' ? (
                    <FormFeedback tone="info">
                      Still processing your photo. This usually takes under a minute.{' '}
                      <button type="button" className="profile-link-button" onClick={() => void refreshAvatarManually()}>
                        Check again
                      </button>
                      {' '}or try uploading a different image.
                    </FormFeedback>
                  ) : null}
                </div>
              </div>

              <div className="profile-form__grid">
                <Input
                  label="First name"
                  value={form.firstName}
                  onChange={handleInputChange('firstName')}
                  maxLength={120}
                />
                <Input
                  label="Last name"
                  value={form.lastName}
                  onChange={handleInputChange('lastName')}
                  maxLength={120}
                />
                <Input
                  className="profile-form__field--wide"
                  label="Display name"
                  value={form.displayName}
                  onChange={handleInputChange('displayName')}
                  maxLength={120}
                  placeholder="How your name appears on the site"
                />
                <Input
                  label="City"
                  value={form.city}
                  onChange={handleInputChange('city')}
                  maxLength={120}
                />
                <Input
                  label="State / region"
                  value={form.region}
                  onChange={handleInputChange('region')}
                  maxLength={120}
                />
                <Input
                  label="Country"
                  value={form.country}
                  onChange={handleInputChange('country')}
                  maxLength={120}
                />
                <Input
                  label="Timezone"
                  value={form.timezone}
                  onChange={handleInputChange('timezone')}
                  maxLength={120}
                  placeholder={detectBrowserTimezone() || 'e.g. America/Chicago'}
                />
                <Input
                  className="profile-form__field--wide"
                  type="url"
                  label="Website"
                  value={form.websiteUrl}
                  onChange={handleInputChange('websiteUrl')}
                  maxLength={2000}
                  placeholder="https://…"
                />
                <Textarea
                  className="profile-form__field--wide"
                  label="Bio"
                  value={form.bio}
                  onChange={handleTextareaChange('bio')}
                  maxLength={2000}
                  rows={4}
                  placeholder="Tell other growers a little about yourself."
                />
              </div>

              {saveError ? <FormFeedback tone="error">{saveError}</FormFeedback> : null}
              {saveSuccess ? <FormFeedback tone="success">Profile saved.</FormFeedback> : null}

              <div className="profile-form__actions">
                <Button className="site-cta" type="submit" disabled={isSaving}>
                  {isSaving ? 'Saving…' : 'Save profile'}
                </Button>
              </div>
            </form>
          </Panel>
        )}
      </Section>

      <Section
        title="Your activity"
        intro="A running history of seed requests, okra submissions, and donations tied to your account."
      >
        {activityLoading ? (
          <p className="page-text">Loading your activity…</p>
        ) : combinedActivity.length === 0 ? (
          <p className="page-text">
            You don&apos;t have any activity yet. Start by{' '}
            <a
              href="/okra"
              onClick={(event) => {
                event.preventDefault();
                onNavigate('/okra');
              }}
            >
              visiting the Okra Project
            </a>{' '}
            or{' '}
            <a
              href="/donate"
              onClick={(event) => {
                event.preventDefault();
                onNavigate('/donate');
              }}
            >
              making a donation
            </a>
            .
          </p>
        ) : (
          <ul className="profile-activity">
            {combinedActivity.map((item) => (
              <li key={`${item.type}-${item.id}`} className={`profile-activity__item profile-activity__item--${item.type}`}>
                <div className="profile-activity__meta">
                  <span className="profile-activity__badge">{labelForActivity(item)}</span>
                  <time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time>
                </div>
                <div className="profile-activity__body">{renderActivityBody(item)}</div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Danger zone"
        intro="Permanently delete your account and all the personal information tied to it. This cannot be undone."
        className="profile-danger-zone"
      >
        <Panel tone="paper" className="profile-danger-zone__panel">
          <div className="profile-danger-zone__body">
            <h3 className="profile-danger-zone__heading">Delete your account</h3>
            <p className="profile-danger-zone__text">
              Deleting your account removes your profile details, avatar, saved preferences, and
              sign-in. Donation records are retained for tax and accounting purposes but we scrub
              your name and email from them. Seed requests and okra submissions you&apos;ve made will
              be unlinked from your account.
            </p>
            <p className="profile-danger-zone__text">
              This action takes effect immediately and cannot be reversed. If you change your mind
              later, you&apos;d need to create a new account.
            </p>
            <div className="profile-danger-zone__actions">
              <Button
                type="button"
                variant="danger"
                onClick={openDeleteDialog}
                className="profile-danger-zone__button"
              >
                Delete my account
              </Button>
            </div>
          </div>
        </Panel>
      </Section>

      {deleteDialogOpen ? (
        <div
          className="profile-delete-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="profile-delete-dialog-title"
          aria-describedby="profile-delete-dialog-description"
        >
          <div
            className="profile-delete-dialog__backdrop"
            onClick={closeDeleteDialog}
            aria-hidden="true"
          />
          <div className="profile-delete-dialog__panel" role="document">
            <h2 id="profile-delete-dialog-title" className="profile-delete-dialog__title">
              Delete your account?
            </h2>
            <p id="profile-delete-dialog-description" className="profile-delete-dialog__body">
              Are you sure? This will permanently delete your Olivia&apos;s Garden account, remove
              your profile, and sign you out. This cannot be undone.
            </p>
            <label className="profile-delete-dialog__label" htmlFor="profile-delete-confirm">
              Type <strong>{DELETE_CONFIRMATION_PHRASE}</strong> to confirm.
            </label>
            <input
              id="profile-delete-confirm"
              className="profile-delete-dialog__input"
              type="text"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              value={deleteConfirmation}
              onChange={(event) => {
                setDeleteError(null);
                setDeleteConfirmation(event.target.value);
              }}
              disabled={deleteSubmitting}
            />
            {deleteError ? (
              <FormFeedback tone="error">{deleteError}</FormFeedback>
            ) : null}
            <div className="profile-delete-dialog__actions">
              <Button
                type="button"
                variant="secondary"
                onClick={closeDeleteDialog}
                disabled={deleteSubmitting}
                className="profile-delete-dialog__cancel"
              >
                Keep my account
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={() => void submitAccountDeletion()}
                disabled={
                  deleteSubmitting
                  || deleteConfirmation.trim().toUpperCase() !== DELETE_CONFIRMATION_PHRASE
                }
                loading={deleteSubmitting}
                className="profile-delete-dialog__confirm"
              >
                {deleteSubmitting ? 'Deleting…' : 'Yes, delete my account'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function ProfileFormSkeleton() {
  return (
    <Panel tone="paper" className="profile-form-panel" aria-busy="true" aria-label="Loading your profile">
      <div className="profile-form profile-form--skeleton">
        <div className="profile-form__avatar-row">
          <div className="profile-skeleton profile-skeleton--avatar" />
          <div className="profile-skeleton__stack">
            <div className="profile-skeleton profile-skeleton--button" />
            <div className="profile-skeleton profile-skeleton--hint" />
          </div>
        </div>
        <div className="profile-form__grid">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="profile-skeleton__field">
              <div className="profile-skeleton profile-skeleton--label" />
              <div className="profile-skeleton profile-skeleton--input" />
            </div>
          ))}
          <div className="profile-skeleton__field profile-form__field--wide">
            <div className="profile-skeleton profile-skeleton--label" />
            <div className="profile-skeleton profile-skeleton--textarea" />
          </div>
        </div>
      </div>
    </Panel>
  );
}

function labelForActivity(item: ActivityItem): string {
  if (item.type === 'donation') {
    return item.donationMode === 'recurring' ? 'Garden Club' : 'Donation';
  }
  if (item.type === 'okra_submission') {
    return 'Okra submission';
  }
  return 'Seed request';
}

function renderActivityBody(item: ActivityItem) {
  if (item.type === 'donation') {
    return (
      <>
        <p className="profile-activity__title">
          {formatCurrency(item.amountCents, item.currency)}{' '}
          {item.donationMode === 'recurring' ? 'monthly Garden Club gift' : 'one-time gift'}
        </p>
        {item.dedicationName ? (
          <p className="page-text">Bee dedicated to {item.dedicationName}.</p>
        ) : null}
        {item.tShirtPreference ? (
          <p className="page-text">T-shirt: {item.tShirtPreference}.</p>
        ) : null}
      </>
    );
  }

  if (item.type === 'okra_submission') {
    return (
      <>
        <p className="profile-activity__title">
          Okra pin in {item.rawLocationText ?? item.country ?? 'your garden'} ({item.status.replace('_', ' ')})
        </p>
        {item.storyText ? <p className="page-text">{item.storyText}</p> : null}
        {item.photoUrls.length > 0 ? (
          <div className="profile-activity__photos">
            {item.photoUrls.slice(0, 4).map((url) => (
              <img key={url} src={url} alt="" />
            ))}
          </div>
        ) : null}
      </>
    );
  }

  return (
    <>
      <p className="profile-activity__title">
        Seed request {item.fulfillmentMethod === 'in_person' ? 'for an in-person visit' : 'by mail'}
      </p>
      {item.shippingCity ? (
        <p className="page-text">
          Shipping to {[item.shippingCity, item.shippingRegion, item.shippingCountry].filter(Boolean).join(', ')}.
        </p>
      ) : null}
      {item.message ? <p className="page-text">&ldquo;{item.message}&rdquo;</p> : null}
    </>
  );
}
