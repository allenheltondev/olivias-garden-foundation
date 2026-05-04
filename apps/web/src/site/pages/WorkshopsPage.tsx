import { useEffect, useMemo, useState } from 'react';
import { Card } from '@olivias/ui';
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

function ctaLabel(workshop: PublicWorkshop): string {
  if (workshop.my_signup) {
    if (workshop.my_signup.payment_status === 'pending') {
      return 'Finish payment';
    }
    switch (workshop.my_signup.kind) {
      case 'interested':
        return "You're on the interest list";
      case 'registered':
        return "You're registered";
      case 'waitlisted':
        return "You're on the waitlist";
    }
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
          <p className="workshops-list__loading">Loading workshops…</p>
        ) : null}
        {workshops !== null && upcoming.length === 0 && !error ? (
          <Card title="No workshops scheduled yet.">
            <p>
              We&apos;re not running any workshops at the moment. Check back soon, or
              <a
                href="/contact"
                onClick={(event) => {
                  event.preventDefault();
                  onNavigate('/contact');
                }}
              >
                {' '}let us know what you&apos;d like to learn
              </a>
              .
            </p>
          </Card>
        ) : null}

        {upcoming.length > 0 ? (
          <div className="stack-grid workshops-grid">
            {upcoming.map((workshop) => {
              const formattedDate = formatWorkshopDate(workshop.workshop_date);
              const formattedPrice = formatWorkshopPrice(workshop);
              const detailPath = `/workshops/${workshop.slug}`;
              return (
                <Card key={workshop.id} title={workshop.title} className="workshop-card">
                  {workshop.image_url ? (
                    <img
                      className="workshop-card__image"
                      src={workshop.image_url}
                      alt=""
                    />
                  ) : null}
                  <p className={statusModifier(workshop.status)}>{STATUS_LABEL[workshop.status]}</p>
                  {formattedDate ? (
                    <p className="workshop-card__date">{formattedDate}</p>
                  ) : null}
                  {workshop.location ? (
                    <p className="workshop-card__location">{workshop.location}</p>
                  ) : null}
                  {formattedPrice ? (
                    <p className="workshop-card__price">{formattedPrice}</p>
                  ) : null}
                  {workshop.short_description ? (
                    <p className="workshop-card__summary">{workshop.short_description}</p>
                  ) : null}
                  <CtaButton
                    href={detailPath}
                    onClick={(event) => {
                      event?.preventDefault?.();
                      onNavigate(detailPath);
                    }}
                  >
                    {ctaLabel(workshop)}
                  </CtaButton>
                </Card>
              );
            })}
          </div>
        ) : null}
      </div>
    </>
  );
}
