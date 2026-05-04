-- Track payment state on individual signups so the same workshop_signups
-- row can serve free workshops (payment_status='not_required') and paid
-- workshops (the row reserves a seat in 'pending' state, becomes 'paid'
-- on Stripe webhook). expires_at protects capacity from being held forever
-- by users who start checkout and bail; the webshop layer ignores expired
-- pending rows when counting registered seats.

do $$
begin
  create type workshop_signup_payment_status as enum (
    'not_required',
    'pending',
    'paid',
    'refunded'
  );
exception
  when duplicate_object then null;
end $$;

alter table workshop_signups
  add column if not exists payment_status workshop_signup_payment_status
    not null default 'not_required',
  add column if not exists stripe_checkout_session_id text,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists amount_cents integer,
  add column if not exists currency text,
  add column if not exists paid_at timestamptz,
  add column if not exists expires_at timestamptz;

create unique index if not exists idx_workshop_signups_stripe_checkout_session_id
  on workshop_signups (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

-- Find the row that owns a webhook event without scanning the table.
create index if not exists idx_workshop_signups_payment_status
  on workshop_signups (payment_status, expires_at);
