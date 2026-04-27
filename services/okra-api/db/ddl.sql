-- Okra MVP schema (PostgreSQL)
-- Node.js 24 application stack

create extension if not exists pgcrypto;

create type submission_status as enum (
  'pending_review',
  'approved',
  'denied'
);

create type privacy_mode as enum (
  'exact',
  'nearby',
  'neighborhood',
  'city'
);

create type photo_status as enum (
  'uploaded',
  'processing',
  'ready',
  'failed'
);

create table if not exists admin_users (
  id uuid primary key default gen_random_uuid(),
  cognito_sub text unique not null,
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists submissions (
  id uuid primary key default gen_random_uuid(),

  -- contributor-provided fields
  contributor_name text,
  contributor_email text,
  contributor_cognito_sub text,
  story_text text,
  raw_location_text text,
  privacy_mode privacy_mode not null default 'city',

  -- map coordinates used for display
  display_lat double precision not null,
  display_lng double precision not null,

  -- optional internal geocode fields
  geocode_lat double precision,
  geocode_lng double precision,
  geocode_provider text,
  geocode_confidence numeric(5,2),

  status submission_status not null default 'pending_review',

  reviewed_by uuid references admin_users(id),
  reviewed_at timestamptz,
  review_notes text,

  country text,
  edit_count integer not null default 0,
  edited_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint submissions_lat_bounds check (display_lat between -90 and 90),
  constraint submissions_lng_bounds check (display_lng between -180 and 180)
);

create index if not exists idx_submissions_status_created
  on submissions(status, created_at desc);

create index if not exists idx_submissions_approved
  on submissions(status, reviewed_at desc)
  where status = 'approved';

create index if not exists idx_submissions_status_created_id
  on submissions(status, created_at asc, id asc);

create index if not exists idx_submissions_contributor_cognito_sub_created
  on submissions(contributor_cognito_sub, created_at desc)
  where contributor_cognito_sub is not null;

create index if not exists idx_submissions_approved_country
  on submissions(status, country)
  where status = 'approved';

create table if not exists submission_photos (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions(id) on delete cascade,

  original_s3_bucket text not null,
  original_s3_key text not null,

  -- normalized outputs
  normalized_s3_bucket text,
  normalized_s3_key text,
  thumbnail_s3_bucket text,
  thumbnail_s3_key text,

  mime_type text,
  width integer,
  height integer,
  byte_size bigint,
  sha256_hash text,

  status photo_status not null default 'uploaded',
  processing_error text,
  removed_at timestamptz,
  review_status text not null default 'approved'
    check (review_status in ('approved', 'pending_edit', 'denied')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_submission_photos_submission
  on submission_photos(submission_id, created_at asc);

create index if not exists idx_submission_photos_status
  on submission_photos(status, created_at desc);

create table if not exists edit_tokens (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_edit_tokens_submission
  on edit_tokens(submission_id, expires_at desc);

create index if not exists idx_edit_tokens_active
  on edit_tokens(expires_at)
  where used_at is null;

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

-- helper trigger for updated_at
create or replace function touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_admin_users_updated_at
before update on admin_users
for each row execute function touch_updated_at();

create trigger trg_submissions_updated_at
before update on submissions
for each row execute function touch_updated_at();

create trigger trg_submission_photos_updated_at
before update on submission_photos
for each row execute function touch_updated_at();

create trigger trg_submission_edits_updated_at
before update on submission_edits
for each row execute function touch_updated_at();
