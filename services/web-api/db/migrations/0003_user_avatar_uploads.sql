alter table users
  drop column if exists avatar_url;

alter table users
  add column if not exists avatar_id uuid,
  add column if not exists avatar_status text not null default 'none'
    check (avatar_status in ('none', 'uploaded', 'processing', 'ready', 'failed')),
  add column if not exists avatar_original_s3_bucket text,
  add column if not exists avatar_original_s3_key text,
  add column if not exists avatar_s3_bucket text,
  add column if not exists avatar_s3_key text,
  add column if not exists avatar_thumbnail_s3_bucket text,
  add column if not exists avatar_thumbnail_s3_key text,
  add column if not exists avatar_mime_type text,
  add column if not exists avatar_width integer,
  add column if not exists avatar_height integer,
  add column if not exists avatar_byte_size bigint,
  add column if not exists avatar_processing_error text,
  add column if not exists avatar_updated_at timestamptz;
