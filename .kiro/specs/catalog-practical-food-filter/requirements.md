# Requirements Document

## Introduction

The crop data enrichment pipeline (`scripts/catalog/`) was recently enhanced (catalog-pipeline-quality spec) to promote more crops into the catalog. The pipeline now achieves 17.5% promotion rate against the 400-sample benchmark, well above the 5% threshold. However, reviewing the `promoted_crops.jsonl` output reveals quality problems: the pipeline treats all edible evidence equally, so "technically edible" plants (conifer inner bark, bush tucker species, industrial weeds, wild foraging plants) are promoted alongside practical food crops.

This platform helps community growers share food. The catalog should contain crops people actually grow and share — vegetables, fruits, grains, herbs — not survival-foraging plants or industrial species that happen to have an edible part.

Specific problems observed:
- **Conifer trees bypassing guardrails**: Silver fir, Cascade fir, Balsam fir, Fraser fir, and Corkbark fir promoted as "core" food crops because Permapeople reports "edible inner bark". The conifer guardrail is overridden when OpenFarm support plus any edible evidence is present.
- **Obscure non-cultivated species**: ~10 Acacia/wattle species promoted (umbrella mulga, papuan wattle, knife-leaf wattle, etc.). These are real bush tucker plants but not something typical community growers cultivate or share.
- **Misclassified industrial/weed plants**: China jute (Abutilon theophrasti) classified as "fruit" but is primarily an industrial fiber crop and invasive weed. Chew stick (Gouania lupuloides) is a dental hygiene plant, not food.
- **Wild species with marginal edibility**: Several wild Rosa species promoted as "fruit_shrub" based on edible rose hips, but these wild species are not typically cultivated for food sharing.

The root cause is that the Classifier and Promotion_Gate treat all edible evidence equally — "edible inner bark" counts the same as "edible fruit". The pipeline needs a practical food filter that distinguishes between marginal edibility and genuine food-crop signals.

Changes are surgical modifications to `step4_classify.mjs` and `promote.mjs`, following the same incremental approach as the previous catalog-pipeline-quality spec.

## Glossary

- **Pipeline**: The crop data enrichment pipeline in `scripts/catalog/` (step1 through step6 plus promote)
- **Classifier**: The `classifyCanonical` function in `step4_classify.mjs` that assigns `relevance_class`, `catalog_status`, and `review_status`
- **Promotion_Gate**: The logic in `promote.mjs` that determines whether a classified record becomes an import-ready promoted crop
- **Benchmark**: The 400-sample quality gate (`benchmark_400.mjs`) that validates pipeline output against defined thresholds
- **Edible_Parts**: The array of plant parts reported as edible by source providers (e.g., `["fruit", "leaves", "inner bark"]`)
- **Strong_Edible_Parts**: Edible parts that indicate practical food cultivation: `fruit`, `leaves`, `root`, `seed`, `tuber`, `grain`, `shoots`, `flowers`, `seedpod`, `legume`
- **Weak_Edible_Parts**: Edible parts that indicate marginal or survival-foraging edibility: `inner bark`, `bark`, `sap`, `resin`, `gum`, `pollen`
- **Practical_Food_Score**: A numeric score derived from the quality of edible parts, used to distinguish practical food crops from marginally edible plants
- **Conifer_Guardrail**: The existing regex-based check in the Classifier that flags conifer species (Pinaceae family, fir/pine/spruce genera)
- **Industrial_Guardrail**: The existing regex-based check in the Classifier that flags industrial/fiber crops
- **Cultivation_Signal**: Evidence that a plant is commonly cultivated in gardens rather than wild-foraged, derived from category, life cycle, and source provider agreement
- **OpenFarm_Support**: A flag indicating that the record has a matched OpenFarm source, used as a positive food-relevance signal
- **Strong_Food_Evidence**: A flag indicating edible evidence from two or more independent source providers

## Requirements

### Requirement 1: Edible parts quality scoring

**User Story:** As a pipeline operator, I want the Classifier to weight edible parts by food-relevance quality, so that plants with only weak edible parts (inner bark, sap, resin) score lower than plants with strong edible parts (fruit, leaves, root, seed).

#### Acceptance Criteria

1. THE Classifier SHALL assign each edible part in the Edible_Parts array a quality tier: Strong_Edible_Parts receive a high weight and Weak_Edible_Parts receive a
uired for food-crop classification.
5. THE Classifier SHALL expose the Practical_Food_Score and the contributing edible parts in the classification output for diagnostic purposes.

### Requirement 2: Strengthen conifer guardrail

**User Story:** As a pipeline operator, I want the conifer guardrail to reject conifer species that have only weak edible evidence, so that fir trees with "edible inner bark" do not get promoted as food crops.

#### Acceptance Criteria

1. WHEN a canonical record matches conifer patterns (Pinaceae family or conifer genus names), THE Conifer_Guardrail SHALL activate unless the record has Strong_Food_Evidence AND at least one Strong_Edible_Part.
2. WHEN a conifer record has OpenFarm_Support but only Weak_Edible_Parts, THE Conifer_Guardrail SHALL remain active and the record SHALL be classified as `non_food`.
3. WHEN a conifer record has both Strong_Food_Evidence and at least one Strong_Edible_Part (e.g., pine nuts from stone pine), THE Conifer_Guardrail SHALL be overridden and the record SHALL be eligible for food-crop classification.
4. THE Classifier SHALL not use OpenFarm_Support alone as sufficient reason to override the Conifer_Guardrail.

