-- Garden Club cancel-at-period-end support.
--
-- Stripe's `cancel_at_period_end = true` means the subscription stays active
-- until the end of the current billing period, then transitions to canceled.
-- We model that with a new `canceling` status plus a `garden_club_cancel_at`
-- timestamp so the profile UI can show "ends on {date}" without inferring it
-- from other fields.

alter table users
  drop constraint if exists users_garden_club_status_check;

alter table users
  add constraint users_garden_club_status_check
  check (garden_club_status in ('none', 'active', 'past_due', 'canceling', 'canceled'));

alter table users
  add column if not exists garden_club_cancel_at timestamptz;
