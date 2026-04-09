# Implementation Plan: Catalog Pipeline Quality

## Overview

Incremental enhancements to the existing crop data enrichment pipeline at `scripts/catalog/`. Changes modify existing files and add new sibling files — no rewrites. Tasks are ordered so foundational changes come first (config, step1) and dependent changes follow (step2 depends on step1 canonicals, step4 depends on step2 matches, etc.). All code is JavaScript (Node.js ESM `.mjs`).

## Tasks

- [x] 1. Enhance `lib/config.mjs` with new match types and scores
  - [x] 1.1 Add new match types and scores to `lib/config.mjs`
    - Add `cultivar_stripped: 0.90`, `parenthetical_common: 0.65`, `genus_match: 0.60` to `MATCH_SCORES`
    - Add `'cultivar_stripped'`, `'parenthetical_common'`, `'genus_match'` to `ENUMS.matchType`
    - Add `PATHS.generatedSql` pointing to `data/catalog/promoted_crops.sql`
    - _Requirements: 2.5, 8.1_

- [x] 2. Enhance Step 1: OpenFarm-originated canonicals
  - [x] 2.1 Add `buildOpenFarmCanonicals()` helper and second pass to `runStep1()` in `step1_canonical_identity.mjs`
    - Read `lib/openfarm-crops.csv` after the USDA pass
    - For each OpenFarm row, normalize scientific name via existing `normalizeScientificName()`
    - Skip rows lacking both parseable scientific name and common name
    - Check whether a USDA canonical already exists with that normalized scientific name
    - If no match, create an OpenFarm_Canonical with deterministic `canonical_id` (`openfarm:<normalized>` or `openfarm:common:<slug>`)
    - Set `origin: "openfarm"` on new canonicals; backfill `origin: "usda"` on USDA canonicals
    - Deduplicate by `scientific_name_normalized` — first OpenFarm row wins
    - Add `openFarmCanonicalCount` to the return summary
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [x] 2.2 Add `tests/step1_openfarm.test.mjs` for OpenFarm canonical creation
    - Test happy path: OpenFarm row with scientific name creates canonical with `origin: "openfarm"`
    - Test dedup: two OpenFarm rows with same normalized scientific name produce one canonical
    - Test skip-no-name: row with neither scientific name nor common name is skipped
    - Test deterministic IDs: same input produces same `canonical_id` across runs
    - Test common-name fallback ID: row with only common name gets `openfarm:common:<slug>` ID
    - Test USDA canonicals get `origin: "usda"` backfilled
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 7.2_

  - [x] 2.3 Write property test for OpenFarm canonical determinism (Property 1)
    - **Property 1: OpenFarm canonical determinism and uniqueness**
    - For any set of OpenFarm source records and a fixed USDA canonical set, running the OpenFarm canonical creation function twice on the same input produces identical output, and the count equals unique normalized names not in USDA set
    - Add to `tests/canonical.property.test.mjs`
    - **Validates: Requirements 1.1, 1.2, 1.5**

  - [x] 2.4 Write property test for OpenFarm canonical shape (Property 2)
    - **Property 2: OpenFarm canonical shape invariant**
    - For any OpenFarm-originated canonical, `origin` equals `"openfarm"`, and `accepted_scientific_name`, `scientific_name_normalized`, `common_names` are populated from source data
    - Add to `tests/canonical.property.test.mjs`
    - **Validates: Requirements 1.3, 1.4**

  - [x] 2.5 Write property test for no canonical without names (Property 11)
    - **Property 11: No canonical for records lacking both names**
    - For any OpenFarm source record where both `scientific_name` and `common_name` are null/empty/whitespace, no canonical is produced
    - Add to `tests/canonical.property.test.mjs`
    - **Validates: Requirements 6.3**

- [x] 3. Checkpoint — Verify Step 1 changes
  - Ensure all existing tests pass (`node --test` in `scripts/catalog/`), plus new step1_openfarm tests. Ask the user if questions arise.

