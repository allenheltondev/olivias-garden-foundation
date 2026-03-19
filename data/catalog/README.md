# Catalog Seed Artifacts

This folder contains import-ready seed artifacts for GRN crop catalog bootstrap work.

## Files

- `openfarm_crops_import.jsonl` — normalized records with provenance metadata.
- `openfarm_crops_seed.sql` — SQL upsert statements targeting `crops` table.
- `openfarm_crops_source_notes.md` — attribution and source notes.

## Generation

```bash
node scripts/catalog/build_openfarm_seed.mjs
```

Current generator source: OpenFarm archived dataset CSV (`lib/crops.csv`).

## Scope

Initial import is capped to **2,000 records** with common names + species-style scientific names to keep newbie UX manageable while still providing broad coverage.
