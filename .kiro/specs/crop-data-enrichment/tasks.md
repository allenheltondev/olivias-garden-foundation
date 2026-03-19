# Implementation Plan: Crop Data Enrichment Pipeline

## Overview

A 4-source, 6-step offline catalog-building pipeline implemented as Node.js scripts in `scripts/catalog/`. Each task builds incrementally on the previous, ending with full pipeline wiring and golden fixture validation. All code is JavaScript (ESM, `.mjs`), tested with `fast-check` for property-based tests and Node.js built-in test runner.

### Decisions and Constants

- **Dependencies location**: `scripts/catalog/package.json` — isolated from the backend. Run `npm install` from `scripts/catalog/`.
- **Permapeople ingestion method**: REST API with cache-first strategy. Step 2 queries the Permapeople API per canonical plant (`POST https://permapeople.org/indexes/Plant_production/search` with body `{"hitsPerPage": 10, "q": "<search_term>"}`). Results are cached as individual JSON files in `data/catalog/permapeople/cache/` (keyed by search term). On subsequent runs, cached results are used without re-querying the API. Empty results (no hits) are also cached to avoid redundant queries. The cache directory is created at runtime, not scaffolded.
- **8 completeness fields** (for `source_confidence` `field_completeness` dimension): `scientific_name`, `common_name`, `family`, `category`, `light_requirement`, `water_requirement`, `life_cycle`, `edible_parts`.
- **Slug precedence**: Since OpenFarm data (`lib/openfarm-crops.csv`) does not include slugs, generate from `common_name` (lowercase, spaces → hyphens, strip non-alphanumeric). If no common_name, generate from `scientific_name_normalized` (spaces → hyphens).
- **Ambiguity rule**: When ambiguity exists during implementation, make the smallest conservative assumption consistent with the design doc and log it as a comment.

## Tasks

