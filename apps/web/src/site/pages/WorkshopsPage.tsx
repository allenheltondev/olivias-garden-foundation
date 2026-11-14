import { useEffect, useMemo, useState } from 'react';
import { EmptyState } from '@olivias/ui';
import type { AuthSession } from '../../auth/session';
import { CtaButton, PageHero } from '../chrome';
import { webApiBase } from '../routes';

export type WorkshopStatus =
  | 'coming_soon'
  | 'gauging_interest'
  | 'open'
  | 'closed'
  | 'past';

export type WorkshopSignupKind = 'interested' | 'registered' | 'waitlisted';

export type WorkshopPaymentStatus = 'not_required' | 'pending' | 'paid' | 'refunded';

export interface PublicWorkshop {
  id: string;
  slug: string;
  title: string;
  short_description: string | null;
  description: string | null;
  status: WorkshopStatus;
  workshop_date: string | null;
  location: string | null;
  capacity: number | null;
  seats_remaining: number | null;
  image_url: string | null;
  is_paid: boolean;
  price_cents: number | null;
  currency: string;
  interested_count: number;
  my_signup:
    | {
        kind: WorkshopSignupKind;
        payment_status: WorkshopPaymentStatus;
        created_at: string;
        checkout_url?: string | null;
        expires_at?: string | null;
      }
    | null;
}

export function formatWorkshopPrice(
  workshop: Pick<PublicWorkshop, 'is_paid' | 'price_cents' | 'currency'>,
): string | null {
  if (!workshop.is_paid || workshop.price_cents === null) return null;
  const dollars = workshop.price_cents / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: (workshop.currency || 'usd').toUpperCase(),
      maximumFractionDigits: dollars % 1 === 0 ? 0 : 2,
    }).format(dollars);
  } catch {
    return `$${dollars.toFixed(2)}`;
  }
}

const STATUS_LABEL: Record<WorkshopStatus, string> = {
  coming_soon: 'Coming soon',
  gauging_interest: 'Gauging interest',
  open: 'Registration open',
  closed: 'Waitlist only',
  past: 'Past'
};

function statusModifier(status: WorkshopStatus): string {
  return `workshop-card__status workshop-card__status--${status.replace('_', '-')}`;
}

function formatWorkshopDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

// Compact label when the user already has an active signup. Pending
// payment is intentionally not handled here — that gets a "Finish
// payment" CTA, not the chip.
export function signedUpKindLabel(kind: WorkshopSignupKind): string {
  switch (kind) {
    case 'interested': return 'Interested';
    case 'registered': return 'Registered';
    case 'waitlisted': return 'On waitlist';
  }
}

function ctaLabel(workshop: PublicWorkshop): string {
  if (workshop.my_signup?.payment_status === 'pending') {
    return 'Finish payment';
  }
  switch (workshop.status) {
    case 'coming_soon':
      return 'Details coming soon';
    case 'gauging_interest':
      return "I'm interested";
    case 'open': {
      const price = formatWorkshopPrice(workshop);
      return price ? `Register · ${price}` : 'Register';
    }
    case 'closed':
      return 'Join waitlist';
    case 'past':
      return 'View details';
  }
}

export interface WorkshopsPageProps {
  onNavigate: (path: string) => void;
  authSession: AuthSession | null;
}

