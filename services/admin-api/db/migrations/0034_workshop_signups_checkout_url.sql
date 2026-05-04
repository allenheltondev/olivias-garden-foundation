-- Persist the Stripe Checkout URL on the signup row so the user can resume
-- a paid checkout if they close the tab or come back later. Without this,
-- the original URL is lost the moment the response goes out — and Stripe
-- doesn't expose a way to look up the URL by session ID without the SDK
-- (and even then, it's gated by whether the session is still open).
--
-- The column is intentionally text (not unique) — a session can in principle
-- be retried, and we already have a unique index on stripe_checkout_session_id
-- which is the actual identity for a checkout. The URL is just a
-- convenience copy.

alter table workshop_signups
  add column if not exists stripe_checkout_url text;
