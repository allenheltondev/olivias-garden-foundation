-- Test script for 0005_listing_discovery_read_indexes.sql migration

do $$
begin
    if not exists (
        select 1
        from pg_indexes
        where schemaname = 'public'
          and tablename = 'surplus_listings'
          and indexname = 'idx_surplus_listings_discover_geo_active_created'
    ) then
        raise exception 'idx_surplus_listings_discover_geo_active_created does not exist';
    end if;
end $$;

select '0005 migration checks passed' as result;
