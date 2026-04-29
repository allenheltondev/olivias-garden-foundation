-- Account deletion support: allow users to request a full deletion of their data.
-- The users table already has a `deleted_at` column. Deletion is performed by:
--   1. Clearing the profile PII fields on the row.
--   2. Marking deleted_at = now().
--   3. Severing references from donation_events (user_id set to null; donor_name/donor_email also scrubbed).
--
-- This migration only adds supporting indexes. The deletion logic itself lives in the web API.

create index if not exists idx_users_email_active
  on users(email)
  where deleted_at is null;
