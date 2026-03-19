# Requirements Document

## Introduction

The platform's `crops` table contains 2,000 records imported from OpenFarm, but only `slug`, `common_name`, and `scientific_name` are populated. All other columns are NULL/empty, and the related tables (`crop_profiles`, `crop_varieties`, `crop_zone_suitability`) are completely empty.

This feature builds a 4-source, 6-step offline catalog-building pipeline that layers data from USDA PLANTS (taxonomic identity backbone), Permapeople REST API (practical gardening/permaculture enrichment, queried per-plant with local caching), OpenFarm (home gardener framing), and Amazon Bedrock LLM (interpretation and presentation). Each source has a defined trust level and role. The pipeline never discards records — excluded crops are retained with a reason code for full audit trail. The guiding principle is sparse-but-trustworthy over full-but-wobbly.

The pipeline is developer-run, not a runtime service. Each step is independently runnable, reads its predecessor's output, writes to `data/catalog/`, and supports resumability via persisted progress state. Output targets the existing PostgreSQL tables: `crops`, `crop_profiles`, `crop_varieties`, and `crop_zone_suitability`.

### Source Roles and Trust Levels

| Source | Role | Trust Level |
|---|---|---|
| USDA PLANTS | Taxonomic identity backbone: accepted scientific names, synonym resolution, common-name validation, family, symbol-based canonical identity | HIGH for identity |
| Permapeople API | Practical gardening/permaculture enrichment via REST API queries: edible flags, edible parts, light/water/soil, life cycle, habit/layer, alternate names, external cross-links, companions/antagonists, USDA hardiness zones, warnings, utility. Queried per-plant using canonical identities from Step 1, with all results cached locally | MEDIUM for guidance, LOW-MEDIUM for relevance decisions |
| OpenFarm | Home gardener framing: beginner-oriented crop concepts, spacing/planting guidance where present, novice-friendly naming | MEDIUM for practical growing data, inconsistent coverage |
| Amazon Bedrock LLM | Interpretation layer: concise descriptions, category normalization, conflict resolution, relevance classification support, review notes. Used ONLY after source-backed data exists | LOW for raw facts, HIGH for summarization/normalization |

### Pipeline Steps Overview

1. Build canonical plant identity table from USDA PLANTS
2. Fetch Permapeople data for canonical plants (cache-first API queries) and match all external records to canonical identity
3. Normalize source attributes into a common intermediate schema
4. Compute relevance classification from multi-source signals
5. Derive canonical app fields from precedence rules
6. Send only unresolved or presentation-oriented work to the LLM

## Glossary

- **Catalog_Pipeline**: The offline developer-run pipeline composed of six sequential steps that build a reviewed, enriched crop catalog from four source datasets. Each step is an independently runnable script. Permapeople data is fetched via API with local caching rather than a pre-downloaded file.
- **USDA_PLANTS_File**: The USDA PLANTS database stored as a single quoted-CSV file at `lib/usda-plants.txt`, version-controlled in the repository. Columns: `Symbol`, `Synonym Symbol`, `Scientific Name with Author`, `Common Name`, `Family`. Accepted taxa have an empty `Synonym Symbol` and populated `Common Name` + `Family`. Synonyms have a populated `Synonym Symbol` (pointing to the accepted symbol) and typically empty `Common Name` + `Family`. The pipeline reads from this file and never queries the USDA website live during processing.
- **Permapeople_API**: The Permapeople REST API used to search for plant data. The pipeline queries this API per-plant using canonical identities from Step 1, rather than downloading a bulk snapshot.
- **Permapeople_Cache**: A local cache of Permapeople API results stored in `data/catalog/permapeople/cache/`. Each cached record is keyed by the search term used. The pipeline checks this cache before querying the Permapeople API, and caches all new API responses for future runs.
- **OpenFarm_Dataset**: The 2-column CSV file at `lib/openfarm-crops.csv` serving as the base crop roster. No header row. Columns: scientific name, common name (optional — many entries have no common name). No slug or other fields.
- **Canonical_Identity**: A record in the canonical plant identity table anchored by USDA PLANTS data, containing: `canonical_id`, `usda_symbol`, `accepted_scientific_name`, `family`, `scientific_name_normalized`, `synonyms[]`, `common_names[]`.
- **Source_Match**: A record linking an external source record (Permapeople or OpenFarm) to a Canonical_Identity, containing: `source_provider`, `source_record_id`, `canonical_id`, `match_type`, `match_score`, `matched_at`.
- **Match_Type**: The technique used to resolve a source record to a Canonical_Identity. One of: `exact_scientific`, `normalized_scientific`, `synonym_match`, `common_name_fallback`, `ambiguous_common_name`, or `unresolved`.
- **Intermediate_Record**: A normalized representation of source attributes in a common schema, containing both the raw source payload (`raw.*`) and normalized field values (`normalized.*`). See Requirement 4 for the explicit field schema.
- **Relevance_Class**: A classification label assigned in Step 4 indicating the crop's role in the catalog. One of: `food_crop_core`, `food_crop_niche`, `edible_ornamental`, `medicinal_only`, `industrial_crop`, `weed_or_invasive`, `non_food`.
- **Catalog_Status**: The top-level visibility state of a crop in the app. One of: `core`, `extended`, `hidden`, `excluded`.
- **Edibility_Status**: The edibility classification of a crop. One of: `food_crop`, `niche_edible`, `edible_ornamental`, `non_edible`, `unknown`.
- **Review_Status**: The review state of a crop record. One of: `auto_approved`, `needs_review`, `rejected`. Derived from Source_Confidence and validation status.
- **Source_Confidence**: A numeric composite score (0.0–1.0) indicating overall confidence in the crop record. Inputs defined in Requirement 5 acceptance criteria.
- **Source_Agreement_Score**: A numeric composite score (0.0–1.0) indicating how well multiple sources agree on key attributes for a crop. Inputs defined in Requirement 5 acceptance criteria.
- **Bedrock_Client**: The component that sends prompts to Amazon Bedrock and parses structured JSON responses, used only in Step 6 after source-backed data exists.
- **Provenance_Metadata**: The set of columns (`source_provider`, `source_record_id`, `source_url`, `source_license`, `attribution_text`, `import_batch_id`, `imported_at`, `last_verified_at`) that track the origin of each record.
- **Progress_State**: A persisted JSON file per step tracking processing position (e.g., `lastProcessedIndex`) and input file checksum so each step can resume from where it left off and detect input drift.
- **Promotion_File**: The final pipeline output — a validated, import-ready file containing crops mapped to the target database schema.