### Requirement 3: Category validation for industrial and non-food plants

**User Story:** As a pipeline operator, I want the Classifier to detect and reject industrial, fiber, and non-food plants that are miscategorized as food crops, so that plants like China jute and chew stick do not appear in the catalog.

#### Acceptance Criteria

1. THE Classifier SHALL maintain a list of known industrial and non-food species patterns (common names and scientific names) that should be excluded regardless of edible evidence.
2. WHEN a canonical record matches an industrial species pattern (e.g., "jute", "hemp fiber", "chew stick"), THE Industrial_Guardrail SHALL activate unless the record has Strong_Food_Evidence from two or more independent providers AND at least one Strong_Edible_Part.
3. WHEN a canonical record has a primary use described as industrial, fiber, timber, or dental/medicinal (not food), THE Classifier SHALL not classify the record as `food_crop_core`.
4. IF a record triggers the Industrial_Guardrail, THEN THE Classifier SHALL classify the record as `non_food` or `industrial_crop` and set `catalog_status` to `excluded`.

### Requirement 4: Practical cultivation signal

**User Story:** As a pipeline operator, I want the Classifier to prefer plants that people actually grow in gardens over wild-foraged or obscure species, so that the catalog contains crops relevant to community food sharing.

#### Acceptance Criteria

1. THE Classifier SHALL compute a Cultivation_Signal based on the combination of: presence in OpenFarm (a garden-focused database), category assignment to a cultivated food type (vegetable, fruit, herb, grain, legume), and life cycle indicating cultivated use (annual, biennial).
2. WHEN a canonical record lacks Cultivation_Signal indicators (no OpenFarm presence, no cultivated food category, perennial-only wild species), THE Classifier SHALL classify the record as `food_crop_niche` rather than `food_crop_core`, even when edible evidence is present.
3. WHEN a canonical record has strong Cultivation_Signal indicators (OpenFarm presence AND a cultivated food category AND Strong_Edible_Parts), THE Classifier SHALL classify the record as `food_crop_core`.
4. THE Classifier SHALL not promote wild-foraged-only species to `food_crop_core` unless Strong_Food_Evidence from multiple providers confirms practical food use.

### Requirement 5: Promotion gate tightening for weak edible evidence

**User Story:** As a pipeline operator, I want the Promotion_Gate to require a minimum Practical_Food_Score for promotion, so that marginally edible plants do not enter the promoted catalog.

#### Acceptance Criteria

1. THE Promotion_Gate SHALL require a Practical_Food_Score above a configurable minimum threshold for a record to be promoted.
2. WHEN a record has `catalog_status` of `core` or `extended` but a Practical_Food_Score below the minimum threshold, THE Promotion_Gate SHALL reject the record and route it to the review queue.
3. WHEN a record has a Practical_Food_Score at or above the minimum threshold AND passes all other existing promotion checks (confidence band, guardrails, edible signal), THE Promotion_Gate SHALL promote the record.
4. THE Promotion_Gate SHALL log the Practical_Food_Score as part of the promotion decision for diagnostic traceability.

### Requirement 6: Benchmark stability after tightening

**User Story:** As a pipeline operator, I want the 400-sample benchmark to continue passing after the practical food filter is applied, so that the tightening removes bad records without killing the promotion rate.

#### Acceptance Criteria

1. WHEN the Pipeline runs against the full source datasets with the practical food filter active, THE Benchmark SHALL report a promoted percentage of at least 5% of the sampled records.
2. WHEN the Pipeline runs against the full source datasets with the practical food filter active, THE Benchmark SHALL report `pass: true` with all four threshold checks passing (promoted_pct, needs_review_pct, suspicious_pct, fuzzy_match_pct).
3. WHEN the Pipeline runs against the full source datasets, THE Benchmark SHALL report zero conifer species (Pinaceae family) in the promoted output with only Weak_Edible_Parts.
4. WHEN the Pipeline runs against the full source datasets, THE Benchmark SHALL report zero known industrial/fiber species in the promoted output.

### Requirement 7: Existing test suite compatibility

**User Story:** As a pipeline developer, I want all existing tests to continue passing after the practical food filter changes, so that regressions are caught.

#### Acceptance Criteria

1. WHEN pipeline code is modified, THE Pipeline SHALL pass all existing tests in `scripts/catalog/tests/`.
2. THE Pipeline SHALL add new unit tests covering: edible parts quality scoring, strengthened conifer guardrail behavior, industrial species rejection, and Practical_Food_Score-based promotion gating.
3. THE Pipeline SHALL add a property-based test verifying that FOR ALL canonical records where every edible part is a Weak_Edible_Part and a conifer pattern matches, the Classifier assigns `relevance_class` of `non_food`.
4. THE Pipeline SHALL add a property-based test verifying that FOR ALL canonical records with at least one Strong_Edible_Part and no active guardrail, the Classifier does not assign `relevance_class` of `non_food`.
