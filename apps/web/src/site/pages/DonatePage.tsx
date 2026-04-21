import { useEffect, useRef, useState } from 'react';
import { loadStripe, type StripeEmbeddedCheckout } from '@stripe/stripe-js';
import { Button } from '@olivias/ui';
import type { AuthSession } from '../../auth/session';
import { CtaButton, PageHero } from '../chrome';
import { stripePublishableKey, webApiBase } from '../routes';

type DonationMode = 'one_time' | 'recurring';

type DonationCheckoutRequest = {
  mode: DonationMode;
  amountCents: number;
  returnUrl: string;
  donorName?: string;
  donorEmail?: string;
  dedicationName?: string;
  tShirtPreference?: string;
};

type DonationCheckoutResponse = {
  clientSecret: string;
  checkoutSessionId: string;
};

type DonationCheckoutSessionStatus = {
  sessionId: string;
  status: string;
  paymentStatus: string | null;
  customerEmail: string | null;
};

const stripePromise = stripePublishableKey ? loadStripe(stripePublishableKey) : null;

function createCorrelationId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `ogf-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function webApiUrl(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${webApiBase}${normalizedPath}`;
}

async function createDonationCheckoutSession(
  payload: DonationCheckoutRequest,
  authSession: AuthSession | null,
): Promise<DonationCheckoutResponse> {
  const headers = new Headers({
    'Content-Type': 'application/json',
    'X-Correlation-Id': createCorrelationId(),
  });

  if (authSession?.accessToken) {
    headers.set('Authorization', `Bearer ${authSession.accessToken}`);
  }

  try {
    const response = await fetch(webApiUrl('/donations/checkout-session'), {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      let message = 'Unable to start donation checkout right now.';

      try {
        const body = await response.json() as { error?: string };
        if (typeof body.error === 'string' && body.error.trim()) {
          message = body.error;
        }
      } catch {
        // Keep the generic fallback message.
      }

      throw new Error(message);
    }

    return await response.json() as DonationCheckoutResponse;
  } catch (error) {
    if (error instanceof Error && error.message.trim() && error.message !== 'Failed to fetch') {
      throw error;
    }

    throw new Error('Unable to reach secure checkout right now. Please try again in a moment.');
  }
}

async function getDonationCheckoutSessionStatus(sessionId: string): Promise<DonationCheckoutSessionStatus> {
  try {
    const response = await fetch(`${webApiUrl('/donations/checkout-session-status')}?session_id=${encodeURIComponent(sessionId)}`, {
      method: 'GET',
      headers: {
        'X-Correlation-Id': createCorrelationId(),
      },
    });

    if (!response.ok) {
      let message = 'Unable to confirm donation status right now.';

      try {
        const body = await response.json() as { error?: string };
        if (typeof body.error === 'string' && body.error.trim()) {
          message = body.error;
        }
      } catch {
        // Keep the generic fallback message.
      }

      throw new Error(message);
    }

    return await response.json() as DonationCheckoutSessionStatus;
  } catch (error) {
    if (error instanceof Error && error.message.trim() && error.message !== 'Failed to fetch') {
      throw error;
    }

    throw new Error('We could not confirm your donation status right now. Please refresh or try again shortly.');
  }
}

export function DonatePage({
  onNavigate,
  authSession,
}: {
  onNavigate: (path: string) => void;
  authSession: AuthSession | null;
}) {
  const initialReturnedSessionId = typeof window === 'undefined'
    ? null
    : new URLSearchParams(window.location.search).get('session_id');
  const [selectedMode, setSelectedMode] = useState<DonationMode>('one_time');
  const [selectedAmount, setSelectedAmount] = useState(2500);
  const [customAmount, setCustomAmount] = useState('');
  const [donorName, setDonorName] = useState(authSession?.user.name ?? '');
  const [donorEmail, setDonorEmail] = useState(authSession?.user.email ?? '');
  const [dedicationName, setDedicationName] = useState('');
  const [tShirtPreference, setTShirtPreference] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCheckingStatus, setIsCheckingStatus] = useState(Boolean(initialReturnedSessionId));
  const [error, setError] = useState<string | null>(null);
  const [checkoutClientSecret, setCheckoutClientSecret] = useState<string | null>(null);
  const [returnedSessionId, setReturnedSessionId] = useState(initialReturnedSessionId);
  const [checkoutStatus, setCheckoutStatus] = useState<DonationCheckoutSessionStatus | null>(null);
  const checkoutContainerRef = useRef<HTMLDivElement | null>(null);
  const embeddedCheckoutRef = useRef<StripeEmbeddedCheckout | null>(null);

  useEffect(() => {
    if (authSession?.user.name) {
      setDonorName((current) => current || authSession.user.name || '');
    }
    if (authSession?.user.email) {
      setDonorEmail((current) => current || authSession.user.email || '');
    }
  }, [authSession?.user.email, authSession?.user.name]);

  const effectiveAmount = customAmount.trim()
    ? Math.round(Number(customAmount) * 100)
    : selectedAmount;
  const trimmedDonorName = donorName.trim();
  const trimmedDonorEmail = donorEmail.trim();
  const trimmedDedicationName = dedicationName.trim();
  const trimmedTShirtPreference = tShirtPreference.trim();
  const hasValidAmount = Number.isFinite(effectiveAmount) && effectiveAmount >= 500;
  const hasValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedDonorEmail);
  const hasRequiredDonationFields = Boolean(
    trimmedDonorName
      && hasValidEmail
      && trimmedDedicationName
      && (selectedMode === 'one_time' || trimmedTShirtPreference),
  );

  useEffect(() => {
    if (!returnedSessionId) {
      setCheckoutStatus(null);
      setIsCheckingStatus(false);
      return;
    }

    let active = true;
    setIsCheckingStatus(true);
    setError(null);

    void getDonationCheckoutSessionStatus(returnedSessionId)
      .then((status) => {
        if (!active) {
          return;
        }

        setCheckoutStatus(status);
      })
      .catch((statusError) => {
        if (!active) {
          return;
        }

        setError(statusError instanceof Error ? statusError.message : 'Unable to confirm donation status.');
      })
      .finally(() => {
        if (active) {
          setIsCheckingStatus(false);
        }
      });

    return () => {
      active = false;
    };
  }, [returnedSessionId]);

  useEffect(() => {
    if (!checkoutClientSecret || !checkoutContainerRef.current) {
      return;
    }

    if (!stripePromise) {
      setError('Secure checkout is not configured for this environment yet.');
      setCheckoutClientSecret(null);
      setIsSubmitting(false);
      return;
    }

    let active = true;
    let mountedCheckout: StripeEmbeddedCheckout | null = null;

    void stripePromise
      .then(async (stripe) => {
        if (!stripe) {
          throw new Error('Secure checkout is unavailable right now.');
        }

        const checkoutContainer = checkoutContainerRef.current;
        if (!checkoutContainer) {
          throw new Error('Secure checkout is unavailable right now.');
        }

        mountedCheckout = await stripe.initEmbeddedCheckout({
          fetchClientSecret: async () => checkoutClientSecret,
        });

        if (!active) {
          mountedCheckout.destroy();
          return;
        }

        embeddedCheckoutRef.current = mountedCheckout;
        mountedCheckout.mount(checkoutContainer);
        setIsSubmitting(false);
      })
      .catch((checkoutError) => {
        if (!active) {
          return;
        }

        setError(checkoutError instanceof Error ? checkoutError.message : 'Unable to open secure checkout.');
        setCheckoutClientSecret(null);
        setIsSubmitting(false);
      });

    return () => {
      active = false;
      if (embeddedCheckoutRef.current) {
        embeddedCheckoutRef.current.destroy();
        embeddedCheckoutRef.current = null;
      } else if (mountedCheckout) {
        mountedCheckout.destroy();
      }
    };
  }, [checkoutClientSecret]);

  const resetCheckoutExperience = () => {
    embeddedCheckoutRef.current?.destroy();
    embeddedCheckoutRef.current = null;
    setCheckoutClientSecret(null);
    setCheckoutStatus(null);
    setReturnedSessionId(null);
    setIsCheckingStatus(false);
    setIsSubmitting(false);
    setError(null);

    if (typeof window !== 'undefined') {
      window.history.replaceState({}, '', window.location.pathname);
    }
  };

  const startCheckout = async (mode: DonationMode) => {
    setError(null);

    if (!hasValidAmount) {
      setError('Please choose or enter a donation of at least $5.');
      return;
    }
    if (!trimmedDonorName) {
      setError('Please enter the donor name before continuing.');
      return;
    }
    if (!hasValidEmail) {
      setError('Please enter a valid email address before continuing.');
      return;
    }
    if (!trimmedDedicationName) {
      setError('Please choose who the bee should be named after before continuing.');
      return;
    }
    if (mode === 'recurring' && !trimmedTShirtPreference) {
      setError('Please add a t-shirt preference before starting Garden Club checkout.');
      return;
    }

    setIsSubmitting(true);

    try {
      const { clientSecret } = await createDonationCheckoutSession(
        {
          mode,
          amountCents: effectiveAmount,
          returnUrl: `${window.location.origin}/donate?session_id={CHECKOUT_SESSION_ID}`,
          donorName: trimmedDonorName || undefined,
          donorEmail: trimmedDonorEmail || undefined,
          dedicationName: trimmedDedicationName || undefined,
          tShirtPreference: mode === 'recurring' ? (trimmedTShirtPreference || undefined) : undefined,
        },
        authSession,
      );

      if (typeof window !== 'undefined') {
        window.history.replaceState({}, '', window.location.pathname);
      }

      setReturnedSessionId(null);
      setCheckoutStatus(null);
      setCheckoutClientSecret(clientSecret);
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : 'Unable to start checkout.');
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <PageHero
        eyebrow="Donate"
        title="Plant something permanent in Olivia's Garden."
        body="Every gift becomes something visible in the memorial garden itself. Each donor's name is placed on a permanent acrylic marker."
        className="donate-hero"
        titleClassName="donate-hero__title"
        backgroundImage="/images/home/sunset-garden.jpg"
        aside={(
          <div className="donate-hero__aside-card">
            <p className="donate-hero__eyebrow">This year&apos;s garden marker</p>
            <div className="donate-hero__bee">
              <span className="donate-hero__bee-body" aria-hidden="true" />
            </div>
            <p className="donate-hero__aside-title">A named bee joins the garden for every donor.</p>
            <p className="page-text">
              A named acrylic bee is placed in the memorial garden for every donor. Garden Club members also
              receive a free t-shirt when they begin their recurring support.
            </p>
          </div>
        )}
      />

      <section className="donate-story-band">
        <div className="donate-story-band__copy">
          <h2>A donation should feel like belonging, not just a transaction.</h2>
          <div className="donate-story-band__body">
            <p className="page-text">
              Support goes into seeds, animal care, tools, educational materials, and the practical
              work of keeping the foundation active for families who want to learn how to grow,
              tend, and share food.
            </p>
            <p className="page-text">
              We tell that story in the memorial garden itself. Every donor has a permanent acrylic
              marker placed there in their honor, regardless of donation size. The animal changes each
              year so the installation keeps growing while still marking a moment in the life of
              the garden.
            </p>
          </div>
        </div>

        <figure className="donate-story-band__photo">
          <img
            src="/images/about/monarchs.jpg"
            alt="Butterflies and garden plants on the foundation grounds."
          />
          <figcaption>
            The marker changes each year, but the idea stays the same: your gift becomes part of
            the living story of the garden.
          </figcaption>
        </figure>
      </section>

      <section className="donate-checkout" id="donate-options">
        {isCheckingStatus ? (
          <div className="donate-status-card donate-status-card--neutral">
            <p className="donate-status-card__eyebrow">Checking donation</p>
            <h3>We&apos;re confirming your checkout session.</h3>
            <p>Give us a moment to read the latest payment status.</p>
          </div>
        ) : null}

        {checkoutStatus?.status === 'complete' ? (
          <div className="donate-status-card donate-status-card--success">
            <p className="donate-status-card__eyebrow">Donation complete</p>
            <h3>Your gift is in.</h3>
            <p>
              Your donation was marked complete, and we&apos;ll use the details from checkout
              to add the donor&apos;s permanent bee to the garden.
            </p>
            {checkoutStatus.customerEmail ? (
              <p>A receipt should be on its way to {checkoutStatus.customerEmail}.</p>
            ) : null}
            <div className="donate-status-card__actions">
              <Button className="site-cta" variant="secondary" onClick={resetCheckoutExperience}>Make another gift</Button>
              <Button className="site-cta" variant="secondary" onClick={() => onNavigate('/impact')}>
                See the impact
              </Button>
            </div>
          </div>
        ) : null}

        {checkoutStatus && checkoutStatus.status !== 'complete' ? (
          <div className="donate-status-card donate-status-card--warning">
            <p className="donate-status-card__eyebrow">Checkout still open</p>
            <h3>Your checkout was not completed yet.</h3>
            <p>
              You can review your donation details below and start a fresh secure checkout when
              you&apos;re ready.
            </p>
            <div className="donate-status-card__actions">
              <Button className="site-cta" variant="secondary" onClick={resetCheckoutExperience}>Start a new checkout</Button>
            </div>
          </div>
        ) : null}

        {checkoutStatus?.status === 'complete' ? null : (
          <div className="donate-form-card">
            {checkoutClientSecret ? (
              <div className="donate-embedded-checkout">
                <div className="donate-embedded-checkout__header">
                  <div>
                    <p className="donate-embedded-checkout__eyebrow">Secure payment</p>
                    <h3>Secure checkout is ready below.</h3>
                    <p>Complete the payment here without leaving the donate page.</p>
                  </div>
                  <Button className="site-cta" variant="secondary" onClick={resetCheckoutExperience}>
                    Go back
                  </Button>
                </div>
                <div className="donate-embedded-checkout__mount" ref={checkoutContainerRef} />
              </div>
            ) : (
              <>
                <div className="donate-mode-toggle" role="group" aria-label="Donation frequency">
                  <button
                    type="button"
                    className={`donate-mode-toggle__button ${selectedMode === 'one_time' ? 'donate-mode-toggle__button--active' : ''}`.trim()}
                    onClick={() => setSelectedMode('one_time')}
                  >
                    One-time gift
                  </button>
                  <button
                    type="button"
                    className={`donate-mode-toggle__button ${selectedMode === 'recurring' ? 'donate-mode-toggle__button--active' : ''}`.trim()}
                    onClick={() => setSelectedMode('recurring')}
                  >
                    Monthly Garden Club
                  </button>
                </div>

                <div className="donate-amounts" role="group" aria-label="Donation amount">
                  {[1500, 2500, 5000, 10000].map((amount) => (
                    <button
                      key={amount}
                      type="button"
                      className={`donate-amounts__chip ${!customAmount && selectedAmount === amount ? 'donate-amounts__chip--active' : ''}`.trim()}
                      onClick={() => {
                        setSelectedAmount(amount);
                        setCustomAmount('');
                      }}
                    >
                      ${amount / 100}
                    </button>
                  ))}
                  <label className="donate-amounts__custom">
                    <span>Custom</span>
                    <input
                      type="number"
                      min="5"
                      step="1"
                      inputMode="numeric"
                      placeholder="Other amount"
                      value={customAmount}
                      onChange={(event) => setCustomAmount(event.target.value)}
                    />
                  </label>
                </div>

                <div className="donate-form-grid">
                  <p className="donate-form-grid__required-note">Fields marked * are required to make a donation.</p>
                  <label>
                    <span>Name <span className="donate-form-grid__required-mark" aria-hidden="true">*</span></span>
                    <input type="text" value={donorName} onChange={(event) => setDonorName(event.target.value)} placeholder="Your name" required />
                  </label>
                  <label>
                    <span>Email <span className="donate-form-grid__required-mark" aria-hidden="true">*</span></span>
                    <input type="email" value={donorEmail} onChange={(event) => setDonorEmail(event.target.value)} placeholder="you@example.com" required />
                  </label>
                  <label className="donate-form-grid__dedication">
                    <span className="donate-form-grid__dedication-label">
                      Who should we name your bee after? <span className="donate-form-grid__required-mark" aria-hidden="true">*</span>
                    </span>
                    <small className="donate-form-grid__dedication-note">Use your name, your family name, or honor someone you love.</small>
                    <input
                      type="text"
                      value={dedicationName}
                      onChange={(event) => setDedicationName(event.target.value)}
                      placeholder="Your name, family name, or in honor of someone"
                      required
                    />
                  </label>
                  {selectedMode === 'recurring' ? (
                    <label>
                      <span>T-shirt choice <span className="donate-form-grid__required-mark" aria-hidden="true">*</span></span>
                      <input
                        type="text"
                        value={tShirtPreference}
                        onChange={(event) => setTShirtPreference(event.target.value)}
                        placeholder="Size, color, or style preference"
                        required
                      />
                    </label>
                  ) : null}
                </div>

                <div className="donate-form-card__footer">
                  <div className="donate-form-card__summary-block">
                    <p className="donate-form-card__summary-eyebrow">Gift summary</p>
                    <p className="donate-form-card__summary">
                      {selectedMode === 'recurring' ? 'Garden Club' : 'One-time donation'}: ${(effectiveAmount / 100).toFixed(2)}
                    </p>
                    <p className="page-text">
                      {selectedMode === 'recurring'
                        ? 'Begins monthly support and includes your free t-shirt at signup.'
                        : 'Includes a permanent bee placed in the memorial garden in your honor, no matter the amount.'}
                    </p>
                  </div>
                  <div className="donate-form-card__cta-group">
                    <Button
                      className="site-cta donate-form-card__cta"
                      onClick={() => void startCheckout(selectedMode)}
                      disabled={isSubmitting || !hasValidAmount || !hasRequiredDonationFields}
                    >
                      {isSubmitting ? 'Opening secure checkout...' : selectedMode === 'recurring' ? 'Become a monthly member' : 'Make donation'}
                    </Button>
                    <p className="donate-form-card__checkout-note">
                      Secure checkout. No account required.
                    </p>
                  </div>
                </div>

                {error ? <p className="donate-form-card__error" role="alert">{error}</p> : null}
              </>
            )}
          </div>
        )}

        <aside className="donate-alternate">
          <p className="donate-alternate__eyebrow">Other ways to help</p>
          <h3>Support can also look like time, supplies, seeds, or a larger sponsorship conversation.</h3>
          <p>
            If donating today is not the right fit, we can still point you toward the best next
            step.
          </p>
          <div className="donate-alternate__actions">
            <CtaButton onClick={() => onNavigate('/get-involved')} variant="secondary">Get involved</CtaButton>
            <CtaButton onClick={() => onNavigate('/contact')} variant="secondary">Contact us directly</CtaButton>
          </div>
        </aside>
      </section>
    </>
  );
}
