-- ============================
-- Extensions
-- ============================
create extension if not exists pgcrypto; -- gen_random_uuid()
create extension if not exists citext;

-- ============================
-- Enums
-- ============================
do $$ begin
  create type units_system as enum ('imperial', 'metric');
exception when duplicate_object then null; end $$;

do $$ begin
  create type visibility_scope as enum ('private', 'local', 'public');
exception when duplicate_object then null; end $$;

do $$ begin
  create type grower_crop_status as enum ('interested', 'planning', 'growing', 'paused');
exception when duplicate_object then null; end $$;

do $$ begin
  create type listing_status as enum ('active', 'pending', 'claimed', 'expired', 'completed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type request_status as enum ('open', 'matched', 'closed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type claim_status as enum ('pending', 'confirmed', 'completed', 'cancelled', 'no_show');
exception when duplicate_object then null; end $$;

do $$ begin
  create type contact_preference as enum ('app_message', 'phone', 'knock');
exception when duplicate_object then null; end $$;

do $$ begin
  create type pickup_disclosure_policy as enum ('immediate', 'after_confirmed', 'after_accepted');
exception when duplicate_object then null; end $$;

do $$ begin
  create type rating_context as enum ('as_giver', 'as_receiver');
exception when duplicate_object then null; end $$;

do $$ begin
  create type report_reason as enum ('spam', 'inappropriate', 'safety_concern', 'other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type report_status as enum ('pending', 'reviewed', 'resolved');
exception when duplicate_object then null; end $$;

-- Units for listings/requests: keep flexible as text for now.
-- If you want strictness, switch to enum later.
-- create type quantity_unit as enum ('bunch','lb','bag','each','unspecified');

-- ============================
-- Timestamp helper (optional)
-- ============================
-- You can add triggers later to maintain updated_at; starting simple here.

-- ============================
-- USERS
-- ============================
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email citext unique,
  display_name text,
  is_verified boolean not null default false,
  user_type text check (user_type in ('grower', 'gatherer')),
  onboarding_completed boolean not null default false,
  tier text not null default 'free' check (tier in ('free', 'premium')),
  subscription_status text not null default 'none' check (subscription_status in ('none', 'trialing', 'active', 'past_due', 'canceled')),
  premium_expires_at timestamptz,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_last_event_created bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_users_deleted_at on users(deleted_at);
create index if not exists idx_users_user_type on users(user_type) where user_type is not null;
create index if not exists idx_users_tier on users(tier);
create index if not exists idx_users_subscription_status on users(subscription_status);
create unique index if not exists idx_users_stripe_customer_id
  on users(stripe_customer_id)
  where stripe_customer_id is not null;
create unique index if not exists idx_users_stripe_subscription_id
  on users(stripe_subscription_id)
  where stripe_subscription_id is not null;

create table if not exists reminder_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  title text not null,
  reminder_type text not null check (reminder_type in ('watering', 'harvest', 'checkin', 'custom')),
  cadence_days integer not null check (cadence_days between 1 and 365),
  start_date date not null,
  timezone text not null default 'UTC',
  status text not null default 'active' check (status in ('active', 'paused')),
  next_run_at timestamptz not null,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_reminder_rules_user_status_next
  on reminder_rules(user_id, status, next_run_at)
  where deleted_at is null;

create table if not exists reminder_dispatches (
  id bigserial primary key,
  reminder_rule_id uuid not null references reminder_rules(id) on delete cascade,
  scheduled_for timestamptz not null,
  dispatched_at timestamptz,
  delivery_status text not null default 'queued' check (delivery_status in ('queued', 'sent', 'failed')),
  created_at timestamptz not null default now()
);

create index if not exists idx_reminder_dispatches_rule_scheduled
  on reminder_dispatches(reminder_rule_id, scheduled_for desc);

create table if not exists agent_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  schedule_cron text not null,
  instruction text not null,
  status text not null default 'active' check (status in ('active', 'paused')),
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_agent_tasks_user_status_next
  on agent_tasks(user_id, status, next_run_at)
  where deleted_at is null;

create table if not exists agent_task_runs (
  id bigserial primary key,
  agent_task_id uuid not null references agent_tasks(id) on delete cascade,
  run_status text not null check (run_status in ('queued', 'running', 'succeeded', 'failed')),
  output jsonb,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_agent_task_runs_task_created
  on agent_task_runs(agent_task_id, created_at desc);

create table if not exists ai_usage_events (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  feature_key text not null,
  model_id text not null,
  estimated_tokens integer not null default 0,
  estimated_cost_usd numeric(10, 4) not null default 0,
  status text not null check (status in ('allowed', 'blocked')),
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_usage_events_user_created
  on ai_usage_events(user_id, created_at desc);

create index if not exists idx_ai_usage_events_feature_created
  on ai_usage_events(feature_key, created_at desc);

create table if not exists premium_analytics_events (
  id bigserial primary key,
  user_id uuid references users(id) on delete set null,
  event_name text not null,
  event_source text not null default 'backend',
  metadata jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_premium_analytics_events_name_time
  on premium_analytics_events(event_name, occurred_at desc);

create index if not exists idx_premium_analytics_events_user_time
  on premium_analytics_events(user_id, occurred_at desc)
  where user_id is not null;

create table if not exists stripe_webhook_events (
  id text primary key,
  event_type text not null,
  created_unix bigint not null,
  processed_at timestamptz not null default now()
);

create table if not exists stripe_webhook_failures (
  id bigserial primary key,
  event_id text,
  event_type text,
  reason text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_stripe_webhook_failures_created_at
  on stripe_webhook_failures(created_at desc);

-- Cached rating summary (derived, but stored)
create table if not exists user_rating_summary (
  user_id uuid primary key references users(id) on delete cascade,
  avg_score numeric(3,2) not null default 0.00,
  rating_count integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint user_rating_summary_nonneg check (rating_count >= 0),
  constraint user_rating_summary_avg_range check (avg_score >= 0 and avg_score <= 5)
);

-- ============================
-- GROWER PROFILES
-- ============================
create table if not exists grower_profiles (
  user_id uuid primary key references users(id) on delete cascade,
  home_zone text, -- e.g. "8a"
  address text,
  geo_key text,   -- geohash
  lat double precision,
  lng double precision,
  share_radius_km numeric(8,3) not null default 5.000,
  units units_system not null default 'imperial',
  locale text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint grower_profiles_radius_positive check (share_radius_km > 0),
  constraint grower_profiles_address_nonempty check (address is null or length(btrim(address)) > 0),
  constraint grower_profiles_lat_lng_pair check (
    (lat is null and lng is null) or (lat is not null and lng is not null)
  )
);

create index if not exists idx_grower_profiles_geo_key on grower_profiles(geo_key);

-- ============================
-- GATHERER PROFILES
-- ============================
create table if not exists gatherer_profiles (
  user_id uuid primary key references users(id) on delete cascade,
  address text,
  geo_key text not null,
  lat double precision not null,
  lng double precision not null,
  search_radius_km numeric(8,3) not null default 10.000,
  organization_affiliation text,
  units units_system not null default 'imperial',
  locale text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint gatherer_profiles_radius_positive check (search_radius_km > 0),
  constraint gatherer_profiles_address_nonempty check (address is null or length(btrim(address)) > 0),
  constraint gatherer_profiles_lat_range check (lat >= -90 and lat <= 90),
  constraint gatherer_profiles_lng_range check (lng >= -180 and lng <= 180)
);

create index if not exists idx_gatherer_profiles_geo_key on gatherer_profiles(geo_key);

-- ============================
-- CROP KNOWLEDGE BASE
-- ============================
create table if not exists crops (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,         -- "tomato"
  common_name text not null,         -- "Tomato"
  scientific_name text,
  category text,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists crop_varieties (
  id uuid primary key default gen_random_uuid(),
  crop_id uuid not null references crops(id) on delete cascade,
  slug text not null,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (crop_id, slug)
);

create table if not exists crop_profiles (
  id uuid primary key default gen_random_uuid(),
  crop_id uuid not null references crops(id) on delete cascade,
  variety_id uuid references crop_varieties(id) on delete cascade,

  seed_depth_mm integer,
  spacing_in_row_mm integer,
  row_spacing_mm integer,

  days_to_germination_min integer,
  days_to_germination_max integer,
  days_to_maturity_min integer,
  days_to_maturity_max integer,

  sun_requirement text,
  water_requirement text,
  sow_method text,

  attributes jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (crop_id, variety_id),

  constraint crop_profiles_nonneg_mm check (
    (seed_depth_mm is null or seed_depth_mm >= 0) and
    (spacing_in_row_mm is null or spacing_in_row_mm >= 0) and
    (row_spacing_mm is null or row_spacing_mm >= 0)
  ),
  constraint crop_profiles_days_ranges check (
    (days_to_germination_min is null or days_to_germination_max is null or days_to_germination_min <= days_to_germination_max) and
    (days_to_maturity_min is null or days_to_maturity_max is null or days_to_maturity_min <= days_to_maturity_max)
  )
);

create index if not exists idx_crop_profiles_crop on crop_profiles(crop_id);
create index if not exists idx_crop_profiles_variety on crop_profiles(variety_id);

create table if not exists crop_zone_suitability (
  id uuid primary key default gen_random_uuid(),
  crop_id uuid not null references crops(id) on delete cascade,
  variety_id uuid references crop_varieties(id) on delete cascade,
  system text not null default 'USDA',
  min_zone integer,
  min_subzone char(1),
  max_zone integer,
  max_subzone char(1),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (crop_id, variety_id, system),

  constraint crop_zone_bounds_chk check (min_zone is not null or max_zone is not null),
  constraint crop_zone_subzone_chk check (
    (min_subzone is null or min_subzone in ('a','b')) and
    (max_subzone is null or max_subzone in ('a','b'))
  )
);

create index if not exists idx_crop_zone_suitability_crop on crop_zone_suitability(crop_id);

-- ============================
-- GROWER CROP LIBRARY
-- ============================
create table if not exists grower_crop_library (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  crop_id uuid not null references crops(id) on delete restrict,
  variety_id uuid references crop_varieties(id) on delete restrict,

  status grower_crop_status not null default 'interested',

  visibility visibility_scope not null default 'local',
  surplus_enabled boolean not null default false,

  nickname text,
  default_unit text, -- e.g. "lb", "bunch", "bag", "each"
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (user_id, crop_id, variety_id)
);

create index if not exists idx_grower_crop_library_user on grower_crop_library(user_id);
create index if not exists idx_grower_crop_library_crop on grower_crop_library(crop_id);

-- ============================
-- SURPLUS LISTINGS
-- ============================
create table if not exists surplus_listings (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null references users(id) on delete cascade,
  grower_crop_id uuid references grower_crop_library(id) on delete set null,

  crop_id uuid not null references crops(id) on delete restrict,
  variety_id uuid references crop_varieties(id) on delete restrict,

  title text,

  unit text, -- allow null/unspecified; app can normalize
  quantity_total numeric(12,3),
  quantity_remaining numeric(12,3),

  available_start timestamptz,
  available_end timestamptz,

  status listing_status not null default 'active',

  pickup_location_text text,
  pickup_address text,
  effective_pickup_address text,
  pickup_disclosure_policy pickup_disclosure_policy not null default 'after_confirmed',
  pickup_notes text,
  contact_pref contact_preference not null default 'app_message',

  geo_key text,
  lat double precision,
  lng double precision,

  created_at timestamptz not null default now(),
  deleted_at timestamptz,

  constraint surplus_listings_soft_delete_consistent check (
    (deleted_at is null) or (deleted_at is not null)
  ),
  constraint surplus_listings_lat_lng_pair check (
    (lat is null and lng is null) or (lat is not null and lng is not null)
  ),
  constraint surplus_listings_qty_nonneg check (
    (quantity_total is null or quantity_total >= 0) and
    (quantity_remaining is null or quantity_remaining >= 0)
  ),
  constraint surplus_listings_qty_remaining_le_total check (
    (quantity_total is null or quantity_remaining is null) or (quantity_remaining <= quantity_total)
  ),
  constraint surplus_listings_window_check check (
    (available_start is null or available_end is null) or (available_start <= available_end)
  )
);

create index if not exists idx_surplus_listings_geo on surplus_listings(geo_key);
create index if not exists idx_surplus_listings_status on surplus_listings(status);
create index if not exists idx_surplus_listings_user on surplus_listings(user_id);
create index if not exists idx_surplus_listings_available on surplus_listings(available_start, available_end);
create index if not exists idx_surplus_listings_active_geo_created_crop
  on surplus_listings (geo_key text_pattern_ops, created_at desc, crop_id)
  where deleted_at is null and status in ('active', 'pending', 'claimed');

-- Listing images
create table if not exists listing_images (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references surplus_listings(id) on delete cascade,
  url text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (listing_id, url)
);

create index if not exists idx_listing_images_listing on listing_images(listing_id);

-- ============================
-- REQUESTS
-- ============================
create table if not exists requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  crop_id uuid not null references crops(id) on delete restrict,
  variety_id uuid references crop_varieties(id) on delete restrict,

  unit text,
  quantity numeric(12,3),
  needed_by timestamptz,
  notes text,

  geo_key text,
  lat double precision,
  lng double precision,

  status request_status not null default 'open',
  created_at timestamptz not null default now(),
  deleted_at timestamptz,

  constraint requests_lat_lng_pair check (
    (lat is null and lng is null) or (lat is not null and lng is not null)
  ),
  constraint requests_qty_nonneg check (quantity is null or quantity >= 0)
);

create index if not exists idx_requests_geo on requests(geo_key);
create index if not exists idx_requests_status on requests(status);
create index if not exists idx_requests_user on requests(user_id);
create index if not exists idx_requests_open_geo_created_crop
  on requests (geo_key text_pattern_ops, created_at desc, crop_id)
  where deleted_at is null and status = 'open';

-- ============================
-- CLAIMS
-- ============================
create table if not exists claims (
  id uuid primary key default gen_random_uuid(),

  listing_id uuid not null references surplus_listings(id) on delete cascade,
  request_id uuid references requests(id) on delete set null,

  claimer_id uuid not null references users(id) on delete cascade,

  quantity_claimed numeric(12,3) not null,
  status claim_status not null default 'pending',
  notes text,

  claimed_at timestamptz not null default now(),
  confirmed_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,

  constraint claims_qty_positive check (quantity_claimed > 0)
);

create index if not exists idx_claims_listing on claims(listing_id);
create index if not exists idx_claims_request on claims(request_id);
create index if not exists idx_claims_claimer on claims(claimer_id);
create index if not exists idx_claims_status on claims(status);

-- ============================
-- RATINGS
-- ============================
create table if not exists ratings (
  id uuid primary key default gen_random_uuid(),

  claim_id uuid not null references claims(id) on delete cascade,
  rater_id uuid not null references users(id) on delete cascade,
  rated_id uuid not null references users(id) on delete cascade,

  score integer not null,
  comment text,
  context rating_context not null,

  created_at timestamptz not null default now(),

  constraint ratings_score_range check (score between 1 and 5),
  constraint ratings_unique_per_claim_context unique (claim_id, rater_id, context)
);

create index if not exists idx_ratings_rated on ratings(rated_id);
create index if not exists idx_ratings_rater on ratings(rater_id);

-- ============================
-- REPORTS
-- ============================
create table if not exists reports (
  id uuid primary key default gen_random_uuid(),

  reporter_id uuid not null references users(id) on delete cascade,
  reported_user_id uuid references users(id) on delete set null,
  listing_id uuid references surplus_listings(id) on delete set null,
  claim_id uuid references claims(id) on delete set null,

  reason report_reason not null,
  description text,
  status report_status not null default 'pending',

  created_at timestamptz not null default now(),
  resolved_at timestamptz,

  constraint reports_target_present check (
    reported_user_id is not null or listing_id is not null or claim_id is not null
  )
);

create index if not exists idx_reports_status on reports(status);
create index if not exists idx_reports_listing on reports(listing_id);
create index if not exists idx_reports_user on reports(reported_user_id);

-- ============================
-- DERIVED SUPPLY SIGNALS
-- ============================
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

-- ============================
-- Transaction-safe decrement pattern (example)
-- ============================
-- When confirming a claim, do this in a single transaction:
-- 1) lock listing row FOR UPDATE
-- 2) ensure quantity_remaining is sufficient
-- 3) update quantity_remaining
-- 4) mark claim confirmed
--
-- This logic is typically in app code, but here's a safe SQL sketch:
--
-- begin;
--   select quantity_remaining from surplus_listings where id = $listing_id for update;
--   update surplus_listings
--     set quantity_remaining = quantity_remaining - $qty
--   where id = $listing_id and (quantity_remaining is null or quantity_remaining >= $qty);
--   -- check rowcount == 1
--   update claims set status='confirmed', confirmed_at=now()
--     where id = $claim_id and status='pending';
-- commit;