- [x] 4. Enhance Step 2: Expanded match cascade
  - [x] 4.1 Add genus index to `buildIndexes()` and new match strategies to `matchRecord()` in `step2_match_sources.mjs`
    - Add `genus` index to `buildIndexes()`: `Map<string, string[]>` mapping genus token → array of canonical_ids
    - Add cultivar stripping strategy after synonym match: strip cultivar designations and retry normalized lookup, return `cultivar_stripped` with score 0.90
    - Add parenthetical common name extraction after cultivar stripping: extract parenthetical content from scientific_name field, attempt common_name lookup, return `parenthetical_common` with score 0.65
    - Add genus-level match after common_name_fallback: extract first token (genus), look up in genus index; if exactly one candidate resolve with `genus_match` score 0.60, if multiple mark `ambiguous_common_name`
    - Preserve existing cascade order: exact → normalized → synonym → **cultivar_stripped** → **parenthetical_common** → common_name_fallback → **genus_match** → fuzzy_scientific → fuzzy_common → unresolved
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 4.2 Add `tests/step2_cultivar.test.mjs` for new match strategies
    - Test cultivar stripping: scientific name with `cv. Roma` resolves via `cultivar_stripped`
    - Test cultivar stripping: quoted variety `'Brandywine'` resolves via `cultivar_stripped`
    - Test parenthetical extraction: `"Envy (apple)"` as scientific_name resolves via `parenthetical_common`
    - Test genus match unique: genus with one canonical resolves via `genus_match` with correct score
    - Test genus match ambiguous: genus with multiple canonicals returns `ambiguous_common_name`
    - Test existing cascade still works (exact, normalized, synonym, common, fuzzy, unresolved)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 7.1, 7.2_

  - [x] 4.3 Write property test for cultivar stripping recovery (Property 3)
    - **Property 3: Cultivar stripping recovers base match**
    - For any valid binomial in the canonical index, appending a cultivar designation and running through `matchRecord()` produces `cultivar_stripped` or `normalized_scientific` (not `unresolved`)
    - Add to `tests/matching.property.test.mjs`
    - **Validates: Requirements 2.2**

  - [x] 4.4 Write property test for parenthetical extraction (Property 4)
    - **Property 4: Parenthetical extraction enables common name match**
    - For any common name in the canonical index, wrapping as `"SomeName (commonName)"` in the `scientific_name` field produces a match via `parenthetical_common` (not `unresolved`)
    - Add to `tests/matching.property.test.mjs`
    - **Validates: Requirements 2.1**

  - [x] 4.5 Write property test for genus match (Property 5)
    - **Property 5: Genus match resolves unique genus, marks ambiguous multi-genus**
    - For any canonical index where a genus maps to exactly one canonical_id, a source record with that genus (non-matching species) resolves via `genus_match` with score between 0.55 and 0.7. When genus maps to multiple, result is `ambiguous_common_name`
    - Add to `tests/matching.property.test.mjs`
    - **Validates: Requirements 2.3, 2.4, 2.5**

- [x] 5. Checkpoint — Verify Step 2 changes
  - Ensure all existing tests pass plus new step2_cultivar tests. Ask the user if questions arise.

