# Catalog Source Provenance + Attribution

## Why this exists
For long-term solo maintenance, catalog data must be traceable back to an external source and license. This prevents "mystery rows" and makes future re-import/re-audit work predictable.

## Provenance fields (crops + crop_varieties)
- `source_provider` (required)
- `source_record_id`
- `source_url`
- `source_license`
- `attribution_text`
- `import_batch_id`
- `imported_at`
- `last_verified_at`

## Recommended conventions
- `source_provider`: lowercase slug (`internal_seed`, `permapeople`, `usda`, etc.)
- `import_batch_id`: sortable + human-readable (`permapeople-2026-03-05-pilot`)
- `source_record_id`: immutable provider identifier when available
- `attribution_text`: UI-ready sentence when provider requires specific language

## API behavior
Public catalog endpoints now include `source_attribution` on each crop/variety so frontend can display attribution context without extra calls.

## Operational policy (solo-dev friendly)
1. Never import without `source_provider` and `import_batch_id`.
2. If licensing is unclear, leave `source_license` null and do **not** mark issue complete.
3. For every external source batch:
   - save import script/version in repo,
   - record `import_batch_id`,
   - set `imported_at`,
   - update `last_verified_at` only after confirming terms/attribution.
4. Prefer additive imports and deterministic upserts keyed by provider record IDs.
