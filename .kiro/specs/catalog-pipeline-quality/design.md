# Design Document: Catalog Pipeline Quality

## Overview

This design describes **incremental enhancements** to the existing crop data enrichment pipeline at `scripts/catalog/`. The pipeline currently runs 7 steps (step1 through step6 + promote) orchestrated by `run_pipeline.mjs`. After the OpenFarm-first hardening (#182), the 400-sample benchmark reports 0% promoted crops (threshold ≥5%) because:

1. Step 1 only builds canonical identities from USDA PLANTS — non-US species in OpenFarm have no canonical to match against, so 369/400 step2 records are `unresolved`.
2. Step 4 classification and the promotion gate require OpenFarm support on a *resolved* canonical, but since most OpenFarm records are unresolved, the gate blocks everything.

The fix is surgical: expand the canonical identity pool, widen the match cascade, tune the classifier, relax the promotion gate for high-confidence records, and add a SQL generation step. No existing files are replaced — each change modifies an existing script or adds a new sibling file.

### Design Principles

- **Enhance, don't rewrite.** Every change targets a specific function or code path in an existing file.
- **Preserve guardrails.** Conifer and industrial guardrails remain active; only food-evidence signals override them.
- **Maintain test compatibility.** All 15 existing tests must continue to pass.
- **Deterministic and idempotent.** New canonical IDs are derived deterministically; SQL uses `ON CONFLICT` upserts.

## Architecture

The pipeline architecture remains unchanged. The data flow is:

```mermaid
graph LR
  A[Step 1: Canonical Identity] --> B[Step 2: Match Sources]
  B --> C[Step 3: Normalize]
  C --> D[Step 4: Classify]
  D --> E[Step 5: Derive Fields]
  E --> F[Step 6: LLM Augment]
  F --> G[Promote]
  G --> H[generate_sql.mjs - NEW]
```

### Files Modified vs. Added

| File | Action | Summary |
|------|--------|---------|
| `step1_canonical_identity.mjs` | **Modify** | Add second pass: read OpenFarm CSV, create OpenFarm_Canonicals for unmatched species |
| `step2_match_sources.mjs` | **Modify** | Add cultivar stripping, parenthetical extraction, and genus-level match to `matchRecord()` |
| `lib/config.mjs` | **Modify** | Add new match scores for `cultivar_stripped`, `parenthetical_common`, `genus_match` |
| `step4_classify.mjs` | **Modify** | Tune `classifyCanonical()` for OpenFarm-originated canonicals and edible evidence |
| `promote.mjs` | **Modify** | Relax promotion gate: high-confidence records don't need additional OpenFarm/strong-food checks |
| `generate_sql.mjs` | **Add** | New script: reads `promoted_crops.jsonl`, emits SQL upserts for `crops`, `crop_profiles`, `crop_zone_suitability` |
| `tests/step1_openfarm.test.mjs` | **Add** | Tests for OpenFarm canonical creation |
| `tests/step2_cultivar.test.mjs` | **Add** | Tests for cultivar parsing and genus matching |
| `tests/step4_tuned.test.mjs` | **Add** | Tests for updated classification logic |
| `tests/generate_sql.test.mjs` | **Add** | Tests for SQL generation |
| `tests/classification.property.test.mjs` | **Add** | Property-based tests for classifier invariants |

## Components and Interfaces

### 1. Step 1 Enhancement: OpenFarm-Originated Canonicals

**File:** `step1_canonical_identity.mjs`

**Current behavior:** `runStep1()` reads `lib/usda-plants.txt`, builds canonical identities keyed by USDA symbol, writes to `step1_canonical_identity.jsonl`.

**Enhancement:** After the USDA pass, add a second pass that:

1. Reads `lib/openfarm-crops.csv` (the same file Step 2 already reads).
2. For each OpenFarm row, normalizes the scientific name using the existing `normalizeScientificName()` helper.
3. Checks whether a USDA canonical already exists with that normalized scientific name.
4. If no match, creates an OpenFarm_Canonical with:
   - `canonical_id`: `openfarm:<normalized_scientific_name>` (deterministic, stable across runs)
   - `origin`: `"openfarm"` (new field; USDA canonicals get `origin: "usda"` backfilled)
   - `accepted_scientific_name`: from OpenFarm source
   - `scientific_name_normalized`: normalized binomial
   - `common_names`: from OpenFarm source (split on comma)
   - `synonyms`: empty array
   - `family`: null (OpenFarm CSV doesn't include family)
5. Deduplicates by `scientific_name_normalized` — first OpenFarm row wins.
6. Skips rows that lack both a parseable scientific name and a common name.

**Key function changes:**
- `runStep1()` gains an `openfarmCrops` second pass after the USDA pass.
- A new helper `buildOpenFarmCanonicals(openfarmRows, usdaNormalizedSet)` encapsulates the logic.
- The return summary gains `openFarmCanonicalCount`.

**Deterministic ID scheme:**
```
canonical_id = "openfarm:" + normalizeScientificName(scientific_name)
```
If `scientific_name` is empty/null but `common_name` exists, fall back to:
```
canonical_id = "openfarm:common:" + slugify(common_name)
```

### 2. Step 2 Enhancement: Expanded Match Cascade

**File:** `step2_match_sources.mjs`

**Current cascade:** exact → normalized_scientific → synonym → common_name_fallback → fuzzy_scientific → fuzzy_common → unresolved

**Enhanced cascade:** exact → normalized_scientific → synonym → **cultivar_stripped** → **parenthetical_common** → common_name_fallback → **genus_match** → fuzzy_scientific → fuzzy_common → unresolved

**New match strategies in `matchRecord()`:**

#### a) Cultivar Stripping (`cultivar_stripped`)
When the normalized scientific name doesn't match, strip cultivar designations (`cv.`, `'Roma'`, quoted varieties) and retry normalized_scientific lookup. The existing `cleanToken()` already strips `cv.` — this adds an explicit re-attempt with the cleaned binomial before falling through.

Score: `0.90` (between `normalized_scientific` at 0.95 and `synonym_match` at 0.85).

#### b) Parenthetical Common Name Extraction (`parenthetical_common`)
When the scientific name field contains a parenthetical like `"Envy (apple)"`, extract the parenthetical content (`"apple"`) and attempt a common_name lookup.

Score: `0.65` (between `common_name_fallback` at 0.7 and `fuzzy_fallback` at 0.55).

#### c) Genus-Level Match (`genus_match`)
When species-level matching fails, extract the first token (genus) from the normalized scientific name and look up canonicals sharing that genus. If exactly one canonical shares the genus, resolve to it. If multiple, mark as `ambiguous_common_name`.

Score: `0.60` (between `common_name_fallback` at 0.7 and `fuzzy_fallback` at 0.55).

**Changes to `buildIndexes()`:**
- Add a `genus` index: `Map<string, string[]>` mapping genus token → array of canonical_ids.

**Changes to `lib/config.mjs`:**
- Add to `MATCH_SCORES`: `cultivar_stripped: 0.90`, `parenthetical_common: 0.65`, `genus_match: 0.60`.
- Add to `ENUMS.matchType`: `'cultivar_stripped'`, `'parenthetical_common'`, `'genus_match'`.

### 3. Step 4 Enhancement: Classifier Tuning

**File:** `step4_classify.mjs`

**Current behavior:** `classifyCanonical()` requires `hasOpenFarmSupport` (meaning an OpenFarm record matched to a USDA canonical with `match_type !== 'unresolved'`) to classify as `food_crop_core`. Without it, even edible records become `non_food` or `food_crop_niche`.

**Enhancement — three targeted changes to `classifyCanonical()`:**

1. **OpenFarm-originated canonicals count as OpenFarm-supported.** If any source record has `source_provider === 'openfarm'` (regardless of match_type), and the canonical itself has `origin === 'openfarm'`, treat `hasOpenFarmSupport = true`. This is the key unlock: OpenFarm records that created their own canonical now self-validate.

2. **Edible evidence prevents `non_food` unless guardrailed.** When any source has `edible: true` or non-empty `edible_parts`, and no conifer/industrial guardrail fires, the record cannot be classified as `non_food`. It falls to `food_crop_core` (with OpenFarm support) or `food_crop_niche` (without).

3. **OpenFarm_Canonical with edible evidence → `food_crop_core`.** When the canonical origin is `openfarm` and edible evidence exists from the OpenFarm source, classify as `food_crop_core` with `catalog_status: 'core'`.

**Guardrail preservation:** The conifer and industrial regex checks remain unchanged. They still override food evidence unless `strongFoodEvidence` (≥2 independent providers) is present.

### 4. Promotion Gate Adjustment

**File:** `promote.mjs`

**Current gate logic:**
```
confidenceGatePassed = band === 'high' || (band === 'medium' && (hasOpenFarm || strongFood))
promotionGatePassed = confidenceGatePassed && (hasOpenFarm || strongFood) && edibleSignal && !guardrail
```

**Enhanced gate logic:**
```
confidenceGatePassed = band === 'high' || (band === 'medium' && (hasOpenFarm || strongFood))
promotionGatePassed = confidenceGatePassed && edibleSignal && !guardrail
```

The change: remove the `(hasOpenFarm || strongFood)` requirement from `promotionGatePassed`. The confidence band already encodes source quality — `high` confidence means the match is reliable enough. The `edibleSignal` and `!guardrail` checks remain as safety nets.

Additionally, records with `match_confidence_band === 'low'` are explicitly rejected (no change from current behavior, but made explicit in the gate).

### 5. SQL Generation Script

**File:** `generate_sql.mjs` (new)

A standalone script that reads `promoted_crops.jsonl` and writes a SQL file with idempotent upserts.

**Interface:**
```javascript
export async function generateSql({ inputPath, outputPath, batchId } = {})
```

**SQL generation rules:**

#### `crops` table upsert
```sql
INSERT INTO crops (slug, common_name, scientific_name, category, description,
                   source_provider, source_record_id, import_batch_id, imported_at, last_verified_at)
VALUES (...)
ON CONFLICT (source_provider, source_record_id) DO UPDATE SET
  common_name = EXCLUDED.common_name,
  scientific_name = EXCLUDED.scientific_name,
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  import_batch_id = EXCLUDED.import_batch_id,
  imported_at = EXCLUDED.imported_at,
  updated_at = now();
```

- `source_provider` = `'pipeline_enriched'`
- `source_record_id` = `canonical_id`
- `slug` = derived from `common_name` via `slugify()` with numeric dedup suffix

#### `crop_profiles` table upsert
Only generated when `water_requirement`, `light_requirements`, or `life_cycle` is present.
```sql
INSERT INTO crop_profiles (crop_id, variety_id, sun_requirement, water_requirement, attributes)
VALUES ((SELECT id FROM crops WHERE source_provider = 'pipeline_enriched' AND source_record_id = $canonical_id), NULL, ...)
ON CONFLICT (crop_id, variety_id) DO UPDATE SET ...;
```

- `sun_requirement` = first element of `light_requirements` array
- `water_requirement` = `water_requirement` field
- `attributes` = JSONB with remaining enrichment fields (`life_cycle`, `edible_parts`, `field_sources`)

#### `crop_zone_suitability` table upsert
Only generated when `hardiness_zones` is non-empty.
```sql
INSERT INTO crop_zone_suitability (crop_id, variety_id, system, min_zone, max_zone)
VALUES ((SELECT id FROM crops WHERE source_provider = 'pipeline_enriched' AND source_record_id = $canonical_id), NULL, 'USDA', ...)
ON CONFLICT (crop_id, variety_id, system) DO UPDATE SET ...;
```

- `min_zone` and `max_zone` derived by parsing zone strings (e.g., `"5a"` → zone 5, `"10b"` → zone 10) and taking min/max.

**Slug generation:**
```javascript
function slugify(commonName) {
  return commonName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 96);
}
```
Deduplication: track seen slugs in a `Map`; append `-2`, `-3`, etc. on collision.

**Integration with pipeline:** `generate_sql.mjs` is a post-promote step, not part of the 7-step pipeline. It can be run standalone or wired into `run_pipeline.mjs` as an optional step 8.


## Data Models

### Canonical Identity Record (enhanced)

```jsonc
{
  "canonical_id": "LYCO2" | "openfarm:solanum lycopersicum",
  "usda_symbol": "LYCO2" | null,          // null for OpenFarm-originated
  "origin": "usda" | "openfarm",           // NEW field
  "accepted_scientific_name": "Solanum lycopersicum L.",
  "family": "Solanaceae" | null,
  "scientific_name_normalized": "solanum lycopersicum",
  "synonyms": ["lycopersicon esculentum"],
  "common_names": ["tomato"]
}
```

### Match Scores (enhanced `lib/config.mjs`)

```javascript
export const MATCH_SCORES = {
  exact_scientific: 1,
  normalized_scientific: 0.95,
  cultivar_stripped: 0.90,      // NEW
  synonym_match: 0.85,
  common_name_fallback: 0.7,
  parenthetical_common: 0.65,  // NEW
  genus_match: 0.60,           // NEW
  fuzzy_fallback: 0.55,
  ambiguous_common_name: 0.4,
  unresolved: 0,
};
```

### Promoted Record → SQL Mapping

| Promoted JSONL field | `crops` column | Notes |
|---------------------|----------------|-------|
| `common_name` | `slug` | via `slugify()` with dedup |
| `common_name` | `common_name` | direct |
| `scientific_name` | `scientific_name` | direct |
| `category` | `category` | direct |
| `description` | `description` | direct |
| (constant) | `source_provider` | `'pipeline_enriched'` |
| `canonical_id` | `source_record_id` | direct |
| `import_batch_id` | `import_batch_id` | direct |
| `imported_at` | `imported_at` | direct |
| (null) | `last_verified_at` | always null on import |

| Promoted JSONL field | `crop_profiles` column | Notes |
|---------------------|----------------------|-------|
| `light_requirements[0]` | `sun_requirement` | first element |
| `water_requirement` | `water_requirement` | direct |
| remaining fields | `attributes` | JSONB blob |

| Promoted JSONL field | `crop_zone_suitability` column | Notes |
|---------------------|-------------------------------|-------|
| `hardiness_zones` | `min_zone`, `max_zone` | parsed from zone strings |
| (constant) | `system` | `'USDA'` |

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: OpenFarm canonical determinism and uniqueness

*For any* set of OpenFarm source records and a fixed USDA canonical set, running the OpenFarm canonical creation function twice on the same input should produce identical output, and the number of canonicals created should equal the number of unique normalized scientific names (or common-name fallback keys) not already present in the USDA set.

**Validates: Requirements 1.1, 1.2, 1.5**

### Property 2: OpenFarm canonical shape invariant

*For any* OpenFarm-originated canonical record, the `origin` field must equal `"openfarm"`, and `accepted_scientific_name`, `scientific_name_normalized`, and `common_names` must be populated from the source data (non-null when the source provides them).

**Validates: Requirements 1.3, 1.4**

### Property 3: Cultivar stripping recovers base match

*For any* valid binomial scientific name present in the canonical index, appending a cultivar designation (e.g., `cv. Roma`, `'Brandywine'`) to that name and running it through `matchRecord()` should produce a match with `match_type` of `cultivar_stripped` or `normalized_scientific` (not `unresolved`).

**Validates: Requirements 2.2**

### Property 4: Parenthetical extraction enables common name match

*For any* common name present in the canonical index, wrapping it as `"SomeName (commonName)"` and passing it as the `scientific_name` field to `matchRecord()` should produce a match via `parenthetical_common` (not `unresolved`).

**Validates: Requirements 2.1**

### Property 5: Genus match resolves unique genus, marks ambiguous multi-genus

*For any* canonical index where a genus token maps to exactly one canonical_id, a source record with that genus (but a non-matching species) should resolve via `genus_match` with a score between `fuzzy_fallback` (0.55) and `common_name_fallback` (0.7). When the genus maps to multiple canonical_ids, the result should be `ambiguous_common_name`.

**Validates: Requirements 2.3, 2.4, 2.5**

### Property 6: Classification produces valid relevance_class

*For any* valid array of source records (with `source_provider`, `source_record_id`, `match_type`, `match_score`, and `normalized` fields), `classifyCanonical()` must return a `relevance_class` that is a member of `ENUMS.relevanceClass`.

**Validates: Requirements 7.3**

### Property 7: Edible evidence without guardrail prevents non_food classification

*For any* set of source records where at least one record has `normalized.edible === true` or non-empty `normalized.edible_parts`, and no record's name matches conifer or industrial patterns, `classifyCanonical()` must not return `relevance_class` of `non_food`.

**Validates: Requirements 3.2, 7.4**

### Property 8: Strong food evidence determines core vs niche

*For any* set of source records with strong food evidence (edible signals from ≥2 providers), `classifyCanonical()` must return `food_crop_core` when OpenFarm support is present, or `food_crop_niche` when OpenFarm support is absent, provided no guardrail overrides.

**Validates: Requirements 3.3, 3.5**

### Property 9: Guardrail preservation

*For any* set of source records where the combined name text matches conifer or industrial patterns and strong food evidence is absent, `classifyCanonical()` must return `relevance_class` of `non_food` regardless of other edible signals.

**Validates: Requirements 3.4**

### Property 10: Promotion gate respects confidence bands and guardrails

*For any* classified record: (a) if `match_confidence_band` is `low`, the record must not be promoted; (b) if any guardrail flag is true, the record must not be promoted; (c) if `match_confidence_band` is `high`, `catalog_status` is `core`/`extended`, `review_status` is `auto_approved`, edible evidence is present, and no guardrail is active, the record must be promoted; (d) if `match_confidence_band` is `medium`, promotion additionally requires OpenFarm support or strong food evidence.

**Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5**

### Property 11: No canonical for records lacking both names

*For any* OpenFarm source record where both `scientific_name` and `common_name` are null/empty/whitespace-only, the canonical creation function must not produce a canonical identity for that record.

**Validates: Requirements 6.3**

### Property 12: SQL generation for crops table is complete and idempotent

*For any* promoted record with non-null `canonical_id`, `common_name`, and `scientific_name`, the generated SQL must contain an `INSERT INTO crops` statement with all required columns (`slug`, `common_name`, `scientific_name`, `source_provider`, `source_record_id`, `import_batch_id`, `imported_at`, `last_verified_at`), an `ON CONFLICT (source_provider, source_record_id)` clause, `source_provider` set to `'pipeline_enriched'`, and `source_record_id` set to the `canonical_id`.

**Validates: Requirements 8.1, 8.4, 8.5**

### Property 13: SQL generation for crop_profiles is conditional

*For any* promoted record, a `crop_profiles` INSERT is generated if and only if at least one of `water_requirement`, `light_requirements` (non-empty), or `life_cycle` is present. When generated, it must include an `ON CONFLICT (crop_id, variety_id)` clause.

**Validates: Requirements 8.2**

### Property 14: SQL generation for crop_zone_suitability is conditional

*For any* promoted record, a `crop_zone_suitability` INSERT is generated if and only if `hardiness_zones` is a non-empty array. When generated, `min_zone` must be ≤ `max_zone`, and the statement must include an `ON CONFLICT` clause.

**Validates: Requirements 8.3**

### Property 15: Slug uniqueness within a batch

*For any* set of promoted records, the generated slugs must be unique — when two records share the same `common_name`, the second slug must have a numeric suffix (e.g., `-2`).

**Validates: Requirements 8.6**

## Error Handling

### Existing Error Patterns (preserved)

The pipeline already uses a consistent error pattern across all steps:
- Missing input files throw with a descriptive message (`Missing required input from Step N`)
- Checksum mismatches throw with `Input checksum mismatch for step N. Run with --reset.`
- Progress tracking enables resume after partial failures

### New Error Scenarios

| Scenario | Handling |
|----------|----------|
| OpenFarm CSV missing in Step 1 | Throw `Missing OpenFarm dataset` (same pattern as Step 2) |
| OpenFarm row with unparseable scientific name | Skip row, increment `skippedCount` in summary |
| Cultivar stripping produces empty string | Fall through to next match strategy (no error) |
| Genus index lookup returns 0 candidates | Fall through to fuzzy matching (no error) |
| SQL generation with empty promoted JSONL | Write empty SQL file with header comment only |
| SQL generation with null common_name | Skip record, log warning to stderr |
| Slug collision beyond `-99` | Throw `Slug collision limit exceeded` (defensive; unlikely in practice) |
| Zone string unparseable (e.g., "tropical") | Skip zone suitability row for that record, log warning |

### Validation

The existing `validateRecord()` in `lib/schemas.mjs` continues to validate required fields before promotion. No changes needed to the validation layer.

## Testing Strategy

### Existing Tests (15 tests, all must continue passing)

| File | Tests | Status |
|------|-------|--------|
| `step1.test.mjs` | 1 | Keep unchanged |
| `step2.test.mjs` | 3 | Keep unchanged |
| `step3.test.mjs` | existing | Keep unchanged |
| `step4.test.mjs` | 1 | Keep unchanged |
| `step5.test.mjs` | existing | Keep unchanged |
| `step6.test.mjs` | existing | Keep unchanged |
| `promote.test.mjs` | 1 | Keep unchanged |
| `promotion.property.test.mjs` | 1 | Keep unchanged |
| `e2e.fixture.test.mjs` | 1 | Keep unchanged |
| `normalize.test.mjs` | existing | Keep unchanged |
| `permapeople.test.mjs` | existing | Keep unchanged |
| `pipeline.test.mjs` | existing | Keep unchanged |

### New Unit Tests

| File | Coverage |
|------|----------|
| `tests/step1_openfarm.test.mjs` | OpenFarm canonical creation: happy path, dedup, skip-no-name, deterministic IDs, origin field |
| `tests/step2_cultivar.test.mjs` | Cultivar stripping, parenthetical extraction, genus matching (unique + ambiguous) |
| `tests/step4_tuned.test.mjs` | OpenFarm-originated canonical classification, edible override, guardrail preservation |
| `tests/generate_sql.test.mjs` | SQL generation: crops upsert, crop_profiles conditional, zone suitability conditional, slug dedup, ON CONFLICT clauses |

### New Property-Based Tests

All property tests use `fast-check` (already in `package.json` as a dependency). Each test runs a minimum of 100 iterations.

| File | Properties Covered | Tag Format |
|------|-------------------|------------|
| `tests/classification.property.test.mjs` | P6, P7, P8, P9 | `Feature: catalog-pipeline-quality, Property N: ...` |
| `tests/matching.property.test.mjs` | P3, P4, P5 | `Feature: catalog-pipeline-quality, Property N: ...` |
| `tests/canonical.property.test.mjs` | P1, P2, P11 | `Feature: catalog-pipeline-quality, Property N: ...` |
| `tests/promotion.property.test.mjs` | P10 (extend existing file) | `Feature: catalog-pipeline-quality, Property N: ...` |
| `tests/sql_generation.property.test.mjs` | P12, P13, P14, P15 | `Feature: catalog-pipeline-quality, Property N: ...` |

### Property Test Configuration

```javascript
// Each property test must:
// 1. Use fast-check with { numRuns: 100 } minimum
// 2. Reference the design property in a comment tag
// 3. Be implemented as a SINGLE property-based test per design property

// Example:
// Feature: catalog-pipeline-quality, Property 6: Classification produces valid relevance_class
test('classifyCanonical always returns valid relevance_class', async () => {
  await fc.assert(
    fc.asyncProperty(arbitrarySourceRecords, async (records) => {
      const result = classifyCanonical(records);
      assert.ok(ENUMS.relevanceClass.includes(result.relevance_class));
    }),
    { numRuns: 100 }
  );
});
```

### Dual Testing Approach

- **Unit tests** verify specific examples, edge cases (cultivar patterns, empty inputs, guardrail triggers), and integration points (SQL output format).
- **Property tests** verify universal invariants across randomized inputs (classifier enum membership, edible-not-non_food, slug uniqueness, SQL completeness).
- Both are complementary: unit tests catch concrete regressions, property tests catch unexpected input combinations.

### Benchmark Validation

After all code changes, run the full pipeline and benchmark:
```bash
cd scripts/catalog
node run_pipeline.mjs --reset
node benchmark_400.mjs
```
The benchmark must report `pass: true` with `promoted_pct >= 5`.