- [x] 6. Enhance Step 4: Classifier tuning
  - [x] 6.1 Modify `classifyCanonical()` in `step4_classify.mjs` for OpenFarm-originated canonicals and edible evidence
    - OpenFarm-originated canonicals (any source with `source_provider === 'openfarm'` and canonical `origin === 'openfarm'`) count as OpenFarm-supported
    - Edible evidence (`edible: true` or non-empty `edible_parts`) prevents `non_food` classification unless conifer/industrial guardrail fires
    - OpenFarm_Canonical with edible evidence from OpenFarm source → `food_crop_core` with `catalog_status: 'core'`
    - Preserve conifer and industrial guardrail checks unchanged
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 6.2 Add `tests/step4_tuned.test.mjs` for updated classification logic
    - Test OpenFarm-originated canonical with edible evidence → `food_crop_core`
    - Test edible evidence without guardrail → not `non_food`
    - Test conifer guardrail still overrides edible evidence (without strong food evidence)
    - Test industrial guardrail still overrides edible evidence (without strong food evidence)
    - Test strong food evidence overrides guardrails
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 7.2_

  - [x] 6.3 Write property test for valid relevance_class (Property 6)
    - **Property 6: Classification produces valid relevance_class**
    - For any valid array of source records, `classifyCanonical()` returns a `relevance_class` in `ENUMS.relevanceClass`
    - Add to `tests/classification.property.test.mjs`
    - **Validates: Requirements 7.3**

  - [x] 6.4 Write property test for edible-not-non_food (Property 7)
    - **Property 7: Edible evidence without guardrail prevents non_food classification**
    - For any source records with edible evidence and no conifer/industrial name patterns, `classifyCanonical()` does not return `non_food`
    - Add to `tests/classification.property.test.mjs`
    - **Validates: Requirements 3.2, 7.4**

  - [x] 6.5 Write property test for strong food evidence (Property 8)
    - **Property 8: Strong food evidence determines core vs niche**
    - For any source records with strong food evidence (≥2 providers), result is `food_crop_core` with OpenFarm support or `food_crop_niche` without, unless guardrail overrides
    - Add to `tests/classification.property.test.mjs`
    - **Validates: Requirements 3.3, 3.5**

  - [x] 6.6 Write property test for guardrail preservation (Property 9)
    - **Property 9: Guardrail preservation**
    - For any source records matching conifer/industrial patterns without strong food evidence, result is `non_food`
    - Add to `tests/classification.property.test.mjs`
    - **Validates: Requirements 3.4**

- [x] 7. Checkpoint — Verify Step 4 changes
  - Ensure all existing tests pass plus new step4_tuned tests. Ask the user if questions arise.

- [x] 8. Enhance promotion gate in `promote.mjs`
  - [x] 8.1 Modify `promotionGatePassed` logic in `promote.mjs`
    - Remove `(hasOpenFarmSupport || hasStrongFoodEvidence)` from `promotionGatePassed` — confidence band already encodes source quality
    - Keep `confidenceGatePassed` unchanged: `band === 'high' || (band === 'medium' && (hasOpenFarm || strongFood))`
    - Keep `edibleSignal` and `!guardrailBlocked` checks
    - Explicitly reject `match_confidence_band === 'low'` (already implicit, make explicit)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 8.2 Write property test for promotion gate (Property 10)
    - **Property 10: Promotion gate respects confidence bands and guardrails**
    - (a) `low` band → not promoted; (b) guardrail → not promoted; (c) `high` band + core/extended + auto_approved + edible + no guardrail → promoted; (d) `medium` band additionally requires OpenFarm or strong food evidence
    - Extend `tests/promotion.property.test.mjs`
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5**

- [x] 9. Checkpoint — Verify promotion gate changes
  - Ensure all existing tests pass (especially `promote.test.mjs` and `promotion.property.test.mjs`). Ask the user if questions arise.

