-- Add source provenance + attribution fields for catalog entities.
-- Supports external-source import auditability (e.g., Permapeople, USDA) and UI attribution.

alter table crops
  add column if not exists source_provider text not null default 'internal_seed',
  add column if not exists source_record_id text,
  add column if not exists source_url text,
  add column if not exists source_license text,
  add column if not exists attribution_text text,
  add column if not exists import_batch_id text,
  add column if not exists imported_at timestamptz,
  add column if not exists last_verified_at timestamptz;

create index if not exists idx_crops_source_provider on crops(source_provider);
create unique index if not exists idx_crops_source_record
  on crops(source_provider, source_record_id)
  where source_record_id is not null;

alter table crop_varieties
  add column if not exists source_provider text not null default 'internal_seed',
  add column if not exists source_record_id text,
  add column if not exists source_url text,
  add column if not exists source_license text,
  add column if not exists attribution_text text,
  add column if not exists import_batch_id text,
  add column if not exists imported_at timestamptz,
  add column if not exists last_verified_at timestamptz;

create index if not exists idx_crop_varieties_source_provider on crop_varieties(source_provider);
create unique index if not exists idx_crop_varieties_source_record
  on crop_varieties(crop_id, source_provider, source_record_id)
  where source_record_id is not null;