## Data Grain by Step

Each pipeline step operates at a specific data grain. This section defines the output shape of each step to avoid ambiguity in record counts and audit trail semantics.

| Step | Output Grain | Description |
|---|---|---|
| Step 1 | Per canonical taxon | One row per accepted USDA PLANTS taxon. The canonical identity table is the taxonomic backbone, not necessarily the final user-facing crop concept model. Some app entries may collapse multiple botanical variants into a common crop concept. |
| Step 2 | Per source record | One row per Permapeople API result (fetched per canonical plant) + one row per OpenFarm record, each with a Source_Match linking to a Canonical_Identity (or unresolved). |
| Step 3 | Per source record | Same grain as Step 2, with normalized fields added alongside the raw source payload. |
| Step 4 | Per canonical crop | Merged from all matched source records into one crop object per canonical identity, plus unresolved records kept separately. |
| Step 5 | Per canonical crop draft | Same grain as Step 4, with precedence-derived canonical app fields added. |
| Step 6 | Per canonical crop draft | Same grain as Step 5, with LLM augmentation added for presentation fields. |

## Requirements

### Requirement 1: Source Data Management

**User Story:** As a platform maintainer, I want the pipeline to use locally stored source data (version-controlled files for USDA PLANTS and OpenFarm, and a local cache for Permapeople API results), so that processing is fast, reproducible, and minimizes unnecessary external API calls.

#### Acceptance Criteria

1. THE Catalog_Pipeline SHALL read USDA PLANTS data from the repository file at `lib/usda-plants.txt` and SHALL NOT query the USDA PLANTS website during any processing step.
2. THE Catalog_Pipeline SHALL query the Permapeople_API to search for plant data, using a cache-first strategy: for each plant to be looked up, the pipeline SHALL first check the Permapeople_Cache for a cached result, and only query the Permapeople_API when no cached result exists.
3. WHEN the Permapeople_API returns a result for a plant search, THE Catalog_Pipeline SHALL store the result in the Permapeople_Cache so that subsequent pipeline runs do not re-query the API for the same plant.
4. WHEN the Permapeople_API returns no result for a plant search, THE Catalog_Pipeline SHALL cache the empty result (cache miss marker) so that subsequent runs do not re-query the API for plants known to have no Permapeople data.
5. THE Catalog_Pipeline SHALL read OpenFarm data from the repository file at `lib/openfarm-crops.csv`.
6. WHEN the USDA PLANTS file at `lib/usda-plants.txt` does not exist, THE Catalog_Pipeline SHALL exit with a clear error message indicating the file is missing.
7. THE Catalog_Pipeline SHALL parse the USDA_PLANTS_File into an in-memory lookup structure indexed by scientific name, common name, synonym, and USDA symbol.
8. THE Catalog_Pipeline SHALL record Permapeople_Cache metadata (last query date, total cached entries, cache hit/miss counts per run) in a manifest file at `data/catalog/permapeople/manifest.json`.

### Requirement 2: Step 1 — Build Canonical Plant Identity Table

**User Story:** As a platform maintainer, I want a canonical plant identity table built from USDA PLANTS as the taxonomic backbone, so that all subsequent matching and enrichment anchors to an authoritative identity.

#### Acceptance Criteria

1. WHEN Step 1 is invoked, THE Catalog_Pipeline SHALL read the USDA_PLANTS_File (`lib/usda-plants.txt`) and build a canonical identity table.
2. THE Catalog_Pipeline SHALL produce one Canonical_Identity record per accepted USDA PLANTS taxon (rows where `Synonym Symbol` is empty), containing: `canonical_id`, `usda_symbol` (from the `Symbol` column), `accepted_scientific_name` (from `Scientific Name with Author`), `family` (from `Family`), `scientific_name_normalized` (lowercase, author text removed), `synonyms[]` (all synonym rows pointing to this symbol), and `common_names[]` (from the `Common Name` column).
3. THE Catalog_Pipeline SHALL use the USDA `Symbol` column as the stable canonical identifier for each taxon.
4. THE Catalog_Pipeline SHALL resolve synonym chains so that all synonyms (rows where `Synonym Symbol` is populated) point to the accepted name record (the `Symbol` column value is the accepted symbol).
5. THE Catalog_Pipeline SHALL write the canonical identity table to a configurable output location with one JSON object per line.
6. THE Catalog_Pipeline SHALL log a summary including: total canonical identities built, total synonyms indexed, and total common names indexed.
7. The canonical identity table is the taxonomic backbone, not necessarily the final user-facing crop concept model. Some app entries may collapse multiple botanical variants into a common crop concept (e.g., multiple Brassica oleracea varieties may map to separate user-facing crops like "Broccoli", "Kale", "Cauliflower").