- [x] 10. Add SQL generation script `generate_sql.mjs`
  - [x] 10.1 Create `generate_sql.mjs` as a new sibling file in `scripts/catalog/`
    - Export `async function generateSql({ inputPath, outputPath, batchId })`
    - Read `promoted_crops.jsonl`, emit SQL file with idempotent upserts
    - Generate `INSERT INTO crops ... ON CONFLICT (source_provider, source_record_id) DO UPDATE` for each record
    - Set `source_provider = 'pipeline_enriched'`, `source_record_id = canonical_id`
    - Derive `slug` via `slugify()` with numeric dedup suffix on collision
    - Generate `crop_profiles` INSERT only when `water_requirement`, `light_requirements` (non-empty), or `life_cycle` is present
    - Generate `crop_zone_suitability` INSERT only when `hardiness_zones` is non-empty; parse zone strings for `min_zone`/`max_zone`
    - Use `ON CONFLICT` upsert semantics for all three tables
    - Handle edge cases: empty promoted JSONL → empty SQL with header comment; null common_name → skip record with stderr warning; unparseable zone string → skip zone row
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [x] 10.2 Add `tests/generate_sql.test.mjs` for SQL generation
    - Test crops upsert: verify INSERT INTO crops with all required columns and ON CONFLICT clause
    - Test `source_provider` is `'pipeline_enriched'` and `source_record_id` is `canonical_id`
    - Test crop_profiles conditional: generated only when growing attributes present
    - Test crop_profiles not generated when no growing attributes
    - Test crop_zone_suitability conditional: generated only when hardiness_zones non-empty
    - Test zone parsing: `min_zone` ≤ `max_zone`
    - Test slug dedup: two records with same common_name get unique slugs (`-2` suffix)
    - Test empty input: produces SQL file with header comment only
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 7.2_

  - [x] 10.3 Write property test for SQL crops completeness (Property 12)
    - **Property 12: SQL generation for crops table is complete and idempotent**
    - For any promoted record with non-null `canonical_id`, `common_name`, `scientific_name`, the SQL contains INSERT INTO crops with all required columns, ON CONFLICT clause, `source_provider = 'pipeline_enriched'`, `source_record_id = canonical_id`
    - Add to `tests/sql_generation.property.test.mjs`
    - **Validates: Requirements 8.1, 8.4, 8.5**

  - [x] 10.4 Write property test for conditional crop_profiles (Property 13)
    - **Property 13: SQL generation for crop_profiles is conditional**
    - crop_profiles INSERT generated iff at least one of `water_requirement`, `light_requirements` (non-empty), or `life_cycle` is present; includes ON CONFLICT clause
    - Add to `tests/sql_generation.property.test.mjs`
    - **Validates: Requirements 8.2**

  - [x] 10.5 Write property test for conditional crop_zone_suitability (Property 14)
    - **Property 14: SQL generation for crop_zone_suitability is conditional**
    - crop_zone_suitability INSERT generated iff `hardiness_zones` is non-empty; `min_zone` ≤ `max_zone`; includes ON CONFLICT clause
    - Add to `tests/sql_generation.property.test.mjs`
    - **Validates: Requirements 8.3**

  - [x] 10.6 Write property test for slug uniqueness (Property 15)
    - **Property 15: Slug uniqueness within a batch**
    - For any set of promoted records, generated slugs are unique; duplicate common_names get numeric suffixes
    - Add to `tests/sql_generation.property.test.mjs`
    - **Validates: Requirements 8.6**

- [x] 11. Checkpoint — Verify SQL generation
  - Ensure all existing tests pass plus new generate_sql tests. Ask the user if questions arise.

- [x] 12. Final integration and benchmark validation
  - [x] 12.1 Verify all 15 existing tests still pass
    - Run `node --test` in `scripts/catalog/` and confirm all original tests pass unchanged
    - _Requirements: 7.1_

  - [x] 12.2 Run full pipeline and benchmark
    - Run `node run_pipeline.mjs --reset` followed by `node benchmark_400.mjs`
    - Verify benchmark reports `pass: true` with `promoted_pct >= 5`
    - If benchmark fails, diagnose and adjust thresholds or logic as needed
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2_

- [x] 13. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass (existing + new), benchmark passes. Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation after each pipeline step change
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- All changes are enhancements to existing files at `scripts/catalog/` — no rewrites
- Tests run via `node --test` in `scripts/catalog/`
- Pipeline runs via `node run_pipeline.mjs` in `scripts/catalog/`
