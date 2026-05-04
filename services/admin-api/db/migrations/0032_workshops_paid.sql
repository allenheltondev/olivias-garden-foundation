-- Add paid-workshop fields to workshops. Free workshops keep is_paid=false
-- and leave price/currency/Stripe ids null. Paid workshops require all of
-- price_cents, currency, stripe_product_id, stripe_price_id together; the
-- check constraint enforces that pairing so the application can't end up
-- with a paid workshop missing its Stripe linkage (or vice versa).

alter table workshops
  add column if not exists is_paid boolean not null default false,
  add column if not exists price_cents integer,
  add column if not exists currency text not null default 'usd',
  add column if not exists stripe_product_id text,
  add column if not exists stripe_price_id text;

-- Currency must match the same lowercase 3-letter ISO format the store uses.
alter table workshops
  drop constraint if exists workshops_currency_format;
alter table workshops
  add constraint workshops_currency_format
  check (currency = lower(currency) and currency ~ '^[a-z]{3}$');

-- Stripe minimum charge for usd is $0.50. Keep a generous floor (50 cents)
-- so admins can't accidentally save a workshop that Stripe will reject.
alter table workshops
  drop constraint if exists workshops_price_cents_range;
alter table workshops
  add constraint workshops_price_cents_range
  check (price_cents is null or price_cents >= 50);

-- The is_paid flag must agree with the price/Stripe columns:
--   is_paid=true  → price_cents, stripe_product_id, stripe_price_id all NOT NULL
--   is_paid=false → price_cents, stripe_product_id, stripe_price_id all NULL
-- This rules out half-configured paid workshops.
alter table workshops
  drop constraint if exists workshops_paid_fields_consistent;
alter table workshops
  add constraint workshops_paid_fields_consistent
  check (
    (is_paid = true
      and price_cents is not null
      and stripe_product_id is not null
      and stripe_price_id is not null)
    or (is_paid = false
      and price_cents is null
      and stripe_product_id is null
      and stripe_price_id is null)
  );

create unique index if not exists idx_workshops_stripe_product_id
  on workshops (stripe_product_id)
  where stripe_product_id is not null;

create unique index if not exists idx_workshops_stripe_price_id
  on workshops (stripe_price_id)
  where stripe_price_id is not null;
