-- Test script for 0006_derived_supply_signals.sql migration

do $$
declare
  v_now timestamptz := now();
  v_bucket_start timestamptz := date_trunc('hour', now());
  v_expired_bucket_start timestamptz := date_trunc('hour', now() - interval '1 hour');
  v_crop_id uuid := gen_random_uuid();
  v_slug text := 'test-signal-crop-' || replace(gen_random_uuid()::text, '-', '');
  v_count integer;
  v_listing_count integer;
  v_request_count integer;
  v_geo_precision smallint;
  v_payload jsonb;
begin
  if not exists (
    select 1
    from pg_class
    where relname = 'derived_supply_signals'
      and relkind = 'r'
  ) then
    raise exception 'derived_supply_signals table does not exist';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'derived_supply_signals'
      and indexname = 'idx_derived_supply_signals_identity'
  ) then
    raise exception 'idx_derived_supply_signals_identity does not exist';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'derived_supply_signals'
      and indexname = 'idx_derived_supply_signals_geo_window_latest'
  ) then
    raise exception 'idx_derived_supply_signals_geo_window_latest does not exist';
  end if;

  if to_regprocedure('upsert_derived_supply_signal(integer,text,integer,timestamp with time zone,uuid,integer,integer,numeric,numeric,numeric,numeric,jsonb,timestamp with time zone,timestamp with time zone)') is null then
    raise exception 'upsert_derived_supply_signal function does not exist';
  end if;

  if to_regprocedure('list_latest_derived_supply_signals(text,integer,integer,integer,timestamp with time zone)') is null then
    raise exception 'list_latest_derived_supply_signals function does not exist';
  end if;

  insert into crops (id, slug, common_name)
  values (v_crop_id, v_slug, 'Test Signal Crop');

  perform upsert_derived_supply_signal(
    1,
    '9Q8YYK',
    7,
    v_bucket_start,
    v_crop_id,
    2,
    4,
    12.500,
    8.250,
    0.250,
    0.750,
    '{"confidence":0.87,"drivers":["tomato","kale"]}'::jsonb,
    v_now,
    v_now + interval '35 days'
  );

  perform upsert_derived_supply_signal(
    1,
    '9Q8YYK',
    7,
    v_bucket_start,
    v_crop_id,
    3,
    5,
    14.750,
    9.125,
    0.310,
    0.910,
    '{"confidence":0.91,"drivers":["tomato","kale","chard"]}'::jsonb,
    v_now + interval '5 minutes',
    v_now + interval '35 days'
  );

  select count(*)
  into v_count
  from derived_supply_signals
  where schema_version = 1
    and geo_boundary_key = '9q8yyk'
    and window_days = 7
    and bucket_start = v_bucket_start
    and crop_id = v_crop_id;

  if v_count <> 1 then
    raise exception 'Expected exactly one upserted row, found %', v_count;
  end if;

  select listing_count, request_count, geo_precision, signal_payload
  into v_listing_count, v_request_count, v_geo_precision, v_payload
  from derived_supply_signals
  where schema_version = 1
    and geo_boundary_key = '9q8yyk'
    and window_days = 7
    and bucket_start = v_bucket_start
    and crop_id = v_crop_id;

  if v_listing_count <> 3 then
    raise exception 'Expected listing_count = 3, found %', v_listing_count;
  end if;

  if v_request_count <> 5 then
    raise exception 'Expected request_count = 5, found %', v_request_count;
  end if;

  if v_geo_precision <> 6 then
    raise exception 'Expected geo_precision = 6, found %', v_geo_precision;
  end if;

  if (v_payload ->> 'confidence') <> '0.91' then
    raise exception 'Expected payload confidence 0.91, found %', v_payload ->> 'confidence';
  end if;

  begin
    insert into derived_supply_signals (
      schema_version,
      geo_boundary_key,
      geo_precision,
      window_days,
      bucket_start,
      listing_count,
      request_count,
      supply_quantity,
      demand_quantity,
      scarcity_score,
      abundance_score,
      computed_at,
      expires_at
    ) values (
      1,
      '9q8yyi',
      5,
      7,
      v_bucket_start,
      1,
      1,
      1,
      1,
      0,
      0,
      v_now,
      v_now + interval '1 day'
    );
    raise exception 'Expected geo precision/key mismatch to fail';
  exception
    when check_violation then
      null;
  end;

  begin
    perform upsert_derived_supply_signal(
      1,
      '9q8yy!',
      7,
      v_bucket_start,
      null,
      1,
      1,
      1.000,
      1.000,
      0.100,
      0.100,
      '{"confidence":0.10}'::jsonb,
      v_now,
      v_now + interval '1 day'
    );
    raise exception 'Expected invalid geohash prefix to fail';
  exception
    when raise_exception then
      if position('valid geohash prefix' in sqlerrm) = 0 then
        raise;
      end if;
  end;

  perform upsert_derived_supply_signal(
    1,
    '9q8yyk',
    7,
    v_expired_bucket_start,
    null,
    1,
    1,
    1.000,
    1.000,
    0.100,
    0.100,
    '{"confidence":0.10}'::jsonb,
    v_now - interval '2 hours',
    v_now - interval '1 hour'
  );

  select count(*)
  into v_count
  from list_latest_derived_supply_signals('9q8', 7, 1, 20, v_now)
  where bucket_start = v_expired_bucket_start;

  if v_count <> 0 then
    raise exception 'Expired rows must not be returned by list_latest_derived_supply_signals';
  end if;

  select count(*)
  into v_count
  from list_latest_derived_supply_signals('9q8', 7, 1, 20, v_now)
  where bucket_start = v_bucket_start
    and crop_id = v_crop_id;

  if v_count <> 1 then
    raise exception 'Expected active signal row to be returned by read function';
  end if;
end $$;

select '0006 migration checks passed' as result;
