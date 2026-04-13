-- 0008_perf_cost_hardening.sql
-- Purpose: improve query latency/cost for high-frequency read/aggregation paths.

begin;

-- Worker aggregation hot path: active listings in geo prefix + time window (+ optional crop).
create index if not exists idx_surplus_listings_active_geo_created_crop
  on surplus_listings (geo_key text_pattern_ops, created_at desc, crop_id)
  where deleted_at is null and status in ('active', 'pending', 'claimed');

-- Worker aggregation hot path: open requests in geo prefix + time window (+ optional crop).
create index if not exists idx_requests_open_geo_created_crop
  on requests (geo_key text_pattern_ops, created_at desc, crop_id)
  where deleted_at is null and status = 'open';

-- Derived feed lookup: latest non-expired rows for schema/window/geo prefix.
create index if not exists idx_derived_supply_signals_lookup
  on derived_supply_signals (
    schema_version,
    window_days,
    geo_boundary_key text_pattern_ops,
    expires_at,
    computed_at desc,
    id desc
  );

commit;
