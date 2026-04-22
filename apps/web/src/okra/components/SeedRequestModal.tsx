import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AuthSession } from '../../auth/session';
import { createCorrelationId, createOkraHeaders, okraApiUrl } from '../api';
import './SubmissionModal.css';
import './SeedRequestModal.css';

export interface SeedRequestModalProps {
  open: boolean;
  onClose: () => void;
  authEnabled?: boolean;
  authSession?: AuthSession | null;
  onLogin?: () => void;
  onSignup?: () => void;
}

type FulfillmentMethod = 'mail' | 'in_person';
type Country = 'US' | 'CA';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

interface FormState {
  name: string;
  email: string;
  fulfillmentMethod: FulfillmentMethod;
  line1: string;
  line2: string;
  city: string;
  region: string;
  postalCode: string;
  country: Country;
  visitDate: string;
  visitNotes: string;
  message: string;
}

function initialState(authSession: AuthSession | null | undefined): FormState {
  return {
    name: authSession?.user.name ?? '',
    email: authSession?.user.email ?? '',
    fulfillmentMethod: 'mail',
    line1: '',
    line2: '',
    city: '',
    region: '',
    postalCode: '',
    country: 'US',
    visitDate: '',
    visitNotes: '',
    message: '',
  };
}

export function SeedRequestModal({
  open,
  onClose,
  authEnabled = false,
  authSession = null,
  onLogin,
  onSignup,
}: SeedRequestModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [form, setForm] = useState<FormState>(() => initialState(authSession));
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const idempotencyKeyRef = useRef<string>('');

  useEffect(() => {
    if (open) {
      setForm(initialState(authSession));
      setSubmitError(null);
      setSubmitSuccess(false);
      idempotencyKeyRef.current = createCorrelationId();
    }
  }, [open, authSession]);

  const update = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const missingFields = useMemo(() => {
    const missing: string[] = [];
    if (!form.name.trim()) missing.push('Your name');
    if (!form.email.trim()) {
      missing.push('Email');
    } else if (!EMAIL_PATTERN.test(form.email.trim())) {
      missing.push('A valid email');
    }
    if (form.fulfillmentMethod === 'mail') {
      if (!form.line1.trim()) missing.push('Street address');
      if (!form.city.trim()) missing.push('City');
      if (!form.region.trim()) missing.push('State / province');
      if (!form.postalCode.trim()) missing.push('Postal code');
    }
    return missing;
  }, [form]);

  const canSubmit = missingFields.length === 0 && !isSubmitting;

  const handleClose = useCallback(() => {
    if (isSubmitting) return;
    onClose();
  }, [isSubmitting, onClose]);

  useEffect(() => {
    if (!open) return;

    const dialogElement = dialogRef.current;
    if (!dialogElement) return;

    const focusable = dialogElement.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    if (focusable.length > 0) focusable[0].focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleClose();
        return;
      }
      if (event.key === 'Tab') {
        const activeDialog = dialogRef.current;
        if (!activeDialog) return;
        const items = activeDialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey) {
          if (document.activeElement === first) {
            event.preventDefault();
            last.focus();
          }
        } else if (document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, handleClose]);

  useEffect(() => {
    if (!submitSuccess) return;
    const timer = setTimeout(() => {
      onClose();
    }, 2200);
    return () => clearTimeout(timer);
  }, [submitSuccess, onClose]);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    setSubmitError(null);

    const body: Record<string, unknown> = {
      name: form.name.trim(),
      email: form.email.trim(),
      fulfillmentMethod: form.fulfillmentMethod,
    };
    if (form.fulfillmentMethod === 'mail') {
      body.shippingAddress = {
        line1: form.line1.trim(),
        ...(form.line2.trim() ? { line2: form.line2.trim() } : {}),
        city: form.city.trim(),
        region: form.region.trim(),
        postalCode: form.postalCode.trim(),
        country: form.country,
      };
    } else {
      const visit: Record<string, string> = {};
      if (form.visitDate.trim()) visit.approximateDate = form.visitDate.trim();
      if (form.visitNotes.trim()) visit.notes = form.visitNotes.trim();
      if (Object.keys(visit).length > 0) body.visitDetails = visit;
    }
    if (form.message.trim()) body.message = form.message.trim();

    try {
      const headers = createOkraHeaders({
        contentType: 'application/json',
        accessToken: authSession?.accessToken ?? null,
      });
      headers.set('Idempotency-Key', idempotencyKeyRef.current);

      const response = await fetch(okraApiUrl('/requests'), {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        let message = 'Something went wrong. Please try again.';
        try {
          const data = await response.json();
          if (typeof data?.message === 'string') message = data.message;
          const firstIssue = data?.details?.issues?.[0];
          if (typeof firstIssue === 'string') message = firstIssue;
        } catch {
          // ignore
        }
        setSubmitError(message);
        return;
      }

      setSubmitSuccess(true);
    } catch {
      setSubmitError('Network error. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [authSession, canSubmit, form]);

  if (!open) return null;

  return (
    <div className="submission-modal__backdrop" onClick={handleClose}>
      <div
        ref={dialogRef}
        className="submission-modal__dialog"
        role="dialog"
        aria-label="Request free okra seeds"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="submission-modal__header">
          <h2 className="submission-modal__title">Request free okra seeds</h2>
          <button
            type="button"
            className="submission-modal__close-btn"
            onClick={handleClose}
            aria-label="Close"
          >
            x
          </button>
        </div>

        <div className="submission-modal__body">
          {submitSuccess ? (
            <div className="submission-modal__success" role="status">
              <span className="submission-modal__success-icon">OK</span>
              <p>Request received. We&apos;ll be in touch by email soon.</p>
            </div>
          ) : (
            <>
              {authEnabled ? (
                <section className="submission-modal__auth">
                  {authSession ? (
                    <>
                      <p className="submission-modal__auth-eyebrow">Signed in</p>
                      <p className="submission-modal__auth-title">
                        We&apos;ll tie this request to{' '}
                        {authSession.user.name ?? authSession.user.email ?? 'your account'}.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="submission-modal__auth-eyebrow">Anonymous is fine</p>
                      <p className="submission-modal__auth-title">
                        No sign-in required. Log in if you&apos;d like to track this request later.
                      </p>
                      <div className="submission-modal__auth-actions">
                        <button type="button" className="submission-modal__auth-button" onClick={onLogin}>
                          Log in
                        </button>
                        <button
                          type="button"
                          className="submission-modal__auth-button submission-modal__auth-button--primary"
                          onClick={onSignup}
                        >
                          Sign up
                        </button>
                      </div>
                    </>
                  )}
                </section>
              ) : null}

              <section className="submission-modal__section">
                <h3 className="submission-modal__section-heading">Your details</h3>
                <div className="seed-request__grid">
                  <label className="seed-request__field">
                    <span className="seed-request__label">Name</span>
                    <input
                      className="seed-request__input"
                      type="text"
                      value={form.name}
                      onChange={(e) => update('name', e.target.value)}
                      disabled={isSubmitting}
                      autoComplete="name"
                    />
                  </label>
                  <label className="seed-request__field">
                    <span className="seed-request__label">Email</span>
                    <input
                      className="seed-request__input"
                      type="email"
                      value={form.email}
                      onChange={(e) => update('email', e.target.value)}
                      disabled={isSubmitting}
                      autoComplete="email"
                    />
                  </label>
                </div>
              </section>

              <section className="submission-modal__section">
                <h3 className="submission-modal__section-heading">How should we get them to you?</h3>
                <p className="seed-request__hint">
                  We can only mail seeds within the United States and Canada. If you&apos;re
                  planning a visit, we&apos;re happy to hand them off in person.
                </p>
                <div className="seed-request__toggle" role="radiogroup" aria-label="Fulfillment method">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={form.fulfillmentMethod === 'mail'}
                    className={`seed-request__toggle-btn${form.fulfillmentMethod === 'mail' ? ' seed-request__toggle-btn--active' : ''}`}
                    onClick={() => update('fulfillmentMethod', 'mail')}
                    disabled={isSubmitting}
                  >
                    Mail to me (US / Canada)
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={form.fulfillmentMethod === 'in_person'}
                    className={`seed-request__toggle-btn${form.fulfillmentMethod === 'in_person' ? ' seed-request__toggle-btn--active' : ''}`}
                    onClick={() => update('fulfillmentMethod', 'in_person')}
                    disabled={isSubmitting}
                  >
                    In-person exchange
                  </button>
                </div>

                {form.fulfillmentMethod === 'mail' ? (
                  <div className="seed-request__grid seed-request__grid--address">
                    <label className="seed-request__field seed-request__field--wide">
                      <span className="seed-request__label">Street address</span>
                      <input
                        className="seed-request__input"
                        type="text"
                        value={form.line1}
                        onChange={(e) => update('line1', e.target.value)}
                        disabled={isSubmitting}
                        autoComplete="address-line1"
                      />
                    </label>
                    <label className="seed-request__field seed-request__field--wide">
                      <span className="seed-request__label">Apartment / suite (optional)</span>
                      <input
                        className="seed-request__input"
                        type="text"
                        value={form.line2}
                        onChange={(e) => update('line2', e.target.value)}
                        disabled={isSubmitting}
                        autoComplete="address-line2"
                      />
                    </label>
                    <label className="seed-request__field">
                      <span className="seed-request__label">City</span>
                      <input
                        className="seed-request__input"
                        type="text"
                        value={form.city}
                        onChange={(e) => update('city', e.target.value)}
                        disabled={isSubmitting}
                        autoComplete="address-level2"
                      />
                    </label>
                    <label className="seed-request__field">
                      <span className="seed-request__label">State / province</span>
                      <input
                        className="seed-request__input"
                        type="text"
                        value={form.region}
                        onChange={(e) => update('region', e.target.value)}
                        disabled={isSubmitting}
                        autoComplete="address-level1"
                      />
                    </label>
                    <label className="seed-request__field">
                      <span className="seed-request__label">Postal code</span>
                      <input
                        className="seed-request__input"
                        type="text"
                        value={form.postalCode}
                        onChange={(e) => update('postalCode', e.target.value)}
                        disabled={isSubmitting}
                        autoComplete="postal-code"
                      />
                    </label>
                    <label className="seed-request__field">
                      <span className="seed-request__label">Country</span>
                      <select
                        className="seed-request__input"
                        value={form.country}
                        onChange={(e) => update('country', e.target.value as Country)}
                        disabled={isSubmitting}
                      >
                        <option value="US">United States</option>
                        <option value="CA">Canada</option>
                      </select>
                    </label>
                  </div>
                ) : (
                  <div className="seed-request__grid">
                    <label className="seed-request__field seed-request__field--wide">
                      <span className="seed-request__label">When do you think you&apos;ll visit?</span>
                      <input
                        className="seed-request__input"
                        type="text"
                        placeholder="e.g. late May, summer 2026"
                        value={form.visitDate}
                        onChange={(e) => update('visitDate', e.target.value)}
                        disabled={isSubmitting}
                      />
                    </label>
                    <label className="seed-request__field seed-request__field--wide">
                      <span className="seed-request__label">Anything we should know?</span>
                      <textarea
                        className="seed-request__input seed-request__textarea"
                        rows={3}
                        value={form.visitNotes}
                        onChange={(e) => update('visitNotes', e.target.value)}
                        disabled={isSubmitting}
                      />
                    </label>
                  </div>
                )}
              </section>

              <section className="submission-modal__section">
                <h3 className="submission-modal__section-heading">Message (optional)</h3>
                <textarea
                  className="seed-request__input seed-request__textarea"
                  rows={3}
                  placeholder="Tell us a bit about where these seeds are going."
                  value={form.message}
                  onChange={(e) => update('message', e.target.value)}
                  disabled={isSubmitting}
                />
              </section>

              <section className="submission-modal__section submission-modal__section--submit">
                {submitError ? (
                  <p className="seed-request__error" role="alert">{submitError}</p>
                ) : null}
                {missingFields.length > 0 ? (
                  <p className="seed-request__hint">Still needed: {missingFields.join(', ')}</p>
                ) : null}
                <button
                  type="button"
                  className="ok-btn ok-btn--primary ok-btn--lg seed-request__submit"
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                >
                  {isSubmitting ? 'Sending…' : 'Send my request'}
                </button>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
