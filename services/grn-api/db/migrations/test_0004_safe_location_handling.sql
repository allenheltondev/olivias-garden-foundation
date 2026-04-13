-- Test script for 0004_safe_location_handling.sql migration

do $$
begin
    if not exists (
        select 1 from information_schema.columns
        where table_name = 'grower_profiles' and column_name = 'address'
    ) then
        raise exception 'grower_profiles.address does not exist';
    end if;

    if not exists (
        select 1 from information_schema.columns
        where table_name = 'gatherer_profiles' and column_name = 'address'
    ) then
        raise exception 'gatherer_profiles.address does not exist';
    end if;

    if not exists (
        select 1 from information_schema.columns
        where table_name = 'surplus_listings' and column_name = 'effective_pickup_address'
    ) then
        raise exception 'surplus_listings.effective_pickup_address does not exist';
    end if;
end $$;

select '0004 migration checks passed' as result;
