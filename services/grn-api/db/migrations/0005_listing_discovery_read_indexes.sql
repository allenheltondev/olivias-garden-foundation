-- Adds indexes for active listing discovery reads by geohash prefix with deterministic pagination.

create index if not exists idx_surplus_listings_discover_geo_active_created
  on surplus_listings (geo_key text_pattern_ops, created_at desc, id desc)
  where deleted_at is null
    and status = 'active';
