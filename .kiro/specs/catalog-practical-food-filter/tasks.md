# Implementation Plan: Catalog Practical Food Filter

## Overview

Surgical modifications to the existing crop data enrichment pipeline at `scripts/catalog/`. Changes add new constants to `lib/config.mjs`, tighten the classifier in `step4_classify.mjs` (practical food scoring, strengthened guardrails, cultivation signal), tighten the promotion gate in `promote.mjs` (minimum practical food score), and add new test files. All code is JavaScript (Node.js ESM `.mjs`). Tests run via `node --test` in `scripts/catalog/`.

## Tasks

- [x] 1. Add new constants to `lib/config.mjs`
  - [x] 1.1 Add `EDIBLE_PART_TIERS`, `PRACTICAL_FOOD_SCORE`, `CULTIVATION_CATEGORIES`, `CULTIVATED_LIFE_CYCLES`, and `INDUSTRIAL_SPECIES_PATTERNS` exports to `scripts/catalog/lib/config.mjs`
    - `EDIBLE_PART_TIERS.strong`: Set of strong edible parts (fruit, leaves, leaf, root, seed, tuber, grain, shoots, flowers, seedpod, legume, bulb, stem, nut)
    - `EDIBLE_PART_TIERS.weak`: Set of weak edible parts (inner bark, bark, sap, resin, gum, pollen)
    - `PRACTICAL_FOOD_SCORE`: object with `strongPartWeight: 2`, `weakPartWeight: 0.25`, `edibleFlagBonus: 0.5`, `cultivationBonus: 1.0`, `multiProviderBonus: 1.0`, `minimumForPromotion: 2.0`
    - `CULTIVATION_CATEGORIES`: Set of cultivated food categories (vegetable, fruit, herb, grain, legume, spice, fruit_tree, fruit_shrub, root_vegetable, leafy_green)
    - `CULTIVATED_LIFE_CYCLES`: Set of cultivated life cycles (annual, biennial)
    - `INDUSTRIAL_SPECIES_PATTERNS`: array of RegExp patterns for known industrial/non-food species (jute, hemp fiber, chew stick, kenaf, sisal,
lib/config.mjs`
    - Collect all `edible_parts` from all source records' `normalized` objects into a deduplicated set (lowercased, trimmed)
    - Track `hasEdibleFlag` from any record with `normalized.edible === true`
    - Score: strong parts get `strongPartWeight` (2) each, weak parts get `weakPartWeight` (0.25) each, unknown parts get 0
    - Add `edibleFlagBonus` (0.5) when `hasEdibleFlag && strongParts.length > 0`
    - Export the function for testability
    - Return `{ score, strongParts, weakParts, hasEdibleFlag }`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [x] 3.2 Add `computeCultivationSignal(records, hasOpenFarmSupport)` function to `scripts/catalog/step4_classify.mjs`
    - Import `CULTIVATION_CATEGORIES` and `CULTIVATED_LIFE_CYCLES` from `lib/config.mjs`
    - Start signal at 0; add 1 for OpenFarm support, 1 for cultivated category match, 1 for cultivated life cycle match
    - Return integer 0–3
    - _Requirements: 4.1, 4.2, 4.3_

- [x] 4. Integrate scoring and signals into `classifyCanonical()` in `step4_classify.mjs`
  - [x] 4.1 Wire `computePracticalFoodScore()` and `computeCultivationSignal()` into `classifyCanonical()`
    - Call `computePracticalFoodScore(records)` early in the function
    - Call `computeCultivationSignal(records, hasOpenFarmSupport)` after OpenFarm support is determined
    - Add `cultivationBonus` to score when `cultivationSignal >= 2 && hasStrongEdiblePart`
    - Add `multiProviderBonus` to score when `strongFoodEvidence`
    - _Requirements: 1.1, 1.5, 4.1_

  - [x] 4.2 Strengthen conifer guardrail in `classifyCanonical()`
    - Change from: `!strongFoodEvidence && !(hasOpenFarmSupport && edibleEvidenceSources.size > 0)`
    - Change to: `!(strongFoodEvidence && hasStrongEdiblePart)` — requires BOTH strong food evidence AND at least one strong edible part to override
    - OpenFarm support alone no longer overrides the conifer guardrail
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 4.3 Strengthen industrial guardrail in `classifyCanonical()`
    - Import `INDUSTRIAL_SPECIES_PATTERNS` from `lib/config.mjs`
    - Add name-text matching against `INDUSTRIAL_SPECIES_PATTERNS` in addition to existing `INDUSTRIAL_TERMS` utility-text check
    - Change override condition to match conifer: `!(strongFoodEvidence && hasStrongEdiblePart)`
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 4.4 Integrate cultivation signal into classification logic
    - When `cultivationSignal === 0` AND no `strongFoodEvidence`, classify as `food_crop_niche` instead of `food_crop_core` even with edible evidence
    - When `cultivationSignal >= 2` AND `hasStrongEdiblePart`, eligible for `food_crop_core`
    - _Requirements: 4.2, 4.3, 4.4_

  - [x] 4.5 Add new diagnostic fields to `classifyCanonical()` return object
    - Add `practical_food_score` (number), `practical_food_parts` (`{ strong: [], weak: [] }`), `cultivation_signal` (number) to the returned object
    - _Requirements: 1.5_

- [x] 5. Checkpoint — Verify classifier changes
  - Ensure all existing tests pass (`node --test` in `scripts/catalog/`). Ask the user if questions arise.

- [x] 6. Add unit tests for practical food filter in `step4_classify.mjs`
  - [x] 6.1 Create `scripts/catalog/tests/step4_practical.test.mjs` with unit tests
    - Test `computePracticalFoodScore()`: strong parts scoring (fruit → 2.5 with edible flag), weak parts scoring (inner bark → 0.25), mixed parts, empty parts → 0, unknown parts ignored, edible flag bonus only with strong parts
    - Test strengthened conifer guardrail: fir with only inner bark → `non_food`, fir with OpenFarm + inner bark only → still `non_food`, pine nut with strong evidence + nut → guardrail overridden
    - Test strengthened industrial guardrail: China jute (abutilon theophrasti) → `excluded`, chew stick (gouania) → `excluded`, industrial species with strong food evidence + strong part → overridden
    - Test cultivation signal: OpenFarm + vegetable category + annual → signal 3, no signals → 0, cultivation signal 0 + no strong food evidence → `food_crop_niche` not `food_crop_core`
    - Test diagnostic output: `practical_food_score`, `practical_food_parts`, `cultivation_signal` present in classification output
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.4, 7.2_

- [x] 7. Add property-based tests for practical food filter
  - [x] 7.1 Create `scripts/catalog/tests/practical_food.property.test.mjs` with property tests using `fast-check`
    - All properties use `{ numRuns: 100 }` minimum

  - [x] 7.2 Write property test for score monotonicity (Property 1)
    - **Property 1: Practical food score is monotonic in strong parts**
    - For any set of source records, the practical food score equals the sum of: `strongPartWeight` × count of unique strong parts + `weakPartWeight` × count of unique weak parts + conditional bonuses
    - **Validates: Requirements 1.1, 1.2**

  - [x] 7.3 Write property test for weak-only threshold (Property 2)
    - **Property 2: Weak-only edible parts produce sub-threshold score**
    - For any set of source records where every edible part is a weak edible part, the practical food score is strictly below `minimumForPromotion` (2.0). Conversely, any record with at least one strong edible part scores ≥ `minimumForPromotion`
    - **Validates: Requirements 1.3, 1.4**

  - [x] 7.4 Write property test for conifer weak-only blocking (Property 3)
    - **Property 3: Conifer guardrail blocks weak-only edible evidence**
    - For any source records where name matches conifer patterns and every edible part is weak, `classifyCanonical()` returns `relevance_class` of `non_food` regardless of OpenFarm support or provider count
    - **Validates: Requirements 2.1, 2.2, 2.4, 7.3**

  - [x] 7.5 Write property test for conifer override (Property 4)
    - **Property 4: Conifer guardrail override requires strong evidence AND strong parts**
    - For any source records where name matches conifer patterns, `strongFoodEvidence` is true, and at least one strong edible part is present, the conifer guardrail is inactive and the record is eligible for food-crop classification
    - **Validates: Requirements 2.3**

  - [x] 7.6 Write property test for industrial guardrail (Property 5)
    - **Property 5: Industrial guardrail blocks matching patterns without strong override**
    - For any source records where name matches `INDUSTRIAL_SPECIES_PATTERNS` or utility matches `INDUSTRIAL_TERMS`, and the record lacks both `strongFoodEvidence` and a strong edible part, result is `non_food` or `industrial_crop` with `catalog_status` of `excluded`
    - **Validates: Requirements 3.2, 3.3, 3.4**

  - [x] 7.7 Write property test for cultivation signal (Property 6)
    - **Property 6: Cultivation signal affects core vs niche classification**
    - For any source records with edible evidence and at least one strong edible part, but `cultivationSignal === 0` and no `strongFoodEvidence`, result is `food_crop_niche` not `food_crop_core`
    - **Validates: Requirements 4.2, 4.4**

  - [x] 7.8 Write property test for strong edible part prevents non_food (Property 8)
    - **Property 8: Strong edible part without guardrail prevents non_food**
    - For any source records where at least one record has a strong edible part and no name matches conifer or industrial patterns, result is not `non_food`
    - **Validates: Requirements 7.4**

  - [x] 7.9 Write property test for diagnostic fields (Property 9)
    - **Property 9: Classification output includes diagnostic fields**
    - For any valid array of source records, `classifyCanonical()` returns `practical_food_score` (finite number ≥ 0), `practical_food_parts` (object with `strong` and `weak` arrays), and `cultivation_signal` (finite number ≥ 0)
    - **Validates: Requirements 1.5**

- [x] 8. Checkpoint — Verify all classifier tests
  - Ensure all existing tests pass plus new `step4_practical.test.mjs` and `practical_food.property.test.mjs`. Ask the user if questions arise.

- [x] 9. Tighten promotion gate in `promote.mjs`
  - [x] 9.1 Add `Practical_Food_Score` minimum threshold check to `promote.mjs`
    - Import `PRACTICAL_FOOD_SCORE` from `lib/config.mjs`
    - Read `practical_food_score` from each record with `?? 0` fallback
    - Add `practicalFoodScore >= PRACTICAL_FOOD_SCORE.minimumForPromotion` to `promotionGatePassed` condition
    - Records below threshold are routed to review queue instead of promoted
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 9.2 Write property test for promotion gate threshold (Property 7)
    - **Property 7: Promotion gate enforces practical food score threshold**
    - For any classified record where `practical_food_score` < `minimumForPromotion`, the promotion gate rejects the record even if all other checks pass. Conversely, records at or above threshold with all other checks passing are promoted
    - Extend `scripts/catalog/tests/promotion.property.test.mjs`
    - **Validates: Requirements 5.1, 5.2, 5.3**

- [x] 10. Checkpoint — Verify promotion gate changes
  - Ensure all existing tests pass (especially `promote.test.mjs` and `promotion.property.test.mjs`). Ask the user if questions arise.

- [x] 11. Final integration and benchmark validation
  - [x] 11.1 Verify all existing tests still pass
    - Run `node --test` in `scripts/catalog/` and confirm all original tests plus new tests pass
    - _Requirements: 7.1, 7.2_

  - [x] 11.2 Run full pipeline and benchmark
    - Run `node run_pipeline.mjs --reset` followed by `node benchmark_400.mjs`
    - Verify benchmark reports `pass: true` with `promoted_pct >= 5`
    - Verify zero conifer species with only weak edible parts in promoted output
    - Verify zero known industrial/fiber species in promoted output
    - If benchmark fails, diagnose and adjust thresholds as needed
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 12. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass (existing + new), benchmark passes. Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation after each pipeline step change
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- All changes are surgical modifications to existing files at `scripts/catalog/` — no rewrites
- Tests run via `node --test` in `scripts/catalog/`
- Pipeline runs via `node run_pipeline.mjs` in `scripts/catalog/`