- [ ] 1. Scaffold project structure, shared libraries, and schema contracts
  - [ ] 1.1 Create directory structure and package.json for scripts/catalog
    - Create `scripts/catalog/`, `scripts/catalog/lib/`, `scripts/catalog/tests/`, `scripts/catalog/tests/fixtures/`
    - Add `scripts/catalog/package.json` with dependencies: `fast-check`, `csv-parse`, `@aws-sdk/client-bedrock-runtime`
    - Dependencies are isolated to `scripts/catalog/` — not the repo root
    - Note: `data/catalog/permapeople/cache/` is the Permapeople cache directory, created at runtime by `lib/permapeople.mjs`, not scaffolded
    - _Requirements: 1.1, 1.2, 1.3_

  - [ ] 1.2 Implement `lib/schemas.mjs` — shared record shape contracts
    - Define and export JSDoc-typed shape constants or validation functions for each pipeline record type:
      - `Canonical_Identity` (Step 1 output)
      - `Source_Match` (Step 2 output)
      - `Intermediate_Record` (Step 3 output)
      - `Classified_Crop` (Step 4 output)
      - `Canonical_Draft` (Step 5 output)
      - `Augmented_Crop` (Step 6 output)
      - `Promoted_Record` (promotion output)
      - `Progress_State`
    - Include a `validateRecord(schema, record)` helper that returns `{ valid, errors }` for runtime shape checking
    - Define the 8 completeness fields as an exported constant: `COMPLETENESS_FIELDS = ['scientific_name', 'common_name', 'family', 'category', 'light_requirement', 'water_requirement', 'life_cycle', 'edible_parts']`
    - _Requirements: 9.6, 12.2_

  - [ ] 1.3 Implement `lib/config.mjs` — central configuration
    - Define all file paths (input/output per step, progress files, source file locations including `lib/usda-plants.txt` and `lib/openfarm-crops.csv`)
    - Define enum constants: match types, relevance classes, catalog statuses, edibility statuses, review statuses, category values
    - Define default thresholds: match scores, batch sizes, retry config
    - Define Permapeople API config:
      - Endpoint URL: `https://permapeople.org/indexes/Plant_production/search`
      - Default `hitsPerPage`: 10
      - Inter-request delay: 500ms (between actual API calls, not cache hits)
      - Retry config: 3 attempts with exponential backoff (2s, 4s, 8s)
      - Rate-limit backoff: 30s for HTTP 429
      - Cache directory path: `data/catalog/permapeople/cache/`
    - _Requirements: 1.1, 1.2, 1.3, 1.8, 8.1, 11.8_

  - [ ] 1.4 Implement `lib/io.mjs` — JSONL and file I/O utilities
    - `readJsonl(path)` → async generator yielding parsed objects
    - `appendJsonl(path, records)` → atomic batch append of serialized records
    - `computeChecksum(path)` → SHA-256 hex digest
    - `readQuotedCsv(path)` → async generator yielding parsed rows from quoted CSV (for USDA PLANTS file)
    - `readHeaderlessCsv(path, columns)` → async generator yielding parsed rows from headerless CSV (for OpenFarm file)
    - `deduplicateJsonl(path, keyFn)` → deduplicate output file by key function
    - _Requirements: 2.5, 8.12, 9.6_

  - [ ] 1.5 Write property test for JSONL round-trip (Property 4)
    - **Property 4: JSONL output round-trip**
    - Generate random JSON objects → serialize via `appendJsonl` → read back via `readJsonl` → verify equivalence
    - **Validates: Requirements 2.5, 9.6**

  - [ ] 1.6 Implement `lib/progress.mjs` — resumability state management
    - `readProgress(step)` → progress object or null
    - `writeProgress(step, index, checksum)` → persists state
    - `verifyChecksum(step, currentChecksum)` → throws on mismatch
    - `resetProgress(step)` → deletes progress file and output file
    - _Requirements: 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_

  - [ ] 1.7 Implement `lib/normalize.mjs` — shared normalization functions
    - `isSentinel(value)` → true for "not specified", "N/A", empty, whitespace-only
    - `normalizeToNull(value)` → returns null if sentinel, trimmed string otherwise
    - `normalizeToArray(csvString)` → splits comma-separated to lowercase token array
    - `normalizeBool(value)` → parses "true"/"false" strings to boolean
    - `parseZoneArray(zoneString)` → parses "3-9" or "3,4,5" to integer array
    - `normalizeWaterRequirement(raw)` → maps freeform to `low`|`moderate`|`high`
    - `normalizeLightRequirement(raw)` → maps freeform to enum tokens
    - `normalizeScientificName(raw)` → lowercase, strip authority text after binomial
    - _Requirements: 4.4, 4.7, 11.2, 11.3, 11.4, 11.5, 13.5_

  - [ ] 1.8 Write property test for normalization sentinel elimination (Property 6)
    - **Property 6: Normalization sentinel elimination and type coercion**
    - Generate random strings including sentinels, comma-separated values, boolean strings, zone ranges → verify normalization output: no sentinels in output, correct type coercion, raw preserved
    - **Validates: Requirements 4.4, 4.7, 11.2, 11.3, 11.4, 11.5, 13.5**

  - [ ]* 1.9 Write unit tests for normalization functions
    - Test specific examples: "Not specified" → null, "Full sun, Partial sun/shade" → `["full_sun", "partial_shade"]`, "true" → true, "3-9" → [3,4,5,6,7,8,9]
    - Test edge cases: empty string, whitespace-only, "N/A", mixed case sentinels
    - _Requirements: 4.4, 11.2, 11.3, 11.4, 11.5_

  - [ ] 1.10 Implement `lib/permapeople.mjs` — Permapeople API client + local cache
    - `searchPlant(scientificName, config)` → cache-first search by scientific name. Returns cached result if available; otherwise queries the API, caches the response, and returns it.
    - `searchPlantByCommonName(commonName, config)` → fallback search by common name when scientific name search yields no results. Same cache-first strategy.
    - `readCache(searchTerm, config)` → read from local cache (returns cached result or null). Cache files stored as individual JSON files in `data/catalog/permapeople/cache/`, keyed by URL-safe filename derived from the search term (e.g., `solanum_lycopersicum.json`).
    - `writeCache(searchTerm, result, config)` → write to local cache, including negative results (empty hits) so the pipeline does not re-query plants with no Permapeople data on subsequent runs.
    - `getCacheStats(config)` → return `{ hits, misses, total }` for the current run.
    - API call: `POST https://permapeople.org/indexes/Plant_production/search` with body `{"hitsPerPage": 10, "q": "<search_term>"}`
    - Rate limiting: configurable inter-request delay (default 500ms) applied only between actual API calls, not cache hits
    - Retry: exponential backoff for failures (3 attempts: 2s, 4s, 8s). HTTP 429 → back off 30s then retry. HTTP 5xx → retry with backoff. HTTP 4xx (other than 429) → log error, cache negative result, skip. Malformed response → log error, skip.
    - Ensure cache directory exists before writing (create at runtime via `fs.mkdir` with `recursive: true`)
    - _Requirements: 1.2, 1.3, 1.4, 1.10, 11.8_

  - [ ]* 1.11 Write property test for Permapeople cache round-trip (Property 1 — cache portion)
    - **Property 1 (cache): Permapeople cache round-trip**
    - Generate random Permapeople API response objects → write to cache via `writeCache` → read back via `readCache` → verify equivalence. Also verify negative results (empty hits) round-trip correctly.
    - **Validates: Requirements 1.2, 1.3, 1.4**

