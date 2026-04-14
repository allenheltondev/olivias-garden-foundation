-- 002_submission_reviews.sql
-- Add submission_reviews audit table and pagination index

create table if not exists submission_reviews (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions(id) on delete cascade,
  action text not null check (action in ('approved', 'denied')),
  reason text check (reason is null or reason in ('spam', 'invalid_location', 'inappropriate', 'other')),
  reviewed_by uuid not null references admin_users(id),
  reviewed_at timestamptz not null default now(),
  notes text,

  constraint submission_reviews_deny_reason
    check (action != 'denied' or reason is not null)
);

create index if not exists idx_submission_reviews_submission
  on submission_reviews(submission_id, reviewed_at desc);

create index if not exists idx_submissions_status_created_id
  on submissions(status, created_at asc, id asc);
