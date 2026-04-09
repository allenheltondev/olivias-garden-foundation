# Requirements Document

## Introduction

The crop data enrichment pipeline (`scripts/catalog/`) matches source records from OpenFarm and Permapeople against a USDA PLANTS canonical backbone, classifies relevance, and promotes food crops into import-ready artifacts. After the OpenFarm-first hardening (#182), the pipeline became too aggressive: the 400-sample benchmark reports 0% promoted crops (threshold requires ≥5%), with 369 of 400 step2 records unresolved and 399 of 400 classified as `non_food`. The full pipeline run promotes only 17 of 648 records (2.6%).

The root cause is twofold: (1) Step 1 only builds canonical identities from USDA PLANTS, so non-US species present in OpenFarm (tropical crops, cultivars, non-USDA genera) have no canonical record to match against and become `unresolved`; (2) Step 4 classification and the promotion gate require OpenFarm support on a resolved canonical, but since most OpenFarm records are themselves unresolved, the gate blocks everything.

This feature restores promotion rates to healthy levels while preserving conifer/industrial guardrails and data quality.

## Glossary

- **Pipeline**: The 7-step crop data enrichment pipeline in `scripts/catalog/` (step1 through step6 plus promote)
- **Canonical_Identity**: A unique plant record in `step1_canonical_identity.jsonl`, keyed by `canonical_id`, representing the authoritative identity for a taxon
- **USDA_Canonical**: A Canonical_Identity sourced from the USDA PLANTS database (`lib/usda-plants.txt`)
- **OpenFarm_Canonical**: A Canonical_Identity sourced from OpenFarm when no matching USDA_Canonical exists
- **Match_Cascade**: The ordered sequence of matching strategies in Step 2 (exact → normalized_scientific → synonym → common_name_fallback → fuzzy_fallback → unresolved)
- **Classifier**: The `classifyCanonical` function in Step 4 that assigns `relevance_class`, `catalog_status`, and `review_status`
- **Promotion_Gate**: The logic in `promote.mjs` that determines whether a classified record becomes an import-ready artifact
- **Benchmark**: The 400-sample quality gate (`benchmark_400.mjs`) that validates pipeline output against defined thresholds
- **Unresolved_Record**: A source record in Step 2 that could not match to any Canonical_Identity (match_type = `unresolved`)
- **Cultivar_Name**: A plant name containing a cultivar designation, parenthetical variety, or trade name (e.g., "Envy (apple)", "Roma tomato")
- **Genus_Match**: A match strategy that resolves a source record to a Canonical_Identity sharing the same genus when species-level matching fails
- **Strong_Food_Evidence**: A flag indicating edible evidence from two or more independent source providers
- **Confidence_Band**: A classification of match quality as `high`, `medium`, or `low` based on match type and score

## Requirements

### Requirement 1: OpenFarm-originated canonical identities

**User Story:** As a pipeline operator, I want Step 1 to create canonical identities from OpenFarm records that have no USDA match, so that non-US food crops (tropical plants, cultivars, non-USDA genera) are not silently dropped.

#### Acceptance Criteria

1. WHEN an OpenFarm source record cannot match any USDA_Canonical in Step 2, THE Pipeline SHALL create an OpenFarm_Canonical identity for that record in the canonical identity table.
2. THE Pipeline SHALL assign each OpenFarm_Canonical a deterministic `canonical_id` derived from the normalized scientific name or source record identifier, so that repeated runs produce stable identifiers.
3. THE Pipeline SHALL mark each OpenFarm_Canonical with an `origin` field set to `openfarm` to distinguish OpenFarm_Canonicals from USDA_Canonicals.
4. WHEN an OpenFarm_Canonical is created, THE Pipeline SHALL populate `accepted_scientific_name`, `scientific_name_normalized`, and `common_names` from the OpenFarm source data.
5. THE Pipeline SHALL not create duplicate OpenFarm_Canonicals when multiple OpenFarm source records normalize to the same scientific name.

### Requirement 2: Expanded match cascade for cultivar and genus-level matching

**User Story:** As a pipeline operator, I want Step 2 to handle cultivar names, parenthetical varieties, and genus-level matches, so that more source records resolve to a canonical identity instead of becoming unresolved.

#### Acceptance Criteria

1. WHEN a source record contains a Cultivar_Name with a parenthetical qualifier (e.g., "Envy (apple)"), THE Match_Cascade SHALL extract the parenthetical content and attempt a common-name match before falling through to unresolved.
2. WHEN a source record's scientific name contains a cultivar designation (e.g., `cv.`, `'Roma'`), THE Match_Cascade SHALL strip the cultivar portion and attempt a normalized scientific match on the remaining binomial.
3. WHEN species-level matching fails and the source record has a valid genus token, THE Match_Cascade SHALL attempt a Genus_Match against canonical identities sharing the same genus, resolving to the genus-level canonical when exactly one candidate exists.
4. WHEN a Genus_Match resolves ambiguously to multiple canonical identities, THE Match_Cascade SHALL mark the record as `ambiguous_common_name` with the candidate list.
5. THE Match_Cascade SHALL assign a `match_score` for genus-level matches that is lower than `common_name_fallback` but higher than `
m), THE Classifier SHALL treat OpenFarm presence as a positive food-relevance signal.
2. WHEN a canonical record has at least one source with `edible: true` or non-empty `edible_parts`, THE Classifier SHALL not classify the record as `non_food` unless a guardrail (conifer or industrial) applies.
3. WHEN a canonical record has Strong_Food_Evidence, THE Classifier SHALL classify the record as `food_crop_core` when OpenFarm support is present, or `food_crop_niche` when OpenFarm support is absent.
4. THE Classifier SHALL preserve conifer and industrial guardrails: records matching conifer or industrial patterns SHALL remain `non_food` unless Strong_Food_Evidence overrides the guardrail.
5. WHEN a canonical record is an OpenFarm_Canonical with edible evidence from the OpenFarm source, THE Classifier SHALL classify the record as `food_crop_core` with `catalog_status` of `core`.

### Requirement 4: Promotion gate adjustment

**User Story:** As a pipeline operator, I want the promotion gate to allow qualified food crops through, so that the benchmark passes the ≥5% promoted threshold while maintaining quality guardrails.

#### Acceptance Criteria

1. THE Promotion_Gate SHALL promote records where `catalog_status` is `core` or `extended`, `review_status` is `auto_approved`, edible evidence is present, and no guardrail flag is active.
2. WHEN a record has `match_confidence_band` of `high`, THE Promotion_Gate SHALL not require additional OpenFarm or Strong_Food_Evidence checks beyond the edible signal.
3. WHEN a record has `match_confidence_band` of `medium`, THE Promotion_Gate SHALL require either OpenFarm support or Strong_Food_Evidence for promotion.
4. THE Promotion_Gate SHALL reject records with `match_confidence_band` of `low` regardless of other signals.
5. THE Promotion_Gate SHALL reject records where `guardrail_flags.conifer` or `guardrail_flags.industrial` is true.

### Requirement 5: Benchmark pass threshold

**User Story:** As a pipeline operator, I want the 400-sample benchmark to pass after pipeline changes, so that I have confidence the quality improvements are effective.

#### Acceptance Criteria

1. WHEN the Pipeline runs against the full source datasets, THE Benchmark SHALL report a promoted percentage of at least 5% of the sampled records.
2. WHEN the Pipeline runs against the full source datasets, THE Benchmark SHALL report a needs_review percentage of at most 35% of the sampled records.
3. WHEN the Pipeline runs against the full source datasets, THE Benchmark SHALL report a suspicious percentage of at most 20% of the sampled records.
4. WHEN the Pipeline runs against the full source datasets, THE Benchmark SHALL report a fuzzy_match percentage of at most 25% of the sampled records.
5. THE Benchmark SHALL report `pass: true` when all four threshold checks pass simultaneously.

### Requirement 6: Unresolved record reduction

**User Story:** As a pipeline operator, I want the unresolved rate in Step 2 to decrease substantially, so that more source records contribute to the enrichment pipeline.

#### Acceptance Criteria

1. WHEN the Pipeline runs against the full source datasets, THE Benchmark SHALL report an unresolved match_type count that is less than 75% of total sampled Step 2 records (currently 92.25%).
2. WHEN a previously unresolved OpenFarm record gains a canonical identity (via OpenFarm_Canonical creation or expanded matching), THE Pipeline SHALL carry that record through Steps 3-6 and promotion with the same quality checks as USDA-matched records.
3. THE Pipeline SHALL not create canonical identities for source records that lack both a parseable scientific name and a common name.

### Requirement 7: Existing test suite compatibility

**User Story:** As a pipeline developer, I want all existing tests to continue passing after changes, so that regressions are caught.

#### Acceptance Criteria

1. WHEN pipeline code is modified, THE Pipeline SHALL pass all 15 existing tests in `scripts/catalog/tests/`.
2. THE Pipeline SHALL add new tests covering OpenFarm_Canonical creation, cultivar name parsing, genus-level matching, and updated classification logic.
3. THE Pipeline SHALL add a property-based test verifying that FOR ALL valid canonical records, the classification function produces a `relevance_class` that is a member of the defined `ENUMS.relevanceClass` set.
4. THE Pipeline SHALL add a property-based test verifying that FOR ALL records with `edible: true` and no active guardrail flags, the Classifier does not assign `relevance_class` of `non_food`.

### Requirement 8: Import-ready SQL generation

**User Story:** As a pipeline operator, I want the promotion step to produce SQL upsert statements that map promoted records into the existing database schema (`crops`, `crop_profiles`, `crop_zone_suitability`), so that I can bulk-import enriched catalog data without manual transformation.

#### Acceptance Criteria

1. THE Pipeline SHALL generate a SQL file from `promoted_crops.jsonl` that inserts or upserts into the `crops` table with all required columns: `slug` (derived from `common_name`), `common_name`, `scientific_name`, `category`, `description`, `source_provider`, `source_record_id`, `import_batch_id`, `imported_at`, and `last_verified_at`.
2. THE Pipeline SHALL generate `crop_profiles` rows for each promoted record that has growing attributes (`water_requirement`, `light_requirements`, `life_cycle`), mapping `water_requirement` to `crop_profiles.water_requirement`, `light_requirements` to `crop_profiles.sun_requirement`, and storing remaining enrichment fields in `crop_profiles.attributes` JSONB.
3. THE Pipeline SHALL generate `crop_zone_suitability` rows for each promoted record that has `hardiness_zones`, deriving `min_zone` and `max_zone` from the zone array.
4. THE Pipeline SHALL use `ON CONFLICT` upsert semantics keyed on `(source_provider, source_record_id)` for `crops` and `(crop_id, variety_id)` for `crop_profiles`, so that re-running the import is idempotent.
5. THE Pipeline SHALL set `source_provider` to `pipeline_enriched` and `source_record_id` to the `canonical_id` for each promoted crop.
6. THE Pipeline SHALL derive `slug` by lowercasing `common_name`, replacing non-alphanumeric characters with hyphens, and deduplicating with a numeric suffix when collisions occur.
