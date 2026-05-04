import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button, Card, FormFeedback } from '@olivias/ui';
import type { AuthSession } from '../../auth/session';
import { CtaButton, PageHero } from '../chrome';
import { siteUrl, webApiBase } from '../routes';
import { applyWorkshopSeo } from '../seo';
import {
  formatWorkshopPrice,
  type PublicWorkshop,
  type WorkshopStatus,
} from './WorkshopsPage';

const STATUS_LABEL: Record<WorkshopStatus, string> = {
  coming_soon: 'Coming soon',
  gauging_interest: 'Gauging interest',
  open: 'Registration open',
  closed: 'Waitlist only',
  past: 'Past workshop'
};

interface SignupResponse {
  already_signed_up: boolean;
  checkout_required: boolean;
  checkout_url: string | null;
  checkout_session_id: string | null;
  signup: {
    id: string;
    workshop_id: string;
    kind: 'interested' | 'registered' | 'waitlisted';
    payment_status: 'not_required' | 'pending' | 'paid' | 'refunded';
    created_at: string;
  };
}

function formatWorkshopDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function signupCtaLabel(workshop: PublicWorkshop): string {
  switch (workshop.status) {
    case 'gauging_interest':
      return "I'm interested";
    case 'open': {
      const price = formatWorkshopPrice(workshop);
      return price ? `Register & pay ${price}` : 'Register';
    }
    case 'closed':
      return 'Join the waitlist';
    default:
      return 'Sign up';
  }
}

function signupConfirmation(
  kind: 'interested' | 'registered' | 'waitlisted',
  paymentStatus: 'not_required' | 'pending' | 'paid' | 'refunded',
): string {
  if (paymentStatus === 'pending') {
    return "We're holding your spot. Finish payment to confirm — your seat is reserved for 30 minutes.";
  }
  switch (kind) {
    case 'interested':
      return "Thanks — we'll let you know when this workshop is officially scheduled.";
    case 'registered':
      return paymentStatus === 'paid'
        ? "You're registered and paid. We'll send details closer to the date."
        : "You're registered. We'll send details closer to the date.";
    case 'waitlisted':
      return "You're on the waitlist. We'll reach out if a spot opens up.";
  }
}

function isSignupAllowed(status: WorkshopStatus): boolean {
  return status === 'gauging_interest' || status === 'open' || status === 'closed';
}

// Build a same-origin absolute URL for the current detail page so the
// allowlist check on the server can validate it. We avoid window.location
// .href because that includes any ?payment= query we might already be
// rendering after a return from Stripe.
function buildReturnUrl(slug: string): string {
  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : siteUrl;
  return `${origin}/workshops/${encodeURIComponent(slug)}`;
}

export interface WorkshopDetailPageProps {
  onNavigate: (path: string) => void;
  authSession: AuthSession | null;
  authReady: boolean;
}