### Requirement 3: Step 2 — Fetch Permapeople Data and Match External Records to Canonical Identity

**User Story:** As a platform maintainer, I want the pipeline to search the Permapeople API for each canonical plant (using a local cache to avoid redundant queries), and then match all Permapeople and OpenFarm records to the canonical identity table using a cascading strategy, so that enrichment data is linked to authoritative plant identities.

#### Acceptance Criteria

1. WHEN Step 2 is invoked, THE Catalog_Pipeline SHALL read the canonical identity table from the Step 1 output and all records from the OpenFarm_Dataset (`lib/openfarm-crops.csv`).
2. FOR EACH Canonical_Identity from Step 1, THE Catalog_Pipeline SHALL search for corresponding Permapeople data using a cache-first strategy: check the Permapeople_Cache first, and only query the Permapeople_API on a cache miss.
3. THE Catalog_Pipeline SHALL search the Permapeople_API using the canonical plant's scientific name as the primary search term, falling back to common name when the scientific name search yields no results.
4. WHEN the Permapeople_API returns results for a search, THE Catalog_Pipeline SHALL cache the results in the Permapeople_Cache keyed by the search term used.
5. THE Catalog_Pipeline SHALL attempt to match each Permapeople result and OpenFarm record to a Canonical_Identity using the following cascade, stopping at the first successful match: (a) exact scientific name match, (b) normalized scientific name match (lowercase, author text removed), (c) synonym match against the synonyms index, (d) fallback common-name match.
6. THE Catalog_Pipeline SHALL produce one Source_Match record per external source record, containing: `source_provider` (`permapeople` or `openfarm`), `source_record_id`, `canonical_id` (NULL if unresolved), `match_type`, `match_score`, and `matched_at` timestamp.
7. THE Catalog_Pipeline SHALL assign match scores reflecting the reliability of each match method, with exact matches scoring highest and weaker heuristic matches scoring lowest.
8. WHEN the common-name fallback yields exactly ONE plausible canonical identity match, THE Catalog_Pipeline SHALL auto-match with match_type `common_name_fallback`.
9. WHEN the common-name fallback yields MULTIPLE possible canonical identities, THE Catalog_Pipeline SHALL NOT auto-match. The record SHALL be marked with match_type `ambiguous_common_name` and a match_score below the promotion threshold (below 0.5).
10. WHEN no match is found through any cascade step, THE Catalog_Pipeline SHALL mark the record as `unresolved` with a match_score of 0.0 and include the record in the output.
11. THE Catalog_Pipeline SHALL write all Source_Match records to a configurable output location with one JSON object per line.
12. THE Catalog_Pipeline SHALL log a summary including: total records matched per source, counts per Match_Type per source (including `ambiguous_common_name`), count of unresolved records per source, Permapeople cache hits, and Permapeople cache misses (new API queries).

### Requirement 4: Step 3 — Normalize Source Attributes into Common Intermediate Schema

**User Story:** As a platform maintainer, I want source attributes aggressively normalized into a common intermediate schema while preserving raw payloads, so that downstream steps work with clean, consistent data shapes without losing original source information.

#### Acceptance Criteria

1. WHEN Step 3 is invoked, THE Catalog_Pipeline SHALL read all Source_Match records from the Step 2 output and the corresponding raw source records from the Permapeople_Cache and OpenFarm_Dataset (`lib/openfarm-crops.csv`).
2. THE Catalog_Pipeline SHALL produce one Intermediate_Record per source record, containing BOTH the raw source payload (unchanged) AND normalized field values.
3. THE Catalog_Pipeline SHALL produce Intermediate_Records with the following stable normalized field schema:
   - `normalized.scientific_name` — accepted scientific name from canonical identity
   - `normalized.common_names[]` — array of common names from all sources
   - `normalized.light_requirements[]` — array of standardized light enum tokens
   - `normalized.water_requirement` — standardized water enum token (`low`, `moderate`, `high`)
   - `normalized.edible` — boolean
   - `normalized.edible_parts[]` — array of edible part tokens
   - `normalized.life_cycle` — standardized life cycle token
   - `normalized.hardiness_zones[]` — integer array of USDA zones
   - `normalized.layer` — permaculture layer token
   - `normalized.growth_habit` — growth habit token
   - `normalized.warnings[]` — array of warning strings
   - `normalized.utility[]` — array of utility tokens
   - `normalized.external_links` — object containing `pfaf_url`, `powo_url`, `wikipedia_url`
   - `normalized.companions[]` — array of companion plant identifiers
   - `normalized.antagonists[]` — array of antagonist plant identifiers
   - `raw.*` — original source payload preserved in full
