-- 0010_stripe_billing_foundation.sql
-- Stripe checkout/webhook user linkage fields.

begin;

alter table users
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text;

create unique index if not exists idx_users_stripe_customer_id
  on users(stripe_customer_id)
  where stripe_customer_id is not null;

create unique index if not exists idx_users_stripe_subscription_id
  on users(stripe_subscription_id)
  where stripe_subscription_id is not null;

commit;
