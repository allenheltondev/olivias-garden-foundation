-- 003_photo_rate_limit.sql
-- Track request source for photo pre-upload rate limiting

alter table submission_photos
  add column if not exists created_by_ip text;

create index if not exists idx_submission_photos_ip_created
  on submission_photos(created_by_ip, created_at desc)
  where created_by_ip is not null;