- [ ] 2. Create happy-path golden fixture dataset
  - [ ] 2.1 Create happy path fixture dataset
    - Create `scripts/catalog/tests/fixtures/happy_path/` with:
      - `usda-plants.txt`: Quoted CSV in the same format as `lib/usda-plants.txt` with 5 accepted USDA taxa (e.g., tomato, basil, carrot, lettuce, bean) with realistic synonyms. Columns: Symbol, Synonym Symbol, Scientific Name with Author, Common Name, Family. Accepted taxa have empty Synonym Symbol; synonyms have populated Synonym Symbol.
      - `permapeople/cache/`: Individual cached JSON files (e.g., `solanum_lycopersicum.json`, `ocimum_basilicum.json`) containing realistic Permapeople API responses with some sentinel values. Each file represents a cached API response for one search term.
      - `openfarm-crops.csv`: Headerless 2-column CSV (scientific name, common name) matching the same taxa, in the same format as `lib/openfarm-crops.csv`
    - Include expected output snapshots for each step (`step1_expected.jsonl` through `step6_expected.jsonl`) and `promoted_expected.jsonl`
    - This fixture is the primary development dataset — use it to stabilize each step as it is built
    - _Requirements: 9.1, 9.5_

- [ ] 3. Checkpoint — Ensure all shared library tests pass