export function WorkshopDetailPage({ onNavigate, authSession, authReady }: WorkshopDetailPageProps) {
  const { slug } = useParams<{ slug: string }>();
  const [workshop, setWorkshop] = useState<PublicWorkshop | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [paymentBanner, setPaymentBanner] = useState<'success' | 'cancelled' | null>(null);
  const [reloadCounter, setReloadCounter] = useState(0);

  const accessToken = authSession?.accessToken ?? null;

  // On mount (and on returns from Stripe), notice the ?payment= query and
  // strip it from the URL so a refresh doesn't re-trigger the banner.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const paymentParam = params.get('payment');
    if (paymentParam !== 'success' && paymentParam !== 'cancelled') return;

    setPaymentBanner(paymentParam);
    params.delete('payment');
    params.delete('session_id');
    const next = params.toString();
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${next ? `?${next}` : ''}`,
    );
    if (paymentParam === 'success') {
      // The webhook may take a moment to flip the row from pending → paid.
      // Trigger a refetch loop to pick up the new state.
      setReloadCounter((n) => n + 1);
    }
  }, []);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    const headers: Record<string, string> = {};
    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }

    fetch(`${webApiBase}/workshops/${encodeURIComponent(slug)}`, { headers })
      .then(async (response) => {
        if (response.status === 404) {
          throw new Error('Workshop not found.');
        }
        if (!response.ok) {
          throw new Error(`Unable to load workshop (${response.status})`);
        }
        return response.json();
      })
      .then((body: PublicWorkshop) => {
        if (cancelled) return;
        setWorkshop(body);
        setLoadError(null);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setLoadError(err.message || 'Unable to load workshop.');
      });

    return () => {
      cancelled = true;
    };
  }, [slug, accessToken, reloadCounter]);

  useEffect(() => {
    if (!workshop || !slug) return;
    applyWorkshopSeo(workshop, `/workshops/${slug}`);
  }, [workshop, slug]);

  // After a Stripe success return, the webhook is asynchronous. If we land
  // here with my_signup still in 'pending', poll for a few seconds so the
  // banner doesn't say "success" while the UI says "finish payment."
  useEffect(() => {
    if (paymentBanner !== 'success') return;
    if (!workshop || workshop.my_signup?.payment_status !== 'pending') return;

    const interval = window.setInterval(() => {
      setReloadCounter((n) => n + 1);
    }, 2000);
    const timeout = window.setTimeout(() => {
      window.clearInterval(interval);
    }, 20_000);

    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [paymentBanner, workshop]);

  // Live countdown for the "Finish payment in N minutes" copy. Without
  // this, minutesRemaining is computed once on mount and the displayed
  // count is stale after the user has been on the page for a while.
  // When the held seat actually expires, trigger a refetch so the UI
  // flips from "Finish payment" → "Your held spot expired" without
  // requiring a manual refresh.
  const pendingExpiresAtForTimer = workshop?.my_signup?.payment_status === 'pending'
    ? workshop?.my_signup?.expires_at ?? null
    : null;
  const [, setCountdownTick] = useState(0);
  useEffect(() => {
    if (!pendingExpiresAtForTimer) return;
    const expiresAtMs = new Date(pendingExpiresAtForTimer).getTime();
    if (!Number.isFinite(expiresAtMs)) return;

    const interval = window.setInterval(() => {
      const now = Date.now();
      if (now >= expiresAtMs) {
        window.clearInterval(interval);
        // The pending row's expires_at has passed. Refetch so the server
        // can null-out checkout_url and we render the "expired" branch.
        setReloadCounter((n) => n + 1);
        return;
      }
      // Force a re-render so the displayed countdown ticks down.
      setCountdownTick((n) => n + 1);
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [pendingExpiresAtForTimer]);

  const handleSignup = async () => {
    if (!workshop) return;
    if (!authSession) {
      onNavigate(`/login?redirect=${encodeURIComponent(`/workshops/${workshop.slug}`)}`);
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const body = workshop.is_paid
        ? JSON.stringify({ returnUrl: buildReturnUrl(workshop.slug) })
        : undefined;
      const response = await fetch(`${webApiBase}/workshops/${workshop.id}/signup`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authSession.accessToken}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body,
      });
      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        throw new Error(errorBody?.error ?? `Unable to sign up (${response.status})`);
      }
      const result = (await response.json()) as SignupResponse;

      // Paid path: the server returns a Stripe Checkout URL. Hand off the
      // page rather than rendering — Stripe owns the payment UI.
      if (result.checkout_required && result.checkout_url) {
        window.location.assign(result.checkout_url);
        return;
      }

      // Free path: row was inserted; reflect locally.
      setWorkshop({
        ...workshop,
        my_signup: {
          kind: result.signup.kind,
          payment_status: result.signup.payment_status,
          created_at: result.signup.created_at,
        },
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to sign up.');
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    if (!workshop || !authSession) return;
    setBusy(true);
    setActionError(null);
    try {
      const response = await fetch(`${webApiBase}/workshops/${workshop.id}/signup`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authSession.accessToken}` }
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? `Unable to cancel signup (${response.status})`);
      }
      setWorkshop({ ...workshop, my_signup: null });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to cancel signup.');
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <>
        <PageHero
          eyebrow="Workshops"
          title="Workshop"
          body="Something went wrong loading this workshop."
        />
        <div className="page-section">
          <Card title="Unable to load this workshop.">
            <FormFeedback tone="error">{loadError}</FormFeedback>
            <CtaButton
              href="/workshops"
              onClick={(event) => {
                event?.preventDefault?.();
                onNavigate('/workshops');
              }}
            >
              Back to all workshops
            </CtaButton>
          </Card>
        </div>
      </>
    );
  }

  if (!workshop) {
    return (
      <>
        <PageHero eyebrow="Workshops" title="Workshop" body="Loading workshop details…" />
      </>
    );
  }

  const formattedDate = formatWorkshopDate(workshop.workshop_date);
  const formattedPrice = formatWorkshopPrice(workshop);
  const status = workshop.status;
  const canSignUp = isSignupAllowed(status);
  const hasSignup = workshop.my_signup !== null;
  const isPendingPayment = workshop.my_signup?.payment_status === 'pending';
  // Resume hint: server returns checkout_url=null on a pending row whose
  // expires_at has passed. So `pending && !checkout_url` ≡ "the held seat
  // expired". `pending && checkout_url` ≡ "you can still finish payment."
  const resumeUrl = isPendingPayment ? workshop.my_signup?.checkout_url ?? null : null;
  const isPendingExpired = isPendingPayment && !resumeUrl;
  // Optional countdown for the pending+resumable case.
  const pendingExpiresAt = workshop.my_signup?.expires_at ?? null;
  const minutesRemaining = (() => {
    if (!isPendingPayment || !resumeUrl || !pendingExpiresAt) return null;
    const ms = new Date(pendingExpiresAt).getTime() - Date.now();
    if (!Number.isFinite(ms) || ms <= 0) return null;
    return Math.max(1, Math.ceil(ms / 60_000));
  })();

  return (
    <>
      <PageHero
        eyebrow={STATUS_LABEL[status]}
        title={workshop.title}
        body={workshop.short_description ?? 'Hands-on workshop at Olivia\'s Garden Foundation.'}
      />

      <div className="page-section workshop-detail">
        {paymentBanner === 'success' ? (
          <FormFeedback tone="success">
            Payment received. Hang tight while we confirm your registration…
          </FormFeedback>
        ) : null}
        {paymentBanner === 'cancelled' ? (
          <FormFeedback tone="info">
            Checkout was cancelled. You can try again below.
          </FormFeedback>
        ) : null}

        {workshop.image_url ? (
          <img className="workshop-detail__image" src={workshop.image_url} alt="" />
        ) : null}

        <Card title="Details" className="workshop-detail__meta">
          {formattedDate ? <p><strong>When:</strong> {formattedDate}</p> : null}
          {workshop.location ? <p><strong>Where:</strong> {workshop.location}</p> : null}
          {formattedPrice ? <p><strong>Price:</strong> {formattedPrice}</p> : null}
          {workshop.capacity !== null ? (
            <p>
              <strong>Capacity:</strong>{' '}
              {workshop.seats_remaining !== null
                ? `${workshop.seats_remaining} of ${workshop.capacity} spots remaining`
                : `${workshop.capacity} spots`}
            </p>
          ) : null}
          {status === 'gauging_interest' && workshop.interested_count > 0 ? (
            <p>
              <strong>Interest:</strong> {workshop.interested_count} {workshop.interested_count === 1 ? 'person has' : 'people have'} expressed interest
            </p>
          ) : null}
        </Card>

        {workshop.description ? (
          <Card title="About this workshop">
            <div className="workshop-detail__description">
              {workshop.description.split(/\n{2,}/).map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </div>
          </Card>
        ) : null}

        <Card title="Signup" className="workshop-detail__signup">
          {!authReady ? (
            <p>Checking your session…</p>
          ) : status === 'coming_soon' ? (
            <p>This workshop hasn&apos;t opened for signups yet. Check back soon.</p>
          ) : status === 'past' ? (
            <p>This workshop has already taken place.</p>
          ) : hasSignup && isPendingPayment && resumeUrl ? (
            <>
              <FormFeedback tone="info">
                {minutesRemaining
                  ? `We're holding your spot for about ${minutesRemaining} more ${minutesRemaining === 1 ? 'minute' : 'minutes'}. Finish payment to confirm.`
                  : "We're holding your spot. Finish payment to confirm."}
              </FormFeedback>
              <a
                className="og-button og-button--primary og-button--md site-cta"
                href={resumeUrl}
              >
                Finish payment
              </a>
              <Button variant="secondary" onClick={handleCancel} disabled={busy}>
                {busy ? 'Working…' : 'Cancel reservation'}
              </Button>
              {actionError ? <FormFeedback tone="error">{actionError}</FormFeedback> : null}
            </>
          ) : hasSignup && isPendingExpired ? (
            <>
              <FormFeedback tone="info">
                Your held spot expired. Register again to start a new checkout.
              </FormFeedback>
              <Button onClick={handleSignup} disabled={busy}>
                {busy ? 'Working…' : signupCtaLabel(workshop)}
              </Button>
              {actionError ? <FormFeedback tone="error">{actionError}</FormFeedback> : null}
            </>
          ) : hasSignup ? (
            <>
              <FormFeedback tone="success">
                {signupConfirmation(workshop.my_signup!.kind, workshop.my_signup!.payment_status)}
              </FormFeedback>
              <Button variant="secondary" onClick={handleCancel} disabled={busy}>
                {busy ? 'Working…' : 'Cancel my signup'}
              </Button>
              {actionError ? <FormFeedback tone="error">{actionError}</FormFeedback> : null}
            </>
          ) : !authSession ? (
            <>
              <p>Sign in to {signupCtaLabel(workshop).toLowerCase()} for this workshop.</p>
              <Button onClick={handleSignup} disabled={busy}>
                Sign in to {signupCtaLabel(workshop).toLowerCase()}
              </Button>
            </>
          ) : canSignUp ? (
            <>
              <Button onClick={handleSignup} disabled={busy}>
                {busy ? 'Working…' : signupCtaLabel(workshop)}
              </Button>
              {actionError ? <FormFeedback tone="error">{actionError}</FormFeedback> : null}
            </>
          ) : (
            <p>Signups are not currently open for this workshop.</p>
          )}
        </Card>

        <CtaButton
          variant="secondary"
          href="/workshops"
          onClick={(event) => {
            event?.preventDefault?.();
            onNavigate('/workshops');
          }}
        >
          Back to all workshops
        </CtaButton>
      </div>
    </>
  );
}
