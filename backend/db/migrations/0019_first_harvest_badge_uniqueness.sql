-- Ensure first_harvest remains single-award per account (backfill-safe reruns).

create unique index if not exists idx_badge_award_first_harvest_once
  on badge_award_audit(user_id, badge_key)
  where badge_key = 'first_harvest';
