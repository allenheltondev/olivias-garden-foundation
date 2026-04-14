-- 002_photo_staging.sql
-- Allow temporary photo records before submission and TTL-style expiry via expires_at

alter table submission_photos
  alter column submission_id drop not null;

alter table submission_photos
  add column if not exists expires_at timestamptz,
  add column if not exists claimed_at timestamptz;

create index if not exists idx_submission_photos_expires_at
  on submission_photos(expires_at)
  where expires_at is not null;

create index if not exists idx_submission_photos_unclaimed
  on submission_photos(created_at desc)
  where submission_id is null;
