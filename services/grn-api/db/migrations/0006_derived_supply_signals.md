# 0006 Derived Supply Signals

## Purpose
Adds a derived-table entity for rolling supply/demand signals grouped by geo boundary and window.

## Geo-boundary model
- `geo_boundary_key`: normalized lowercase geohash prefix.
- Allowed format: base32 geohash characters only (`[0-9b-hjkmnp-z]`).
- `geo_precision`: derived length of `geo_boundary_key` (1-12), used to enforce explicit geographic scope.
- `geo_precision` must always equal `char_length(geo_boundary_key)`.
- Reads are prefix based to support expanding search boundaries safely.

## Versioning model
- `schema_version` is part of the identity key.
- New signal semantics should increment `schema_version` instead of mutating existing meaning.

## Cadence
- Intended update cadence: every 5 minutes per active boundary.
- Each write is idempotent through `upsert_derived_supply_signal(...)` keyed by:
  - `schema_version`
  - `geo_boundary_key`
  - `window_days`
  - `bucket_start`
  - `crop_scope_id` (`crop_id` or global zero UUID)

## Retention and TTL policy
- `expires_at` acts as TTL and is required on every row.
- Recommended retention by window:
  - `7d` window: 35 days
  - `14d` window: 49 days
  - `30d` window: 90 days
- Consumers must read with `list_latest_derived_supply_signals(...)`, which filters expired rows.
- Cleanup should periodically delete rows where `expires_at <= now()`.

## Access patterns
- Write/upsert: `upsert_derived_supply_signal(...)`
- Read latest by geo prefix/window: `list_latest_derived_supply_signals(...)`

These access patterns are replay-safe for worker retries and deterministic for read clients.