4. THE Catalog_Pipeline SHALL normalize Permapeople fields as follows:
   - "not specified", "Not specified", "N/A", and empty strings SHALL be normalized to NULL.
   - Comma-separated string values for multi-value fields (light requirement, soil type, edible parts, utility) SHALL be normalized to arrays of lowercase enum tokens (e.g., "Full sun, Partial sun/shade" → `["full_sun", "partial_shade"]`).
   - Water requirement freeform values SHALL be normalized to enum tokens (`low`, `moderate`, `high`) with the raw value preserved in a `raw_water_requirement` field.
   - Height and growth strings SHALL be parsed into metric numeric fields where possible, with the raw value preserved.
   - USDA Hardiness zone arrays of strings SHALL be parsed into integer arrays.
   - "Edible" field string values ("true", "false") SHALL be normalized to boolean values.
   - Freeform values for light, water, and soil SHALL be mapped to standardized enum tokens with the raw value preserved in a companion `raw_` field.
5. THE Catalog_Pipeline SHALL normalize OpenFarm fields using equivalent rules where applicable, preserving raw values alongside normalized values. Note: OpenFarm only provides `scientific_name` and `common_name` (no slug, no other fields), so normalization is minimal.
6. THE Catalog_Pipeline SHALL extract and normalize the following Permapeople fields: `id`, `scientific_name`, `name`, `slug`, `Family`, `Alternate name`, `Light requirement`, `Water requirement`, `Soil type`, `Life cycle`, `Edible`, `Edible parts`, `Edible uses`, `Layer`, `Growth`, `USDA Hardiness zone`, `Warning`, `Utility`, `Native to`, `Introduced into`, `Plants For A Future`, `Plants of the World Online`, `Wikipedia`, `companions`, `antagonists`, `has_images`.
7. THE Catalog_Pipeline SHALL NOT store "not specified" as data in any normalized field. All such sentinel values SHALL be converted to NULL.
8. THE Catalog_Pipeline SHALL write all Intermediate_Records to a configurable output location with one JSON object per line.
9. THE Catalog_Pipeline SHALL log a summary including: total records normalized per source, field population rates per source (percentage of records with non-NULL normalized values per field), and count of normalization warnings.

### Requirement 5: Step 4 — Compute Relevance Classification

**User Story:** As a platform maintainer, I want each crop classified into a relevance category using multi-source signals and explicit rules, so that the catalog distinguishes practical garden crops from ornamentals, weeds, and industrial plants without relying solely on any single source's edible flag.

#### Acceptance Criteria

1. WHEN Step 4 is invoked, THE Catalog_Pipeline SHALL read all Intermediate_Records from the Step 3 output and the canonical identity table from the Step 1 output.
2. THE Catalog_Pipeline SHALL classify each crop into exactly one Relevance_Class: `food_crop_core`, `food_crop_niche`, `edible_ornamental`, `medicinal_only`, `industrial_crop`, `weed_or_invasive`, or `non_food`.
3. THE Catalog_Pipeline SHALL use the following signals for classification: edible flag, edible parts list, warning text, utility values, layer/habit, family, common name patterns, and source agreement across Permapeople and OpenFarm.
4. THE Catalog_Pipeline SHALL NOT treat Permapeople's "Edible: true" as sufficient for inclusion in the default food catalog. A crop marked edible by Permapeople SHALL still be classified as `edible_ornamental`, `weed_or_invasive`, or `industrial_crop` when other signals indicate those categories.
5. THE Catalog_Pipeline SHALL apply the following classification rule hierarchy, where earlier rules take precedence:
   1. Explicit weed/invasive warnings override edible status — a crop with weed or invasive warnings SHALL be classified as `weed_or_invasive` regardless of edible flags.
   2. Industrial utility overrides food relevance unless direct food use is strongly supported — a crop with primary industrial utility (fiber, oil, textiles) SHALL be classified as `industrial_crop` unless multiple sources confirm direct food use.
   3. Edible flowers on shrubs default to `edible_ornamental` unless supported by food-focused source evidence from a food-growing context.
   4. Known core food families can elevate to `food_crop_core` when source agreement is sufficient — crops from well-known food families (e.g., Solanaceae, Cucurbitaceae, Fabaceae) with multi-source food signals may be elevated.
   5. Single-source edible claims without food-growing context SHALL NOT elevate a crop to `food_crop_core`.
6. THE Catalog_Pipeline SHALL assign `food_crop_core` to vegetables, fruits, herbs, legumes, grains, and edible flowers commonly grown in home and community gardens, where multiple source signals agree on food relevance.
7. THE Catalog_Pipeline SHALL assign `food_crop_niche` to food-relevant crops with limited but real growing interest (e.g., unusual herbs, specialty greens, uncommon edibles).
8. THE Catalog_Pipeline SHALL assign `edible_ornamental` to crops that are technically edible but primarily grown as ornamentals.
9. THE Catalog_Pipeline SHALL assign `weed_or_invasive` to crops with weed or invasive potential, even when technically edible (e.g., Abutilon theophrasti — edible but also weed potential, fiber/oil/textiles utility, not a common home food crop).
10. THE Catalog_Pipeline SHALL assign `industrial_crop` to crops primarily grown for fiber, oil, or industrial use rather than direct food consumption.
11. THE Catalog_Pipeline SHALL derive top-level state fields for each crop:
    - `catalog_status`: `core`, `extended`, `hidden`, or `excluded` — derived from Relevance_Class.
    - `edibility_status`: `food_crop`, `niche_edible`, `edible_ornamental`, `non_edible`, or `unknown`.
    - `review_status`: `auto_approved`, `needs_review`, or `rejected` — derived from Source_Confidence and Source_Agreement_Score.
    - `source_confidence`: numeric composite score (0.0–1.0).
    - `source_agreement_score`: numeric composite score (0.0–1.0).
