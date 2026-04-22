import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Button } from '@olivias/ui';
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

function toEditable(profile: ProfileResponse | null): EditableProfile {
  return {
    firstName: profile?.firstName ?? '',
    lastName: profile?.lastName ?? '',
    displayName: profile?.displayName ?? '',
    bio: profile?.bio ?? '',
    city: profile?.city ?? '',
    region: profile?.region ?? '',
    country: profile?.country ?? '',
    timezone: profile?.timezone ?? '',
    websiteUrl: profile?.websiteUrl ?? '',
  };
}

export function ProfilePage({
  authSession,
  authReady,
  onNavigate,
}: {
  authSession: AuthSession | null;
  authReady: boolean;
  onNavigate: (path: string) => void;
}) {
  useEffect(() => {
    if (authReady && !authSession) {
      onNavigate('/login');
    }
  }, [authReady, authSession, onNavigate]);

  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [form, setForm] = useState<EditableProfile>(toEditable(null));
  const [isLoading, setIsLoading] = useState(true);
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
        setForm(toEditable(data));
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

  const handleChange = useCallback(
    (field: keyof EditableProfile) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
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
      setForm(toEditable(saved));
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
    setAvatarUploading(true);

    try {
      const intent = await requestAvatarUploadIntent(authSession, file.type);
      await putAvatarToS3(intent, file);
      await completeAvatarUpload(authSession);
      const refreshed = await fetchProfile(authSession);
      setProfile(refreshed);
    } catch (error) {
      setAvatarError(error instanceof Error ? error.message : 'Unable to upload avatar.');
    } finally {
      setAvatarUploading(false);
    }
  };

  // Poll profile while the avatar is processing so the UI picks up the final URL.
  useEffect(() => {
    if (!authSession || profile?.avatarStatus !== 'processing') return;

    let cancelled = false;
    const interval = window.setInterval(async () => {
      try {
        const fresh = await fetchProfile(authSession);
        if (cancelled) return;
        setProfile(fresh);
        if (fresh.avatarStatus !== 'processing') {
          window.clearInterval(interval);
        }
      } catch {
        // Keep polling; transient failures are fine.
      }
    }, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [authSession, profile?.avatarStatus]);

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
          <p className="page-text">Loading your profile…</p>
        ) : loadError ? (
          <p className="profile-error" role="alert">{loadError}</p>
        ) : (
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
                  <p className="profile-error" role="alert">Avatar failed: {profile.avatarProcessingError}</p>
                ) : null}
                {avatarError ? <p className="profile-error" role="alert">{avatarError}</p> : null}
              </div>
            </div>

            <div className="profile-form__grid">
              <label className="profile-form__field">
                <span>First name</span>
                <input type="text" value={form.firstName} onChange={handleChange('firstName')} maxLength={120} />
              </label>
              <label className="profile-form__field">
                <span>Last name</span>
                <input type="text" value={form.lastName} onChange={handleChange('lastName')} maxLength={120} />
              </label>
              <label className="profile-form__field profile-form__field--wide">
                <span>Display name</span>
                <input
                  type="text"
                  value={form.displayName}
                  onChange={handleChange('displayName')}
                  maxLength={120}
                  placeholder="How your name appears on the site"
                />
              </label>
              <label className="profile-form__field">
                <span>City</span>
                <input type="text" value={form.city} onChange={handleChange('city')} maxLength={120} />
              </label>
              <label className="profile-form__field">
                <span>State / region</span>
                <input type="text" value={form.region} onChange={handleChange('region')} maxLength={120} />
              </label>
              <label className="profile-form__field">
                <span>Country</span>
                <input type="text" value={form.country} onChange={handleChange('country')} maxLength={120} />
              </label>
              <label className="profile-form__field">
                <span>Timezone</span>
                <input
                  type="text"
                  value={form.timezone}
                  onChange={handleChange('timezone')}
                  maxLength={120}
                  placeholder={detectBrowserTimezone() || 'e.g. America/Chicago'}
                />
              </label>
              <label className="profile-form__field profile-form__field--wide">
                <span>Website</span>
                <input
                  type="url"
                  value={form.websiteUrl}
                  onChange={handleChange('websiteUrl')}
                  maxLength={2000}
                  placeholder="https://…"
                />
              </label>
              <label className="profile-form__field profile-form__field--wide">
                <span>Bio</span>
                <textarea
                  value={form.bio}
                  onChange={handleChange('bio')}
                  maxLength={2000}
                  rows={4}
                  placeholder="Tell other growers a little about yourself."
                />
              </label>
            </div>

            {saveError ? <p className="profile-error" role="alert">{saveError}</p> : null}
            {saveSuccess ? <p className="profile-success">Profile saved.</p> : null}

            <div className="profile-form__actions">
              <Button className="site-cta" type="submit" disabled={isSaving}>
                {isSaving ? 'Saving…' : 'Save profile'}
              </Button>
            </div>
          </form>
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
    </>
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
