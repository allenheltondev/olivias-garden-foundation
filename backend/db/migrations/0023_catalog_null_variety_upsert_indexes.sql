-- Migration: add partial unique indexes for null-variety catalog upserts
-- These indexes support generated catalog seed SQL that upserts default
-- crop profiles and USDA zone suitability rows where variety_id is null.

create unique index if not exists idx_crop_profiles_crop_null_variety
  on crop_profiles(crop_id)
  where variety_id is null;

create unique index if not exists idx_crop_zone_suitability_crop_system_null_variety
  on crop_zone_suitability(crop_id, system)
  where variety_id is null;
