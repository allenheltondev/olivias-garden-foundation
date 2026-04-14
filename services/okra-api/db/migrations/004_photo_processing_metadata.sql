-- 004_photo_processing_metadata.sql
-- Store extracted EXIF metadata for processed photos

alter table submission_photos
  add column if not exists exif_json jsonb;