export function WorkshopsPage({ onNavigate, authSession }: WorkshopsPageProps) {
  const [workshops, setWorkshops] = useState<PublicWorkshop[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const accessToken = authSession?.accessToken ?? null;

  useEffect(() => {
    let cancelled = false;
    const headers: Record<string, string> = {};
    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }

    fetch(`${webApiBase}/workshops`, { headers })
      .then(async (response) => {
        if (!response.ok) {
          // Surface the server's actual error string instead of a bare
          // status code so a "relation does not exist" / "missing
          // configuration" / etc. shows up inline on the page.
          const body = await response.json().catch(() => null);
          const detail = body?.error
            ? `${body.error} (${response.status})`
            : `Unable to load workshops (${response.status})`;
          throw new Error(detail);
        }
        return response.json();
      })
      .then((body) => {
        if (cancelled) return;
        setWorkshops(Array.isArray(body?.items) ? body.items : []);
        setError(null);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message || 'Unable to load workshops.');
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const upcoming = useMemo(
    () => (workshops ?? []).filter((workshop) => workshop.status !== 'past'),
    [workshops]
  );

  return (
    <>
      <PageHero
        title="Workshops"
        body="Hands-on sessions at Olivia's Garden — garden prep, animal care, food preservation. Sign up for an upcoming workshop, join a waitlist, or tell us you're interested in something we're still planning."
        className="workshops-hero"
        titleClassName="workshops-hero__title"
      />

      <div className="page-section workshops-list">
        {error ? (
          <p className="workshops-list__error" role="alert">{error}</p>
        ) : null}
        {workshops === null && !error ? (
          <div
            className="workshops-grid workshops-grid--loading"
            aria-busy="true"
            aria-live="polite"
            aria-label="Loading workshops"
          >
            {Array.from({ length: 6 }).map((_, index) => (
              <article
                key={index}
                className="workshop-card workshop-card--skeleton"
                aria-hidden="true"
              >
                <div className="workshop-card__media">
                  <span className="workshop-card__status workshop-card__status--skeleton" />
                </div>
                <div className="workshop-card__body">
                  <div className="skeleton-line skeleton-line--title" />
                  <div className="skeleton-line skeleton-line--meta" />
                  <div className="skeleton-line skeleton-line--summary" />
                  <div className="skeleton-line skeleton-line--summary skeleton-line--summary-short" />
                  <div className="workshop-card__cta">
                    <div className="skeleton-line skeleton-line--cta" />
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : null}
        {workshops !== null && upcoming.length === 0 && !error ? (
          <EmptyState icon="tools" title="No workshops scheduled yet." actions={(
            <CtaButton href="/contact" variant="secondary" onClick={(event) => {
              event.preventDefault();
              onNavigate('/contact');
            }}>Suggest a workshop</CtaButton>
          )}>
            <p>We&apos;re planning hands-on sessions around real work in the garden. Tell us what you&apos;d like to learn and help shape the first ones.</p>
          </EmptyState>
        ) : null}

        {upcoming.length > 0 ? (
          <div className="workshops-grid">
            {upcoming.map((workshop) => {
              const formattedDate = formatWorkshopDate(workshop.workshop_date);
              const formattedPrice = formatWorkshopPrice(workshop);
              const detailPath = `/workshops/${workshop.slug}`;
              const metaParts = [formattedDate, workshop.location].filter(Boolean) as string[];
              return (
                <article key={workshop.id} className="workshop-card">
                  <div className="workshop-card__media">
                    {workshop.image_url ? (
                      <img
                        className="workshop-card__image"
                        src={workshop.image_url}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      <div
                        className="workshop-card__image workshop-card__image--placeholder"
                        aria-hidden="true"
                      />
                    )}
                    <span className={statusModifier(workshop.status)}>
                      {STATUS_LABEL[workshop.status]}
                    </span>
                  </div>
                  <div className="workshop-card__body">
                    <h2 className="workshop-card__title">
                      {/*
                        Title link is the single tab stop for the card;
                        its ::after overlay extends the click target to
                        cover the entire card so users can click anywhere
                        on the card to navigate. Inner clickables (CTA
                        button, signed-up chip) are z-indexed above the
                        overlay so they keep their own behavior.
                      */}
                      <a
                        href={detailPath}
                        className="workshop-card__title-link"
                        onClick={(event) => {
                          event.preventDefault();
                          onNavigate(detailPath);
                        }}
                      >
                        {workshop.title}
                      </a>
                    </h2>
                    {metaParts.length > 0 || formattedPrice ? (
                      <p className="workshop-card__meta">
                        {metaParts.join(' · ')}
                        {formattedPrice ? (
                          <span className="workshop-card__price">{formattedPrice}</span>
                        ) : null}
                      </p>
                    ) : null}
                    {workshop.short_description ? (
                      <p className="workshop-card__summary">{workshop.short_description}</p>
                    ) : null}
                    <div className="workshop-card__cta">
                      {workshop.my_signup
                        && workshop.my_signup.payment_status !== 'pending' ? (
                        // Already-signed-up state: render a quieter "✓ Interested"
                        // (or Registered / On waitlist) chip rather than a
                        // primary CTA. Still navigable to the detail page so
                        // the user can manage / cancel.
                        <a
                          href={detailPath}
                          onClick={(event) => {
                            event.preventDefault();
                            onNavigate(detailPath);
                          }}
                          className="workshop-card__signed-up"
                          aria-label={`${signedUpKindLabel(workshop.my_signup.kind)} — view ${workshop.title}`}
                        >
                          <svg
                            className="workshop-card__signed-up-icon"
                            viewBox="0 0 16 16"
                            aria-hidden="true"
                            focusable="false"
                          >
                            <path
                              d="M3.5 8.5l3 3 6-6"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                          <span>{signedUpKindLabel(workshop.my_signup.kind)}</span>
                        </a>
                      ) : (
                        <CtaButton
                          href={detailPath}
                          onClick={(event) => {
                            event?.preventDefault?.();
                            onNavigate(detailPath);
                          }}
                        >
                          {ctaLabel(workshop)}
                        </CtaButton>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}
      </div>
    </>
  );
}
