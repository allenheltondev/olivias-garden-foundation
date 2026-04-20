create table if not exists donation_events (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  stripe_invoice_id text,
  stripe_customer_id text,
  stripe_subscription_id text,
  user_id uuid references users(id) on delete set null,
  donation_mode text not null check (donation_mode in ('one_time', 'recurring')),
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'usd',
  donor_name text,
  donor_email text,
  dedication_name text,
  t_shirt_preference text,
  source text not null default 'stripe',
  created_at timestamptz not null default now(),
  received_at timestamptz not null default now()
);

create unique index if not exists idx_donation_events_stripe_event_id
  on donation_events(stripe_event_id)
  where stripe_event_id is not null;

create unique index if not exists idx_donation_events_invoice_id
  on donation_events(stripe_invoice_id)
  where stripe_invoice_id is not null;

create index if not exists idx_donation_events_user_created
  on donation_events(user_id, created_at desc)
  where user_id is not null;

alter table users
  add column if not exists donation_total_cents bigint not null default 0,
  add column if not exists donation_count integer not null default 0,
  add column if not exists last_donated_at timestamptz,
  add column if not exists last_donation_mode text check (last_donation_mode in ('one_time', 'recurring')),
  add column if not exists garden_club_status text default 'none'
    check (garden_club_status in ('none', 'active', 'past_due', 'canceled')),
  add column if not exists garden_club_t_shirt_preference text,
  add column if not exists stripe_donor_customer_id text,
  add column if not exists stripe_garden_club_subscription_id text;

create unique index if not exists idx_users_stripe_donor_customer_id
  on users(stripe_donor_customer_id)
  where stripe_donor_customer_id is not null;

create unique index if not exists idx_users_garden_club_subscription_id
  on users(stripe_garden_club_subscription_id)
  where stripe_garden_club_subscription_id is not null;