12. THE Catalog_Pipeline SHALL compute `source_confidence` using the following inputs:
    - Match score from identity resolution (Step 2)
    - Number of sources contributing data for this crop
    - Source authority level of contributing sources (HIGH, MEDIUM, LOW)
    - Number of populated canonical fields (field completeness)
    - Number of normalization warnings from Step 3
    - Number of conflicting source values across contributing sources
    - Whether classification depended on weak heuristics (e.g., common-name-only match, single-source edible claim)
13. THE Catalog_Pipeline SHALL compute `source_agreement_score` using the following inputs:
    - Scientific identity agreement across sources (do sources agree on the scientific name?)
    - Common-name agreement across sources (do sources use consistent common names?)
    - Edibility agreement across sources (do sources agree on edible status?)
    - Life-cycle agreement across sources (do sources agree on annual/perennial/biennial?)
    - Practical trait agreement (light, water, soil) where present across multiple sources
14. THE Catalog_Pipeline SHALL write all records (all classifications) to a configurable output location with one JSON object per line, containing: canonical identity, all normalized source data, the assigned Relevance_Class, top-level state fields, and a human-readable reason string explaining the classification.
15. THE Catalog_Pipeline SHALL NOT discard any records during Step 4. All records SHALL remain in the output regardless of classification.
16. THE Catalog_Pipeline SHALL log a summary including: total records (at per-canonical-crop grain), counts per Relevance_Class, counts per catalog_status, counts per review_status, and count of crops where source signals disagreed.

### Requirement 6: Step 5 — Derive Canonical App Fields from Precedence Rules

**User Story:** As a platform maintainer, I want canonical app fields derived from explicit source precedence rules without LLM involvement, so that the catalog contains trustworthy, source-backed data for each crop.

#### Acceptance Criteria

1. WHEN Step 5 is invoked, THE Catalog_Pipeline SHALL read all records from the Step 4 output.
2. THE Catalog_Pipeline SHALL derive canonical app fields using the following source precedence rules:
   - `scientific_name`: USDA PLANTS (authoritative).
   - `common_name`: OpenFarm first, Permapeople second, USDA PLANTS fallback.
   - `family`: USDA PLANTS (authoritative).
   - `light_requirement`: Permapeople first, OpenFarm fallback.
   - `water_requirement`: Permapeople first, OpenFarm fallback.
   - `life_cycle`: Permapeople if present.
   - `edible_parts`: Permapeople if present.
   - `hardiness_zone`: Permapeople if present, only for crops where zone data is meaningful (perennials, trees, shrubs — not annuals).
   - `description`: deferred to Step 6 (LLM).
   - `review_status`: derived from Source_Confidence and Source_Agreement_Score.
3. WHEN the OpenFarm common name is unusually mismatched against the resolved scientific identity (e.g., the common name refers to a different species or genus), THE Catalog_Pipeline SHALL flag the record for review rather than blindly preferring the OpenFarm common name.
4. WHEN a field cannot be confidently derived from any source, THE Catalog_Pipeline SHALL leave that field as NULL rather than guessing. Sparse-but-trustworthy data SHALL be preferred over full-but-uncertain data.
5. THE Catalog_Pipeline SHALL populate Provenance_Metadata for each field: tagging every populated field with its source (`usda_plants`, `permapeople`, `openfarm`) in a `field_sources` map.
6. THE Catalog_Pipeline SHALL NOT force every field for every crop. Fields SHALL only be populated when source data is available and trustworthy.
7. THE Catalog_Pipeline SHALL carry forward all records (including excluded classifications) into the output for audit continuity.
8. THE Catalog_Pipeline SHALL write results to a configurable output location with one JSON object per line, containing all derived fields, the `field_sources` map, and all upstream data.
9. THE Catalog_Pipeline SHALL log a summary including: total records processed (at per-canonical-crop-draft grain), field population rates (percentage of records with non-NULL values per canonical field), and count of records with no common_name resolved.

### Requirement 7: Step 6 — LLM Augmentation for Presentation and Unresolved Work

**User Story:** As a platform maintainer, I want the LLM used only for presentation-oriented and unresolved work after source-backed data exists, so that AI-generated content supplements rather than replaces authoritative data.

#### Acceptance Criteria

