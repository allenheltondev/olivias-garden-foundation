# Migration 0008 - Performance/Cost Hardening Indexes

## Purpose
Add targeted indexes for high-frequency aggregation and derived feed lookup paths to reduce p95 latency and DB CPU cost under load.

## Added indexes

- `idx_surplus_listings_active_geo_created_crop`
- `idx_requests_open_geo_created_crop`
- `idx_derived_supply_signals_lookup`

## Notes

- All indexes are additive and safe to apply online in normal migration windows.
- If index build time becomes material in larger environments, run during low-traffic windows.
