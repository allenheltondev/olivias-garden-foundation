-- Migration: Allow user-defined crops in surplus listings
-- This enables growers to list surplus of any crop they've added to their library,
-- not just catalog crops. For user-defined crops, crop_id will be null and
-- the crop name comes from the grower_crop_library entry.

-- Make crop_id nullable in surplus_listings
alter table surplus_listings
alter column crop_id drop not null;

-- Add constraint to ensure either crop_id is set (catalog crop) or grower_crop_id is set (user-defined crop)
alter table surplus_listings
add constraint surplus_listings_crop_reference_check check (
  (crop_id is not null) or (grower_crop_id is not null)
);

-- Update indexes to handle null crop_id
drop index if exists idx_surplus_listings_active_geo_created_crop;
create index if not exists idx_surplus_listings_active_geo_created_crop_nulls_last
  on surplus_listings (geo_key text_pattern_ops, created_at desc, crop_id)
  where status = 'active' and deleted_at is null;
