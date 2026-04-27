-- 008_submission_edits.sql
-- Allow contributors to revise okra submissions while approved content stays public.

alter table submissions
  add column if not exists edit_count integer not null default 0,
  add column if not exists edited_at timestamptz;

alter table submission_photos
  add column if not exists removed_at timestamptz,
  add column if not exists review_status text not null default 'approved'
    check (review_status in ('approved', 'pending_edit', 'denied'));

create table if not exists submission_edits (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions(id) on delete cascade,

  contributor_name text,
  story_text text,
  raw_location_text text not null,
  privacy_mode privacy_mode not null default 'city',
  display_lat double precision not null,
  display_lng double precision not null,

  status submission_status not null default 'pending_review',
  reviewed_by uuid references admin_users(id),
  reviewed_at timestamptz,
  review_notes text,
  denial_reason text check (denial_reason is null or denial_reason in ('spam', 'invalid_location', 'inappropriate', 'other')),
  client_edit_key text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint submission_edits_lat_bounds check (display_lat between -90 and 90),
  constraint submission_edits_lng_bounds check (display_lng between -180 and 180)
);

create index if not exists idx_submission_edits_submission_status
  on submission_edits(submission_id, status, created_at desc);

create index if not exists idx_submission_edits_status_created
  on submission_edits(status, created_at asc, id asc);

create unique index if not exists idx_submission_edits_client_edit_key
  on submission_edits(submission_id, client_edit_key)
  where client_edit_key is not null;

create table if not exists submission_edit_photos (
  edit_id uuid not null references submission_edits(id) on delete cascade,
  photo_id uuid not null references submission_photos(id) on delete cascade,
  action text not null check (action in ('add', 'remove')),
  created_at timestamptz not null default now(),
  primary key (edit_id, photo_id, action)
);

create index if not exists idx_submission_edit_photos_edit
  on submission_edit_photos(edit_id, action, created_at asc);

drop trigger if exists trg_submission_edits_updated_at on submission_edits;
create trigger trg_submission_edits_updated_at
before update on submission_edits
for each row execute function touch_updated_at();