- [ ] 4. Implement Step 1 — Build Canonical Plant Identity Table
  - [ ] 4.1 Implement `step1_canonical_identity.mjs`
    - Parse `lib/usda-plants.txt` as a single quoted-CSV file with columns: Symbol, Synonym Symbol, Scientific Name with Author, Common Name, Family
    - Identify accepted taxa: rows where Synonym Symbol is empty (these have populated Common Name and Family)
    - Identify synonyms: rows where Synonym Symbol is populated (the Symbol column is the accepted symbol, Synonym Symbol is the synonym's own symbol)
    - Build synonym chains mapping synonym scientific names to accepted symbols
    - Produce one `Canonical_Identity` record per accepted taxon with: `canonical_id`, `usda_symbol`, `accepted_scientific_name`, `family`, `scientific_name_normalized`, `synonyms[]`, `common_names[]`
    - Validate output records against `Canonical_Identity` schema from `lib/schemas.mjs`
    - Build in-memory lookup indexes: by scientific name, normalized scientific name, synonym, common name, USDA symbol
    - Write JSONL output, log summary (total identities, synonyms indexed, common names indexed)
    - Support resumability via progress state, `--reset`, `--dry-run`, `--limit N`
    - Verify `lib/usda-plants.txt` exists before processing; exit with clear error if missing
    - _Requirements: 1.1, 1.6, 1.7, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 8.1, 8.2, 8.7, 8.8, 8.9, 8.10, 8.11_

  - [ ] 4.2 Validate Step 1 against happy-path fixture
    - Run Step 1 against `fixtures/happy_path/usda-plants.txt`
    - Compare output to `step1_expected.jsonl`
    - Fix any discrepancies before proceeding
    - _Requirements: 9.1, 9.5_

  - [ ]* 4.3 Write property test for canonical identity completeness (Property 3)
    - **Property 3: Canonical identity completeness and synonym resolution**
    - Generate random USDA taxa with synonyms (in the single-file quoted-CSV format) → run Step 1 logic → verify one Canonical_Identity per accepted taxon, all required fields present, synonym chains resolve to exactly one accepted name
    - **Validates: Requirements 2.2, 2.3, 2.4**

  - [ ]* 4.4 Write property test for USDA lookup round-trip (Property 1 — USDA portion)
    - **Property 1 (USDA): Source file lookup round-trip**
    - Generate random USDA records → build index → lookup by each indexed field (scientific name, normalized name, common name, synonym, symbol) → verify correct record returned
    - **Validates: Requirements 1.7**

  - [ ]* 4.5 Write unit tests for Step 1
    - Test quoted-CSV parsing with known USDA data samples (single file format)
    - Test accepted taxon identification (empty Synonym Symbol)
    - Test synonym chain resolution (Synonym Symbol → accepted Symbol)
    - Test scientific name normalization (authority stripping)
    - Test error: missing `lib/usda-plants.txt` file
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [ ] 5. Implement Step 2 — Fetch Permapeople Data and Match External Records to Canonical Identity
  - [ ] 5.1 Implement `step2_match_sources.mjs`
    - Read Step 1 output and build lookup indexes
    - **Fetch Permapeople data per canonical identity (cache-first):**
      - For each `Canonical_Identity` from Step 1, search Permapeople using `searchPlant(scientific_name_normalized, config)` via `lib/permapeople.mjs`
      - If no results, fall back to `searchPlantByCommonName(common_names[0], config)`
      - Collect all Permapeople results for matching
      - Log cache hit/miss stats in the summary
    - Read OpenFarm CSV (`lib/openfarm-crops.csv`) — headerless 2-column CSV (scientific name, common name). Note: OpenFarm only provides scientific_name and optional common_name (no slug, no other fields).
    - **Match all source records:** For each Permapeople result and each OpenFarm record, apply matching cascade against the canonical identity table:
      - exact scientific → normalized scientific → synonym → common-name fallback → unresolved
    - Assign match scores: exact=1.0, normalized=0.95, synonym=0.85, common_name_fallback=0.7, ambiguous=0.4, unresolved=0.0
    - Handle ambiguous common names: multiple candidates → `ambiguous_common_name`, canonical_id null, candidates populated
    - Produce one `Source_Match` record per source record, validated against schema
    - Write JSONL output, log summary (matched per source, counts per match type, unresolved count, cache hits, cache misses)
    - Support resumability, `--reset`, `--dry-run`, `--limit N`
    - Verify Step 1 output exists; exit with clear error if missing
    - _Requirements: 1.2, 1.3, 1.4, 1.7, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 8.1, 8.11_

  - [ ] 5.2 Validate Step 2 against happy-path fixture
    - Run Step 2 against happy-path fixture inputs (uses `permapeople/cache/` fixture files instead of live API)
    - Compare output to `step2_expected.jsonl`
    - Fix any discrepancies before proceeding
    - _Requirements: 9.1, 9.5_

  - [ ] 5.3 Write property test for matching cascade correctness (Property 5)
    - **Property 5: Matching cascade correctness and score consistency**
    - Generate random source records with known scientific names, synonyms, common names → run matching → verify correct match_type and score assigned, ambiguous cases handled, unresolved cases scored 0.0
    - **Validates: Requirements 3.5, 3.7, 3.8, 3.9, 3.10**

  - [ ]* 5.4 Write unit tests for Step 2
    - Test each cascade level with specific examples
    - Test ambiguous common name detection (multiple canonical matches)
    - Test unresolved record handling
    - Test exact-only common name matching (no fuzzy)
    - Test Permapeople cache-first flow (cache hit skips API, cache miss queries API and caches result)
    - _Requirements: 3.5, 3.8, 3.9, 3.10_

- [ ] 6. Checkpoint — Ensure Steps 1-2 and all tests pass

- [ ] 7. Implement Step 3 — Normalize Source Attributes
  - [ ] 7.1 Implement `step3_normalize.mjs`
    - Read Step 2 output and corresponding raw source records
    - For Permapeople records: look up raw source data from the Permapeople cache (`data/catalog/permapeople/cache/`) using the cached JSON files, not a snapshot file
    - For OpenFarm records: look up raw source data from the OpenFarm CSV (`lib/openfarm-crops.csv`). Note: OpenFarm only provides scientific_name and common_name, so normalization is minimal.
    - For each Source_Match, produce Intermediate_Record with `raw.*` and `normalized.*` fields
    - Apply Permapeople normalization rules: sentinels → null, CSV → arrays, booleans, zones, water/light enums, warnings/utility tokens, external links
    - Apply OpenFarm normalization with equivalent rules (minimal — only scientific_name and common_name available)
    - Preserve raw payload unchanged alongside normalized values
    - Validate output records against `Intermediate_Record` schema
    - Write JSONL output, log summary (records per source, field population rates, normalization warnings)
    - Support resumability, `--reset`, `--dry-run`, `--limit N`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8_

  - [ ] 7.2 Validate Step 3 against happy-path fixture
    - Run Step 3 against happy-path fixture inputs
    - Compare output to `step3_expected.jsonl`
    - Fix any discrepancies before proceeding
    - _Requirements: 9.1, 9.5_

  - [ ]* 7.3 Write unit tests for Step 3
    - Test Permapeople normalization with specific field examples
    - Test OpenFarm normalization (scientific_name and common_name only)
    - Test warning token extraction
    - Test utility token extraction
    - Test external link preservation
    - _Requirements: 4.4, 4.5, 4.6, 11.1, 11.6_

- [ ] 8. Implement Step 4 — Classify Relevance (split into merge + classify phases)
  - [ ] 8.1 Implement Step 4 Phase A: Merge source records by canonical_id
    - Read Step 3 output and Step 1 canonical identity table
    - Group source records by `canonical_id`
    - Create merged crop objects with `sources` keyed by provider (each provider key contains an array of Intermediate_Records)
    - Keep unresolved records as separate entries with `canonical_id: null`
    - Attach `canonical_identity` object from Step 1 to each merged crop
    - Write intermediate merged output (or keep in memory for Phase B)
    - _Requirements: 5.1, 8.1, 8.2_

  - [ ] 8.2 Implement Step 4 Phase B: Apply classification, scoring, and review logic
    - Apply classification rule hierarchy: weed/invasive → industrial → ornamental edible → core food families → single-source edible → multi-source food → medicinal → default non_food
    - Derive state fields: `catalog_status`, `edibility_status`, `review_status`, `source_confidence`, `source_agreement_score`, `classification_reason`
    - Compute `source_confidence` using weighted formula:
      - match_score × 0.30
      - source_count × 0.20 (1 source → 0.3, 2+ sources → 1.0)
      - field_completeness × 0.20 (count of non-null fields from `COMPLETENESS_FIELDS` / 8)
      - warning_penalty × 0.15 (0 warnings → 1.0, each warning -0.1, floor 0.0)
      - heuristic_penalty × 0.15 (1.0 if strong match, 0.5 if common-name-only or single-source-edible)
    - Compute `source_agreement_score` as mean of applicable dimension scores
    - Apply `review_status` rules: auto_approved (confidence ≥ 0.7 AND agreement ≥ 0.6 AND no conflicts AND core/extended), needs_review (low confidence/agreement or conflicts), rejected (excluded AND weed_or_invasive/non_food)
    - Validate output records against `Classified_Crop` schema
    - Write all records (no drops) to JSONL output, log summary
    - Support resumability, `--reset`, `--dry-run`, `--limit N`
    - _Requirements: 5.2–5.16, 8.1, 8.2, 9.7, 13.3, 13.6, 13.7_

  - [ ] 8.3 Validate Step 4 against happy-path fixture
    - Run Step 4 against happy-path fixture inputs
    - Compare output to `step4_expected.jsonl`
    - Fix any discrepancies before proceeding
    - _Requirements: 9.1, 9.5_

  - [ ] 8.4 Write property test for derived state field consistency (Property 10)
    - **Property 10: Derived state field consistency**
    - Generate random classified crops → verify catalog_status derived correctly from relevance_class, source_confidence and source_agreement_score in [0.0, 1.0], review_status derived correctly from thresholds
    - **Validates: Requirements 5.11, 5.12, 5.13**

  - [ ]* 8.5 Write property test for classification invariants (Property 8)
    - **Property 8: Classification invariants and weed/invasive precedence**
    - Generate random crop signal combinations → verify exactly one relevance_class assigned, weed/invasive warnings always produce `weed_or_invasive`, industrial utility without food confirmation produces `industrial_crop`
    - **Validates: Requirements 5.2, 5.5, 5.9, 5.10**

  - [ ]* 8.6 Write property test for single-source edible claim (Property 9)
    - **Property 9: Single-source edible claim insufficient for core food status**
    - Generate random crops where only Permapeople marks edible with no other food signals → verify NOT classified as `food_crop_core`, companion/antagonist data does not influence classification
    - **Validates: Requirements 5.4, 10.6, 11.7, 11.9, 13.6**

  - [ ]* 8.7 Write property test for record count invariants (Property 7)
    - **Property 7: Record count invariants and no silent drops**
    - Generate random input sets → run through Steps 1–4 logic → verify output counts match expected grain at each step, no records silently dropped
    - **Validates: Requirements 5.15, 9.1, 9.2, 9.5, 9.7, 13.3, 13.7**

  - [ ]* 8.8 Write unit tests for Step 4
    - Test Abutilon theophrasti → `weed_or_invasive` despite edible flag
    - Test source_confidence formula with known inputs
    - Test source_agreement_score with known inputs
    - Test review_status threshold logic
    - Test merge algorithm (grouping by canonical_id)
    - _Requirements: 5.2, 5.5, 5.9, 5.11, 5.12, 5.13_

- [ ] 9. Checkpoint — Ensure Steps 1-4 and all tests pass


- [ ] 10. Implement Step 5 — Derive Canonical App Fields
  - [ ] 10.1 Implement `step5_derive_fields.mjs`
    - Read Step 4 output
    - Apply source precedence rules: scientific_name from USDA, common_name from OpenFarm→Permapeople→USDA, family from USDA, light/water from Permapeople→OpenFarm, life_cycle/edible_parts from Permapeople, hardiness_zones for perennials only
    - Apply deterministic category derivation rules (family-based → edible-parts-based → relevance-based → null fallback for LLM)
    - Detect common name mismatches (OpenFarm name refers to different genus → flag for review)
    - Build `field_sources` map tagging every populated field with its source
    - Leave fields as null when no source provides confident data
    - Carry forward all records including excluded
    - Validate output records against `Canonical_Draft` schema
    - Write JSONL output, log summary (field population rates, records with no common_name)
    - Support resumability, `--reset`, `--dry-run`, `--limit N`
    - _Requirements: 6.1–6.9, 10.1, 10.7_

  - [ ] 10.2 Validate Step 5 against happy-path fixture
    - Run Step 5 against happy-path fixture inputs
    - Compare output to `step5_expected.jsonl`
    - Fix any discrepancies before proceeding
    - _Requirements: 9.1, 9.5_

  - [ ]* 10.3 Write property test for source precedence (Property 11)
    - **Property 11: Source precedence for canonical app fields**
    - Generate random multi-source crop data → verify correct field selected per precedence rules, null when no source provides value, every non-null field has field_sources entry
    - **Validates: Requirements 6.2, 6.4, 6.5, 10.1**

  - [ ]* 10.4 Write unit tests for Step 5
    - Test deterministic category derivation (Solanaceae → nightshade, Cucurbitaceae → cucurbit, etc.)
    - Test common name mismatch detection
    - Test hardiness zone exclusion for annuals
    - Test field_sources map population
    - _Requirements: 6.2, 6.3, 6.5_

- [ ] 11. Implement Step 6 — LLM Augmentation
  - [ ] 11.1 Implement `lib/bedrock.mjs` — Bedrock client
    - `augmentBatch(crops, config)` → sends prompt, validates response schema, returns augmented records
    - Exponential backoff retry (3 retries, 5s initial backoff)
    - JSON schema validation of every response before merge
    - Configurable batch size (default 50) and inter-batch delay (default 2s)
    - Anti-hallucination guardrail in prompt: "Do not invent unsupported agronomic specifics or suitability claims not present in the provided data."
    - _Requirements: 7.2, 7.10, 7.11, 7.12, 10.4, 10.5_

  - [ ] 11.2 Implement `step6_llm_augment.mjs`
    - Read Step 5 output
    - Process only records with `catalog_status` of `core` or `extended`
    - Send batches to Bedrock with crop context in prompt
    - Merge LLM responses: description fills null only, category fills null only, display_notes and review_notes stored
    - Tag LLM fields in `field_sources` as `llm_description`, `llm_category`, `llm_display_notes`, `llm_review_notes`
    - Source-backed values NEVER overwritten by LLM output
    - Carry forward excluded/hidden records unchanged
    - Handle failures: log failed crop IDs, skip batch, continue
    - Validate output records against `Augmented_Crop` schema
    - Write JSONL output, log summary
    - Support resumability, `--reset`, `--dry-run`, `--limit N`
    - _Requirements: 7.1–7.16, 10.4, 10.5, 13.2_

  - [ ] 11.3 Write property test for LLM merge safety (Property 12)
    - **Property 12: LLM augmentation does not override source-backed data**
    - Generate random Step 5 records with some non-null fields, simulate LLM responses → verify all source-backed fields unchanged, excluded/hidden records pass through unchanged, invalid LLM responses rejected
    - **Validates: Requirements 7.1, 7.7, 7.8, 7.9, 7.12, 7.14, 10.5, 13.2**

  - [ ]* 11.4 Write unit tests for Step 6 and Bedrock client
    - Test prompt construction with specific crop data
    - Test response schema validation (valid and invalid examples)
    - Test merge rules: LLM fills null description, LLM does not override existing category
    - Test retry behavior on simulated failures
    - _Requirements: 7.2, 7.8, 7.9, 7.12_

- [ ] 12. Implement Promotion Step
  - [ ] 12.1 Implement `promote.mjs`
    - Read Step 6 output
    - Filter promotion-eligible records: `catalog_status` in (core, extended), `review_status` = `auto_approved`, validation passes
    - Map promoted records to target DB schema: `crop` fields, `crop_profile` fields, `crop_zone_suitability` (perennials only)
    - v1 does NOT populate `crop_varieties` — deferred
    - v1 `crop_profiles` populates: `sun_requirement`, `water_requirement`, `attributes` JSONB only — no spacing/germination/maturity fields
    - v1 `crop_zone_suitability` only for perennials/trees/shrubs with zone data, system always "USDA"
    - Slug generation: generate from common_name (lowercase, hyphens); fallback to scientific_name_normalized. Note: OpenFarm CSV does not include slugs.
    - Generate `import_batch_id` in format `catalog_YYYYMMDD_HHmmss`, set `last_verified_at` to null
    - Validate output records against `Promoted_Record` schema
    - Write `promoted_crops.jsonl`, review queue files, and `review_report.md`
    - Records that fail promotion validation are written to a `review_queue_validation_failures.jsonl` — this is a promotion-stage outcome, not a Step 4 review_status change
    - Log summary
    - _Requirements: 12.1–12.9_

  - [ ] 12.2 Validate promotion against happy-path fixture
    - Run promote against happy-path fixture Step 6 output
    - Compare output to `promoted_expected.jsonl`
    - Fix any discrepancies before proceeding
    - _Requirements: 9.1, 12.1_

  - [ ]* 12.3 Write property test for promotion partitioning (Property 14)
    - **Property 14: Promotion and review queue partitioning**
    - Generate random Step 6 output → verify promotion file contains exactly eligible crops, review queues correctly partitioned, import_batch_id format correct, last_verified_at null
    - **Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7**

  - [ ]* 12.4 Write unit tests for promote.mjs
    - Test promotion file schema mapping for a specific crop
    - Test slug generation (common_name-based, scientific_name fallback)
    - Test crop_zone_suitability only for perennials
    - Test review report generation
    - _Requirements: 12.2, 12.3, 12.8_

- [ ] 13. Implement CLI entry point and pipeline wiring
  - [ ] 13.1 Implement `run_pipeline.mjs` — CLI entry point
    - Parse CLI args: `--step <1-6|promote>`, `--reset`, `--dry-run`, `--limit N`
    - Validate preconditions: source files exist, predecessor output exists
    - Delegate to the appropriate step module's `run()` function
    - Each step module exports: `async function run({ reset, dryRun, limit, config }) → { summary }`
    - _Requirements: 8.1, 8.8, 8.9, 8.10, 8.11_

  - [ ] 13.2 Write property test for resumability correctness (Property 13)
    - **Property 13: Resumability correctness**
    - Generate random input → run step to completion vs. multiple invocations with interruptions → verify same final output, valid progress state, --limit N caps records
    - **Validates: Requirements 8.2, 8.3, 8.4, 8.10, 8.12**

  - [ ]* 13.3 Write property test for identifier traceability (Property 15)
    - **Property 15: Consistent identifier traceability**
    - Generate random records → run through pipeline → verify canonical_id (or source_provider+source_record_id for unresolved) traceable from first appearance through all step outputs
    - **Validates: Requirements 9.3**

  - [ ]* 13.4 Write unit tests for CLI entry point
    - Test argument parsing (valid and invalid args)
    - Test precondition validation (missing source files, missing predecessor output)
    - Test --reset and --dry-run flag behavior
    - _Requirements: 8.1, 8.8, 8.9, 8.11_

- [ ] 14. Create remaining fixture datasets and end-to-end tests
  - [ ] 14.1 Create edge cases fixture dataset
    - Create `scripts/catalog/tests/fixtures/edge_cases/` with:
      - `usda-plants.txt`: Quoted CSV with edge case taxa (same format as `lib/usda-plants.txt`)
      - `permapeople/cache/`: Individual cached JSON files for edge case plants — ambiguous common names, weed/invasive examples (Abutilon theophrasti), single-source edibles, sentinel-heavy records
      - `openfarm-crops.csv`: Headerless 2-column CSV (scientific name, common name) for edge case taxa
    - Include expected output snapshots
    - _Requirements: 5.5, 5.9, 9.1, 11.2_

  - [ ] 14.2 Create multi-source conflict fixture dataset
    - Create `scripts/catalog/tests/fixtures/conflicts/` with:
      - `usda-plants.txt`: Quoted CSV with conflict taxa (same format as `lib/usda-plants.txt`)
      - `permapeople/cache/`: Individual cached JSON files where Permapeople data disagrees with other sources on edibility, life cycle, or common name
      - `openfarm-crops.csv`: Headerless 2-column CSV with conflicting data
    - Include expected output snapshots
    - _Requirements: 5.12, 5.13, 5.16_

  - [ ] 14.3 Write end-to-end tests using golden fixtures
    - Run full pipeline against each fixture dataset (happy_path, edge_cases, conflicts)
    - Assert exact match against expected output snapshots
    - Verify promotion output, review queues, and review report
    - _Requirements: 9.1, 9.5, 9.6, 12.1_

- [ ] 15. Final checkpoint — Ensure all tests pass

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Required property tests (not marked `*`): JSONL round-trip (1.5), normalization (1.8), matching cascade (5.3), derived-state consistency (8.4), LLM merge safety (11.3), resumability (13.2), end-to-end golden fixture (14.3)
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- The pipeline is JavaScript ESM (`.mjs`) using Node.js built-in test runner and `fast-check`
- All intermediate outputs are JSONL in `data/catalog/`
- Permapeople data is fetched via REST API per-plant with local caching in `data/catalog/permapeople/cache/` — there is no bulk download script
- v1 operates at species/canonical level — no variety support
- `crop_zone_suitability` only populated for perennials with zone data
- When ambiguity exists during implementation, make the smallest conservative assumption consistent with the design doc and log it as a comment
