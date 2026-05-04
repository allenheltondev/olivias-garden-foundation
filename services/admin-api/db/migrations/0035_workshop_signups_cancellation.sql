-- Soft-cancellation for paid signups: we can't hard-delete the row when
-- a user cancels because the admin still needs an audit trail (who paid,
-- who cancelled, when) to reconcile the refund in Stripe. Free signups
-- still hard-delete; only paid signups go through the soft-cancel path.
--
-- The original UNIQUE(workshop_id, user_id) constraint blocked
-- re-signup after a soft-cancel — the cancelled row would still occupy
-- the slot. Replace it with a partial unique index that only enforces
-- uniqueness over *active* (cancelled_at IS NULL) rows. This is the
-- standard soft-delete pattern.

alter table workshop_signups
  add column if not exists cancelled_at timestamptz;

-- Drop the inline UNIQUE created in migration 0031. Postgres auto-names
-- it `<table>_<col1>_<col2>_key`. If the deploy ever runs into a hand-
-- modified DB where the name differs, this is a no-op and the new
-- partial index will fail to create — at which point the migration log
-- surfaces the problem. Better to fail loud than to ship a broken
-- uniqueness invariant.
alter table workshop_signups
  drop constraint if exists workshop_signups_workshop_id_user_id_key;

create unique index if not exists idx_workshop_signups_unique_active
  on workshop_signups (workshop_id, user_id)
  where cancelled_at is null;

-- Help the cancellation-aware capacity-count query stay cheap.
create index if not exists idx_workshop_signups_active
  on workshop_signups (workshop_id, kind, payment_status)
  where cancelled_at is null;