1. WHEN Step 6 is invoked, THE Catalog_Pipeline SHALL read all records from the Step 5 output and process only records with a catalog_status of `core` or `extended`.
2. THE Bedrock_Client SHALL receive a prompt containing: canonical scientific name, validated common names, family, normalized edible info, source-backed practical attributes, relevance class, and warnings.
3. THE Bedrock_Client SHALL generate a beginner-friendly `description` of 1–3 sentences for each processed crop, written in plain language suitable for novice gardeners.
4. THE Bedrock_Client SHALL generate a `category` suggestion from the allowed set: `vegetable`, `fruit`, `herb`, `legume`, `grain`, `root`, `leafy_green`, `squash`, `allium`, `brassica`, `nightshade`, `cucurbit`, `edible_flower`, `berry`, `other`. The LLM SHALL only suggest category when it cannot be confidently derived from source data and classification rules. Categories that are deterministic from the crop's family, relevance class, or edible parts SHALL be derived in Step 5 without LLM involvement.
5. THE Bedrock_Client SHALL generate optional `display_notes` explaining why a crop is or is not a practical garden crop, when relevant context exists.
6. THE Bedrock_Client SHALL generate optional `review_notes` for crops where source signals conflict or classification is uncertain.
7. THE Catalog_Pipeline SHALL NOT use the Bedrock_Client to determine crop identity, resolve scientific name ambiguity, or override USDA PLANTS classification data.
8. THE Catalog_Pipeline SHALL NOT overwrite any source-backed field from Step 5 with LLM-generated data. LLM data SHALL only fill NULL fields or be stored in separate LLM-specific fields.
9. WHEN the Bedrock_Client suggests a value for a field that already has a source-backed value, THE Catalog_Pipeline SHALL discard the LLM suggestion and retain the source-backed value.
10. THE Catalog_Pipeline SHALL process crops in configurable batches with configurable retry behavior.
11. IF a Bedrock API call fails after all retries, THEN THE Catalog_Pipeline SHALL log the failed crop identifiers, skip the batch, and continue with the next batch.
12. THE Catalog_Pipeline SHALL validate every Bedrock response against a defined JSON schema before merging. IF a response fails validation, THEN THE Catalog_Pipeline SHALL reject the response for that crop and log the validation errors.
13. THE Catalog_Pipeline SHALL tag every LLM-generated field with its source (`llm_description`, `llm_category`, `llm_display_notes`) in the `field_sources` map.
14. THE Catalog_Pipeline SHALL carry forward excluded and hidden records unchanged into the output for audit continuity.
15. THE Catalog_Pipeline SHALL write results to a configurable output location with one JSON object per line, containing all upstream fields plus LLM-generated fields with their field sources.
16. THE Catalog_Pipeline SHALL log a summary including: total crops augmented (at per-canonical-crop-draft grain), failed augmentations, total Bedrock API calls made, and field population rates for LLM-generated fields.

### Requirement 8: Pipeline Resumability and Independent Step Execution

**User Story:** As a platform maintainer, I want each step to be independently runnable and resumable, so that I can re-run individual steps after corrections and recover from interruptions without reprocessing everything.

#### Acceptance Criteria

1. THE Catalog_Pipeline SHALL support running each step independently via a CLI command specifying the step number (e.g., `--step 1`, `--step 2`).
2. THE Catalog_Pipeline SHALL persist a Progress_State file per step containing `lastProcessedIndex` after each batch completes successfully.
3. THE Progress_State file SHALL record the input file checksum alongside the `lastProcessedIndex`, so that input drift can be detected on resume.
4. WHEN a step is started, THE Catalog_Pipeline SHALL read the corresponding Progress_State file and resume processing from the record after `lastProcessedIndex`.
5. WHEN resuming a step, THE Catalog_Pipeline SHALL verify that the current input file checksum matches the checksum recorded in the Progress_State file when the step's progress was last written.
6. IF the input file checksum does not match the recorded checksum on resume, THEN THE Catalog_Pipeline SHALL fail fast with a clear error message indicating the input has changed since the last run, and require `--reset` to proceed.
7. IF no Progress_State file exists for a step, THEN THE Catalog_Pipeline SHALL start processing from the first record (index 0).
8. THE Catalog_Pipeline SHALL support a `--reset` flag that deletes the Progress_State file for the specified step and starts from the beginning.
9. THE Catalog_Pipeline SHALL support a `--dry-run` flag that processes the first batch of the specified step without writing output files or calling external services.
10. THE Catalog_Pipeline SHALL support a `--limit N` flag that processes only N records starting from the resume point.
11. WHEN a step is invoked, THE Catalog_Pipeline SHALL verify that the required input file from the previous step exists. IF the input file is missing, THEN THE Catalog_Pipeline SHALL exit with a clear error message indicating which preceding step must be run first.
12. THE Catalog_Pipeline SHALL append to output files across multiple runs (resume-safe), writing only newly processed records from the current run.

### Requirement 9: Audit Trail, Record Retention, and No Silent Drops

**User Story:** As a platform maintainer, I want every input record accounted for across all steps with no silent drops, so that I can trace any crop from source input through to final disposition.

#### Acceptance Criteria

1. THE Catalog_Pipeline SHALL preserve every record through all six steps. No record SHALL be silently dropped at any step.
2. WHEN a record is classified as excluded or hidden in Step 4, THE Catalog_Pipeline SHALL retain the record in all subsequent step outputs with its Relevance_Class, catalog_status, and reason code.
3. THE Catalog_Pipeline SHALL maintain a consistent identifier across all step outputs, enabling record tracing from Step 1 through Step 6.
4. WHEN a field cannot be reliably populated for a crop, THE Catalog_Pipeline SHALL leave the field as NULL rather than populating it with uncertain data.
5. FOR ALL records entering the pipeline, the count of records in each step output file SHALL equal the expected count for that step's data grain: Step 1 output count SHALL equal the USDA canonical identity count (per-taxon grain). Step 2 output count SHALL equal the total Permapeople API results matched or attempted plus total OpenFarm records (per-source-record grain). Step 3 output count SHALL equal the Step 2 count (per-source-record grain). Step 4 output count SHALL equal the number of distinct canonical crops plus unresolved records (per-canonical-crop grain). Steps 5–6 output counts SHALL equal the Step 4 count (per-canonical-crop-draft grain).
6. FOR ALL promoted records in the Promotion_File, parsing the JSONL output and extracting field values SHALL produce values equivalent to the internal representation (round-trip serialization property).
7. THE Catalog_Pipeline SHALL NOT discard records too early. Excluded records SHALL be retained with a reason code through the entire pipeline.

