-- Adds derived-table storage for rolling geo-window supply/demand signals.
-- Designed for idempotent worker updates and replay-safe reads.

create table if not exists derived_supply_signals (
  id bigserial primary key,
  schema_version integer not null default 1,
  geo_boundary_key text not null,
  geo_precision smallint not null,
  window_days smallint not null,
  bucket_start timestamptz not null,
  crop_id uuid references crops(id) on delete cascade,
  crop_scope_id uuid generated always as (
    coalesce(crop_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) stored,
  listing_count integer not null default 0,
  request_count integer not null default 0,
  supply_quantity numeric(12,3) not null default 0,
  demand_quantity numeric(12,3) not null default 0,
  scarcity_score numeric(8,4) not null default 0,
  abundance_score numeric(8,4) not null default 0,
  signal_payload jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint derived_supply_signals_schema_version_positive check (schema_version > 0),
  constraint derived_supply_signals_geo_precision_range check (geo_precision between 1 and 12),
  constraint derived_supply_signals_geo_precision_matches_key check (
    geo_precision = char_length(geo_boundary_key)
  ),
  constraint derived_supply_signals_geo_boundary_format check (
    geo_boundary_key ~ '^[0-9b-hjkmnp-z]{1,12}$'
  ),
  constraint derived_supply_signals_geo_boundary_normalized check (
    geo_boundary_key = lower(geo_boundary_key)
    and geo_boundary_key = btrim(geo_boundary_key)
  ),
  constraint derived_supply_signals_window_days_allowed check (window_days in (7, 14, 30)),
  constraint derived_supply_signals_counts_nonnegative check (
    listing_count >= 0 and request_count >= 0
  ),
  constraint derived_supply_signals_quantities_nonnegative check (
    supply_quantity >= 0 and demand_quantity >= 0
  ),
  constraint derived_supply_signals_scores_nonnegative check (
    scarcity_score >= 0 and abundance_score >= 0
  ),
  constraint derived_supply_signals_expiry_check check (expires_at > computed_at)
);

create unique index if not exists idx_derived_supply_signals_identity
  on derived_supply_signals (
    schema_version,
    geo_boundary_key,
    window_days,
    bucket_start,
    crop_scope_id
  );

create index if not exists idx_derived_supply_signals_geo_window_latest
  on derived_supply_signals (
    schema_version,
    window_days,
    geo_boundary_key text_pattern_ops,
    crop_scope_id,
    computed_at desc,
    id desc
  );

create index if not exists idx_derived_supply_signals_expires_at
  on derived_supply_signals (expires_at);

create or replace function upsert_derived_supply_signal(
  p_schema_version integer,
  p_geo_boundary_key text,
  p_window_days integer,
  p_bucket_start timestamptz,
  p_crop_id uuid,
  p_listing_count integer,
  p_request_count integer,
  p_supply_quantity numeric,
  p_demand_quantity numeric,
  p_scarcity_score numeric,
  p_abundance_score numeric,
  p_signal_payload jsonb,
  p_computed_at timestamptz,
  p_expires_at timestamptz
)
returns derived_supply_signals
language plpgsql
as $$
declare
  normalized_geo_key text;
  normalized_precision smallint;
  signal_row derived_supply_signals;
begin
  normalized_geo_key := lower(btrim(p_geo_boundary_key));

  if normalized_geo_key is null or normalized_geo_key = '' then
    raise exception 'geo_boundary_key is required';
  end if;

  normalized_precision := char_length(normalized_geo_key)::smallint;

  if normalized_precision < 1 or normalized_precision > 12 then
    raise exception 'geo_boundary_key must be 1-12 chars';
  end if;

  if normalized_geo_key !~ '^[0-9b-hjkmnp-z]{1,12}$' then
    raise exception 'geo_boundary_key must be a valid geohash prefix';
  end if;

  insert into derived_supply_signals (
    schema_version,
    geo_boundary_key,
    geo_precision,
    window_days,
    bucket_start,
    crop_id,
    listing_count,
    request_count,
    supply_quantity,
    demand_quantity,
    scarcity_score,
    abundance_score,
    signal_payload,
    computed_at,
    expires_at,
    created_at,
    updated_at
  )
  values (
    p_schema_version,
    normalized_geo_key,
    normalized_precision,
    p_window_days::smallint,
    p_bucket_start,
    p_crop_id,
    p_listing_count,
    p_request_count,
    p_supply_quantity,
    p_demand_quantity,
    p_scarcity_score,
    p_abundance_score,
    coalesce(p_signal_payload, '{}'::jsonb),
    p_computed_at,
    p_expires_at,
    now(),
    now()
  )
  on conflict (schema_version, geo_boundary_key, window_days, bucket_start, crop_scope_id)
  do update
    set listing_count = excluded.listing_count,
        request_count = excluded.request_count,
        supply_quantity = excluded.supply_quantity,
        demand_quantity = excluded.demand_quantity,
        scarcity_score = excluded.scarcity_score,
        abundance_score = excluded.abundance_score,
        signal_payload = excluded.signal_payload,
        computed_at = excluded.computed_at,
        expires_at = excluded.expires_at,
        updated_at = now()
  returning * into signal_row;

  return signal_row;
end;
$$;

create or replace function list_latest_derived_supply_signals(
  p_geo_boundary_prefix text,
  p_window_days integer,
  p_schema_version integer default 1,
  p_limit integer default 50,
  p_as_of timestamptz default now()
)
returns setof derived_supply_signals
language sql
stable
as $$
  select distinct on (d.geo_boundary_key, d.crop_scope_id)
    d.*
  from derived_supply_signals d
  where d.schema_version = p_schema_version
    and d.window_days = p_window_days::smallint
    and d.geo_boundary_key like lower(btrim(p_geo_boundary_prefix)) || '%'
    and d.expires_at > p_as_of
  order by
    d.geo_boundary_key,
    d.crop_scope_id,
    d.computed_at desc,
    d.id desc
  limit greatest(p_limit, 1);
$$;
