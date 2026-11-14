import { useRef, useState, type FormEvent } from 'react';
import { Button, FormFeedback, Input } from '@olivias/ui';
import { webApiBase } from '../routes';
import './NewsletterSignup.css';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type NewsletterSignupProps = {
  /** Where the signup originated, e.g. "home" or "donate". Sent for our own logging. */
  source: string;
  heading?: string;
  description?: string;
  buttonLabel?: string;
  className?: string;
  variant?: 'panel' | 'inline';
};

function createCorrelationId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `ogf-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function NewsletterSignup({
  source,
  heading = 'Get a note when there’s something to share.',
  description = 'Seed drops, news from the garden, and the occasional update on what we are building. No spam, unsubscribe anytime.',
  buttonLabel = 'Keep me posted',
  className,
  variant = 'panel',
}: NewsletterSignupProps) {
  const [email, setEmail] = useState('');
  // Honeypot field — hidden from real visitors. Bots that fill it are dropped.
  const [website, setWebsite] = useState('');
  const mountedAt = useRef(Date.now());
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success'>('idle');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    const trimmedEmail = email.trim();
    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      setError('Please enter a valid email address.');
      return;
    }

    setStatus('submitting');

    try {
      const response = await fetch(`${webApiBase}/newsletter`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Correlation-Id': createCorrelationId(),
        },
        body: JSON.stringify({
          email: trimmedEmail,
          source,
          website: website || undefined,
          elapsedMs: Date.now() - mountedAt.current,
        }),
      });

      if (!response.ok) {
        let message = 'We could not add you to the list right now. Please try again in a moment.';
        if (response.status >= 400 && response.status < 500) {
          try {
            const body = await response.json() as { message?: string };
            if (typeof body.message === 'string' && body.message.trim()) {
              message = body.message;
            }
          } catch {
            // Keep the generic fallback message.
          }
        }
        throw new Error(message);
      }

      setStatus('success');
      setEmail('');
    } catch (submitError) {
      setStatus('idle');
      setError(submitError instanceof Error ? submitError.message : 'Something went wrong. Please try again.');
    }
  };

  const rootClassName = ['newsletter-signup', `newsletter-signup--${variant}`, className]
    .filter(Boolean)
    .join(' ');

  if (status === 'success') {
    return (
      <section className={rootClassName} aria-live="polite">
        <div className="newsletter-signup__body">
          <h3 className="newsletter-signup__heading">You’re on the list.</h3>
          <p className="newsletter-signup__description">
            Thanks for signing up. We’ll be in touch when there’s something worth sharing.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className={rootClassName}>
      <form className="newsletter-signup__form" onSubmit={handleSubmit} noValidate>
        <div className="newsletter-signup__body">
          <h3 className="newsletter-signup__heading">{heading}</h3>
          <p className="newsletter-signup__description">{description}</p>
        </div>

        <div className="newsletter-signup__controls">
          <label className="newsletter-signup__field">
            <span className="newsletter-signup__label">Email address</span>
            <Input
              type="email"
              name="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(changeEvent) => setEmail(changeEvent.target.value)}
              disabled={status === 'submitting'}
              required
            />
          </label>

          {/* Honeypot: visually hidden, off the tab order, ignored by humans. */}
          <div className="newsletter-signup__honeypot" aria-hidden="true">
            <label>
              Website
              <input
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={(changeEvent) => setWebsite(changeEvent.target.value)}
              />
            </label>
          </div>

          <Button type="submit" className="site-cta" disabled={status === 'submitting'}>
            {status === 'submitting' ? 'Signing you up…' : buttonLabel}
          </Button>
        </div>

        {error ? <FormFeedback tone="error">{error}</FormFeedback> : null}
      </form>
    </section>
  );
}