### Requirement 10: Source Authority Boundaries

**User Story:** As a platform maintainer, I want clear boundaries on what each source decides, so that the LLM never overrides authoritative data and the catalog maintains data integrity.

#### Acceptance Criteria

1. THE Catalog_Pipeline SHALL use the USDA_PLANTS_File as the authority for: accepted scientific name resolution, taxonomic family, synonym relationships, and symbol-based canonical identity.
2. THE Catalog_Pipeline SHALL use the Permapeople_API (via the Permapeople_Cache) as a secondary enrichment source for: edible flags, edible parts, light/water/soil requirements, life cycle, habit/layer, alternate names, external cross-links (PFAF, POWO, Wikipedia), companions/antagonists, USDA hardiness zones, warnings, and utility.
3. THE Catalog_Pipeline SHALL use the OpenFarm_Dataset as the source for: the initial crop roster (scientific_name and optional common_name as submitted) and beginner-oriented naming.
4. THE Catalog_Pipeline SHALL use the Bedrock_Client only for: beginner-friendly descriptions, category normalization (only when not deterministic from source data), display notes, review notes, and conflict resolution summaries — and only AFTER source-backed data exists.
5. THE Catalog_Pipeline SHALL NOT use the Bedrock_Client to determine crop identity, resolve scientific name ambiguity, or override USDA PLANTS classification data.
6. THE Catalog_Pipeline SHALL NOT trust Permapeople data blindly. Specifically:
   - Permapeople "Edible: true" SHALL NOT be treated as sufficient for catalog inclusion as a food crop.
   - Permapeople zone ranges SHALL be treated as less useful for annuals.
   - Permapeople companion/antagonist data SHALL be carried forward but not used for classification decisions.
   - Permapeople search result rank SHALL NOT influence classification.
   - Ornamental shrub records SHALL NOT be included in the food catalog solely because Permapeople marks them as technically edible.
7. THE Catalog_Pipeline SHALL tag every populated field with its source (`usda_plants`, `permapeople`, `openfarm`, `llm_description`, `llm_category`, `llm_display_notes`, `llm_review_notes`) in the `field_sources` map.

### Requirement 11: Permapeople API Ingestion, Caching, and Normalization Rules

**User Story:** As a platform maintainer, I want explicit rules governing how Permapeople data is fetched via API, cached locally, and normalized, so that enrichment data is consistent, predictable, and does not introduce false confidence or unnecessary API calls.

#### Acceptance Criteria

1. THE Catalog_Pipeline SHALL extract the following fields from each Permapeople record: `id`, `scientific_name`, `name`, `slug`, `Family`, `Alternate name`, `Light requirement`, `Water requirement`, `Soil type`, `Life cycle`, `Edible`, `Edible parts`, `Edible uses`, `Layer`, `Growth`, `USDA Hardiness zone`, `Warning`, `Utility`, `Native to`, `Introduced into`, `Plants For A Future`, `Plants of the World Online`, `Wikipedia`, `companions`, `antagonists`, `has_images`.
2. THE Catalog_Pipeline SHALL normalize all Permapeople sentinel values ("not specified", "Not specified", "N/A", empty strings, whitespace-only strings) to NULL.
3. THE Catalog_Pipeline SHALL normalize Permapeople multi-value string fields into arrays of standardized lowercase enum tokens, preserving the raw value in a companion field.
4. THE Catalog_Pipeline SHALL normalize Permapeople boolean-like string fields ("true", "false", "True", "False") to native boolean values.
5. THE Catalog_Pipeline SHALL parse Permapeople USDA Hardiness zone values into integer arrays, discarding unparseable zone strings and logging a warning.
6. THE Catalog_Pipeline SHALL preserve Permapeople external cross-link URLs (Plants For A Future, Plants of the World Online, Wikipedia) as-is for potential future use.
7. THE Catalog_Pipeline SHALL carry forward Permapeople companion and antagonist data as raw arrays without using them for classification decisions.
8. THE Catalog_Pipeline SHALL NOT treat Permapeople search result rank or record ordering as a quality signal.
9. THE Catalog_Pipeline SHALL NOT treat Permapeople "Edible: true" as sufficient evidence that a crop belongs in the default food garden catalog.

### Requirement 12: Review Artifacts and Promotion Output

**User Story:** As a platform maintainer, I want the pipeline to generate review queues and a promotion-ready import file mapped to the target database schema, so that I can efficiently audit results and import validated data into PostgreSQL.

#### Acceptance Criteria

