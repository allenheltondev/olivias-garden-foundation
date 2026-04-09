-- Migration: Add support for user-defined crop names in grower crop library
-- This migration adds canonical_id (nullable) and crop_name (required) fields
-- to allow users to add any crop they want while maintaining catalog links when available.

-- Add new columns
alter table grower_crop_library
add column canonical_id uuid references crops(id) on delete restrict,
add column crop_name text not null default '';

-- Populate crop_name from catalog for existing entries
update grower_crop_library
set canonical_id = crop_id,
    crop_name = crops.common_name
from crops
where grower_crop_library.crop_id = crops.id;

-- Add constraint to ensure data integrity
alter table grower_crop_library
add constraint grower_crop_library_crop_link_check check (
  (canonical_id is null and crop_name is not null and crop_name != '') or  -- user-defined crop
  (canonical_id is not null)                                               -- catalog crop
);

-- Update unique constraint to use canonical_id
-- First drop the old unique constraint
alter table grower_crop_library
drop constraint if exists grower_crop_library_user_id_crop_id_variety_id_key;

-- Add new unique constraint
alter table grower_crop_library
add constraint grower_crop_library_user_canonical_variety_unique unique (user_id, canonical_id, variety_id);

-- Create new index for canonical_id
create index if not exists idx_grower_crop_library_canonical on grower_crop_library(canonical_id) where canonical_id is not null;

-- Drop old index
drop index if exists idx_grower_crop_library_crop;

-- Remove default from crop_name now that it's populated
alter table grower_crop_library
alter column crop_name drop default;

-- Make crop_id nullable (for backward compatibility during transition)
-- We'll remove it in a future migration after confirming everything works
alter table grower_crop_library
alter column crop_id drop not null;