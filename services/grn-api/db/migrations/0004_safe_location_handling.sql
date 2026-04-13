-- Safe location handling for profiles and listings.
-- Addresses are now first-class inputs; coordinates remain derived data.

alter table grower_profiles
  add column if not exists address text;

alter table gatherer_profiles
  add column if not exists address text;

alter table surplus_listings
  add column if not exists effective_pickup_address text;

with resolved_pickup_addresses as (
  select
    sl.id,
    coalesce(
      nullif(btrim(sl.pickup_address), ''),
      nullif(btrim(gp.address), '')
    ) as resolved_pickup_address
  from surplus_listings sl
  left join grower_profiles gp on gp.user_id = sl.user_id
  where sl.effective_pickup_address is null
)
update surplus_listings sl
set effective_pickup_address = resolved.resolved_pickup_address
from resolved_pickup_addresses resolved
where sl.id = resolved.id
  and resolved.resolved_pickup_address is not null;