1. WHEN all six steps have completed, THE Catalog_Pipeline SHALL generate a Promotion_File containing only crops with catalog_status of `core` or `extended` that meet promotion criteria: review_status of `auto_approved`, validation passing with no errors, and catalog_status eligible. Promotion eligibility is derived from review_status and validation status; match score is one input into review_status (computed in Step 4), not a separate promotion gate.
2. Each record in the Promotion_File SHALL contain fields mapped to the target database schema: `crops` table fields (`slug`, `common_name`, `scientific_name`, `category`, `description`, `source_provider`, `source_record_id`, `source_url`, `source_license`, `attribution_text`, `import_batch_id`, `imported_at`), and nested objects for `crop_profiles`, `crop_varieties`, and `crop_zone_suitability` where data exists.
3. THE Catalog_Pipeline SHALL set `import_batch_id` to a timestamp-based identifier in the format `catalog_YYYYMMDD_HHmmss` and `imported_at` to the current timestamp on all promoted records.
4. THE Catalog_Pipeline SHALL set `last_verified_at` to NULL on all promoted records, indicating human review has not yet occurred.
5. THE Catalog_Pipeline SHALL generate a needs-review queue containing all crops with review_status of `needs_review`, including the reason for review.
6. THE Catalog_Pipeline SHALL generate an unresolved matches report containing all crops where Match_Type is `unresolved` or `ambiguous_common_name`.
7. THE Catalog_Pipeline SHALL generate an excluded crops report containing all records with catalog_status of `excluded`, including the Relevance_Class and reason string for each.
8. THE Catalog_Pipeline SHALL generate a summary review report containing: run timestamp, batch identifier, total records per Relevance_Class, total records per catalog_status, total promoted crops, total crops in each review queue, field population rates for promoted crops, counts per category, and a list of crops with warnings.
9. THE Catalog_Pipeline SHALL log a summary including: total records processed, promoted count, needs-review count, unresolved count, ambiguous-common-name count, and excluded count.

### Requirement 13: Pipeline Anti-Patterns and Explicit Constraints

**User Story:** As a platform maintainer, I want explicit constraints codified in the requirements so that pipeline implementations do not regress on hard-won design decisions.

#### Acceptance Criteria

1. THE Catalog_Pipeline SHALL NOT query the USDA PLANTS website live during enrichment. USDA PLANTS data SHALL come from the repository file at `lib/usda-plants.txt`. Permapeople data SHALL be queried via the Permapeople_API with a cache-first strategy (see Requirement 1).
2. THE Catalog_Pipeline SHALL NOT let the Bedrock_Client decide truth when a source can decide identity. USDA PLANTS SHALL remain the identity authority.
3. THE Catalog_Pipeline SHALL NOT discard records too early. Excluded records SHALL be retained with a reason code through the entire pipeline.
4. THE Catalog_Pipeline SHALL NOT force every field for every crop. Sparse-but-trustworthy data SHALL be preferred over full-but-uncertain data.
5. THE Catalog_Pipeline SHALL NOT store "not specified" as data. All such sentinel values SHALL be normalized to NULL.
6. THE Catalog_Pipeline SHALL NOT treat Permapeople's "Edible: true" as sufficient for catalog inclusion as a food crop.
7. THE Catalog_Pipeline SHALL maintain a full audit trail with no silent drops. Every record entering the pipeline SHALL be traceable to a final disposition.

## Implementation Notes

This appendix contains recommended defaults and suggested implementation details. These are NOT hard requirements — they are starting points that implementations may adjust as needed. The core requirements above use behavioral descriptions; this section provides concrete defaults for convenience.

### Suggested Output File Names

| Step | Suggested Default Path |
|---|---|
| Step 1 | `data/catalog/step1_canonical_identity.jsonl` |
| Step 2 | `data/catalog/step2_source_matches.jsonl` |
| Step 3 | `data/catalog/step3_normalized_sources.jsonl` |
| Step 4 | `data/catalog/step4_relevance_classified.jsonl` |
| Step 5 | `data/catalog/step5_canonical_drafts.jsonl` |
| Step 6 | `data/catalog/step6_augmented_catalog.jsonl` |
| Promotion | `data/catalog/promoted_crops.jsonl` |
| Review: needs-review | `data/catalog/review_queue_needs_review.jsonl` |
| Review: unresolved | `data/catalog/review_queue_unresolved.jsonl` |
| Review: excluded | `data/catalog/review_queue_excluded.jsonl` |
| Review: summary | `data/catalog/review_report.md` |

### Suggested Match Score Defaults

| Match Type | Suggested Score |
|---|---|
| `exact_scientific` | 1.0 |
| `normalized_scientific` | 0.95 |
| `synonym_match` | 0.85 |
| `common_name_fallback` | 0.7 |
| `ambiguous_common_name` | 0.4 |
| `unresolved` | 0.0 |

### Suggested Batch and Retry Defaults

| Parameter | Suggested Default |
|---|---|
| LLM batch size | 50 |
| Delay between batches | 2 seconds |
| Max retries per failed API call | 3 |
| Initial backoff | 5 seconds |
| Backoff strategy | Exponential |

### Suggested Manifest and Progress File Paths

| File | Suggested Default Path |
|---|---|
| USDA PLANTS manifest | N/A (file is version-controlled in repo at `lib/usda-plants.txt`) |
| Permapeople manifest | `data/catalog/permapeople/manifest.json` |
| Step 1 progress | `data/catalog/step1_progress.json` |
| Step 2 progress | `data/catalog/step2_progress.json` |
| Step 3 progress | `data/catalog/step3_progress.json` |
| Step 4 progress | `data/catalog/step4_progress.json` |
| Step 5 progress | `data/catalog/step5_progress.json` |
| Step 6 progress | `data/catalog/step6_progress.json` |
