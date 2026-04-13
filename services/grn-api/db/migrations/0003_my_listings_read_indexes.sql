-- Adds indexes that support grower-scoped listing reads with pagination and status filtering.

create index if not exists idx_surplus_listings_user_created
  on surplus_listings(user_id, created_at desc, id desc)
  where deleted_at is null;

create index if not exists idx_surplus_listings_user_status_created
  on surplus_listings(user_id, status, created_at desc, id desc)
  where deleted_at is null;
