# Design Document: Catalog Practical Food Filter

## Overview

This design describes **surgical modifications** to the existing crop data enrichment pipeline classifier (`step4_classify.mjs`) and promotion gate (`promote.mjs`) to exclude technically-edible-but-not-practical plants from the promoted catalog. The pipeline currently achieves a 17.5% promotion rate, but review of `promoted_crops.jsonl` reveals quality problems: conifer trees with "edible inner bark", obscure bush tucker species, industrial fiber crops, and wild-foraged plants are promoted alongside practical food crops.

The root cause is that `classifyCanonical()` and the promotion gate treat all edible evidence equally — "edible inner bark" counts the same as "edible fruit". This design introduces:

1. **Edible parts quality scoring** — a `Practical_Food_Score` that weights strong edible parts (fruit, leaves, root, seed) higher than weak
 rewrite.** Every change targets a specific function or code path in an existing file.
- **Preserve existing test compatibility.** All existing tests must continue to pass.
- **Tighten, don't break.** The 400-sample benchmark must still pass at ≥5% promoted.
- **Configurable thresholds.** Score weights and minimum thresholds live in `lib/config.mjs`.

## Architecture

The pipeline architecture is unchanged. Only the classification and promotion steps are modified:

```mermaid
graph LR
  A[Step 1-3: Identity/Match/Normalize] --> D[Step 4: Classify<br/>+ Practical_Food_Score<br/>+ Strengthened guardrails]
  D --> E[Step 5-6: Derive/Augment]
  E --> G[Promote<br/>+ Practical_Food_Score gate]
```

### Files Modified

| File | Action | Summary |
|------|--------|---------|
| `scripts/catalog/lib/config.mjs` | **Modify** | Add `EDIBLE_PART_TIERS`, `PRACTICAL_FOOD_SCORE`, `CULTIVATION_CATEGORIES`, `INDUSTRIAL_SPECIES_PATTERNS` constants |
| `scripts/catalog/step4_classify.mjs` | **Modify** | Add `computePracticalFoodScore()`, `computeCultivationSignal()`, strengthen conifer/industrial guardrails, expose new fields in output |
| `scripts/catalog/promote.mjs` | **Modify** | Add `Practical_Food_Score` minimum threshold check to promotion gate |
| `scripts/catalog/tests/step4_practical.test.mjs` | **Add** | Unit tests for edible parts scoring, strengthened guardrails, cultivation signals |
| `scripts/catalog/tests/practical_food.property.test.mjs` | **Add** | Property-based tests for practical food filter invariants |

## Components and Interfaces

### 1. Edible Parts Quality Scoring

**File:** `scripts/catalog/lib/config.mjs` (new constants) + `scripts/catalog/step4_classify.mjs` (new function)

#### Configuration (`lib/config.mjs`)

```javascript
export const EDIBLE_PART_TIERS = {
  strong: new Set([
    'fruit', 'leaves', 'leaf', 'root', 'seed', 'tuber', 'grain',
    'shoots', 'flowers', 'seedpod', 'legume', 'bulb', 'stem', 'nut',
  ]),
  weak: new Set([
    'inner bark', 'bark', 'sap', 'resin', 'gum', 'pollen',
  ]),
};

export const PRACTICAL_FOOD_SCORE = {
  strongPartWeight: 2,
  weakPartWeight: 0.25,
  edibleFlagBonus: 0.5,       // bonus when edible: true is set
  cultivationBonus: 1.0,      // bonus for cultivation signal
  multiProviderBonus: 1.0,    // bonus for strong food evidence (≥2 providers)
  minimumForPromotion: 2.0,   // minimum score to pass promotion gate
};
```

#### New function in `step4_classify.mjs`

```javascript
export function computePracticalFoodScore(records) {
  const allParts = new Set();
  let hasEdibleFlag = false;

  for (const rec of records) {
    const normalized = rec.normalized || {};
    if (normalized.edible === true) hasEdibleFlag = true;
    for (const part of (normalized.edible_parts || [])) {
      allParts.add(part.toLowerCase().trim());
    }
  }

  let score = 0;
  const strongParts = [];
  const weakParts = [];

  for (const part of allParts) {
    if (EDIBLE_PART_TIERS.strong.has(part)) {
      score += PRACTICAL_FOOD_SCORE.strongPartWeight;
      strongParts.push(part);
    } else if (EDIBLE_PART_TIERS.weak.has(part)) {
      score += PRACTICAL_FOOD_SCORE.weakPartWeight;
      weakParts.push(part);
    }
    // Unknown parts get 0 — conservative default
  }

  if (hasEdibleFlag && strongParts.length > 0) {
    score += PRACTICAL_FOOD_SCORE.edibleFlagBonus;
  }

  return { score, strongParts, weakParts, hasEdibleFlag };
}
```

The score is computed from the union of all `edible_parts` across source records. Strong parts contribute 2 points each, weak parts contribute 0.25 each. A bonus of 0.5 is added when `edible: true` is set AND at least one strong part exists. This means a plant with only "inner bark" scores 0.25, while a plant with "fruit" scores 2.5 (2 + 0.5 bonus).

### 2. Strengthened Conifer Guardrail

**File:** `scripts/catalog/step4_classify.mjs`

**Current behavior:** The conifer guardrail activates when `CONIFER_TERMS` matches the name text, but is overridden when `strongFoodEvidence` is present OR when `hasOpenFarmSupport && edibleEvidenceSources.size > 0`.

**New behavior:** The conifer guardrail activates when `CONIFER_TERMS` matches, and is overridden ONLY when:
- `strongFoodEvidence` is present (≥2 providers with edible signals), AND
- At least one `Strong_Edible_Part` is present in the combined edible parts.

OpenFarm support alone is no longer sufficient to override the conifer guardrail. This prevents fir trees with "edible inner bark" from being promoted just because they appear in OpenFarm.

```javascript
// BEFORE (current):
const coniferGuardrail = CONIFER_TERMS.test(lowerName)
  && !strongFoodEvidence
  && !(hasOpenFarmSupport && edibleEvidenceSources.size > 0);

// AFTER (new):
const hasStrongEdiblePart = practicalFoodResult.strongParts.length > 0;
const coniferGuardrail = CONIFER_TERMS.test(lowerName)
  && !(strongFoodEvidence && hasStrongEdiblePart);
```

### 3. Industrial/Non-Food Category Validation

**File:** `scripts/catalog/lib/config.mjs` (new constant) + `scripts/catalog/step4_classify.mjs`

#### Configuration (`lib/config.mjs`)

```javascript
export const INDUSTRIAL_SPECIES_PATTERNS = [
  /\bjute\b/i, /\bhemp\s+fiber\b/i, /\bchew\s+stick\b/i,
  /\bkenaf\b/i, /\bsisal\b/i, /\bramie\b/i,
  /\babutilon\s+theophrasti\b/i,  // China jute
  /\bgouania\b/i,                  // Chew stick genus
  /\bcorchorus\b/i,                // Jute genus
];
```

**Enhancement to industrial guardrail:** In addition to the existing `INDUSTRIAL_TERMS` regex on utility text, also check name text against `INDUSTRIAL_SPECIES_PATTERNS`. The override condition is tightened to match the conifer guardrail: requires `strongFoodEvidence && hasStrongEdiblePart`.

```javascript
// BEFORE:
const industrialGuardrail = INDUSTRIAL_TERMS.test(lowerUtility)
  && !strongFoodEvidence
  && !(hasOpenFarmSupport && edibleEvidenceSources.size > 0);

// AFTER:
const industrialNameMatch = INDUSTRIAL_SPECIES_PATTERNS.some(p => p.test(lowerName));
const industrialGuardrail = (INDUSTRIAL_TERMS.test(lowerUtility) || industrialNameMatch)
  && !(strongFoodEvidence && hasStrongEdiblePart);
```

### 4. Practical Cultivation Signal

**File:** `scripts/catalog/lib/config.mjs` (new constant) + `scripts/catalog/step4_classify.mjs` (new function)

#### Configuration (`lib/config.mjs`)

```javascript
export const CULTIVATION_CATEGORIES = new Set([
  'vegetable', 'fruit', 'herb', 'grain', 'legume', 'spice',
  'fruit_tree', 'fruit_shrub', 'root_vegetable', 'leafy_green',
]);

export const CULTIVATED_LIFE_CYCLES = new Set([
  'annual', 'biennial',
]);
```

#### New function in `step4_classify.mjs`

```javascript
function computeCultivationSignal(records, hasOpenFarmSupport) {
  let signal = 0;
  if (hasOpenFarmSupport) signal += 1;

  const categories = new Set();
  const lifeCycles = new Set();
  for (const rec of records) {
    const n = rec.normalized || {};
    if (n.category) categories.add(n.category.toLowerCase().trim());
    if (n.life_cycle) lifeCycles.add(n.life_cycle.toLowerCase().trim());
  }

  const hasCultivatedCategory = [...categories].some(c => CULTIVATION_CATEGORIES.has(c));
  if (hasCultivatedCategory) signal += 1;

  const hasCultivatedLifeCycle = [...lifeCycles].some(lc => CULTIVATED_LIFE_CYCLES.has(lc));
  if (hasCultivatedLifeCycle) signal += 1;

  return signal; // 0-3 range
}
```

**Integration into classification logic:**
- When `cultivationSignal >= 2` AND `hasStrongEdiblePart`, add `PRACTICAL_FOOD_SCORE.cultivationBonus` to the practical food score.
- When `cultivationSignal === 0` AND no `strongFoodEvidence`, classify as `food_crop_niche` instead of `food_crop_core`, even with edible evidence.

### 5. Promotion Gate Tightening

**File:** `scripts/catalog/promote.mjs`

**Current gate logic:**
```javascript
const promotionGatePassed = confidenceGatePassed && edibleSignal && !guardrailBlocked;
```

**Enhanced gate logic:**
```javascript
const practicalFoodScore = rec.practical_food_score ?? 0;
const minScore = PRACTICAL_FOOD_SCORE.minimumForPromotion; // 2.0

const promotionGatePassed = confidenceGatePassed
  && edibleSignal
  && !guardrailBlocked
  && practicalFoodScore >= minScore;
```

Records that pass all existing checks but have a `practical_food_score` below 2.0 are routed to the review queue instead of being promoted. This catches plants with only weak edible parts (score < 2.0) while allowing any plant with at least one strong edible part (score ≥ 2.0) through.

### 6. Classification Output Changes

The `classifyCanonical()` return object gains these new fields:

```javascript
{
  // ... existing fields ...
  practical_food_score: 2.5,
  practical_food_parts: { strong: ['fruit'], weak: [] },
  cultivation_signal: 2,
}
```

These fields flow through step5/step6 unchanged and are available to the promotion gate in `promote.mjs`.

## Data Models

### Edible Part Tiers

| Tier | Parts | Weight |
|------|-------|--------|
| Strong | fruit, leaves, leaf, root, seed, tuber, grain, shoots, flowers, seedpod, legume, bulb, stem, nut | 2.0 each |
| Weak | inner bark, bark, sap, resin, gum, pollen | 0.25 each |
| Unknown | anything else | 0 |

### Practical Food Score Composition

| Component | Value | Condition |
|-----------|-------|-----------|
| Strong edible part | +2.0 per unique part | Part in `EDIBLE_PART_TIERS.strong` |
| Weak edible part | +0.25 per unique part | Part in `EDIBLE_PART_TIERS.weak` |
| Edible flag bonus | +0.5 | `edible: true` AND ≥1 strong part |
| Cultivation bonus | +1.0 | `cultivationSignal >= 2` AND ≥1 strong part |
| Multi-provider bonus | +1.0 | `strongFoodEvidence` (≥2 providers) |

### Score Examples

| Plant | Edible Parts | Score | Promoted? |
|-------|-------------|-------|-----------|
| Tomato | fruit | 2.5 (2 + 0.5 bonus) | Yes |
| Silver fir | inner bark | 0.25 | No |
| Pine nut (stone pine) | nut + seed (2 providers) | 5.5+ | Yes |
| China jute | (industrial guardrail) | N/A — excluded | No |
| Wild rose | fruit (rose hips), 1 provider only | 2.5 | Maybe (depends on confidence) |
| Acacia (bush tucker) | seed, 1 provider, no OpenFarm | 2.0 | Niche, not core |

### Classification Output Record (enhanced)

```jsonc
{
  "canonical_id": "openfarm:solanum lycopersicum",
  "relevance_class": "food_crop_core",
  "catalog_status": "core",
  "review_status": "auto_approved",
  "source_confidence": 0.95,
  "match_confidence_band": "high",
  "source_agreement_score": 1.0,
  "has_openfarm_support": true,
  "strong_food_evidence": true,
  "edible_evidence_sources": ["openfarm", "permapeople"],
  "practical_food_score": 4.5,           // NEW
  "practical_food_parts": {              // NEW
    "strong": ["fruit"],
    "weak": []
  },
  "cultivation_signal": 3,              // NEW
  "guardrail_flags": {
    "conifer": false,
    "industrial": false
  },
  "source_records": [...]
}
```

### Config Constants Summary (`lib/config.mjs` additions)

```javascript
// New exports added to lib/config.mjs:
export const EDIBLE_PART_TIERS = { strong: Set, weak: Set };
export const PRACTICAL_FOOD_SCORE = { strongPartWeight, weakPartWeight, ... };
export const CULTIVATION_CATEGORIES = Set;
export const CULTIVATED_LIFE_CYCLES = Set;
export const INDUSTRIAL_SPECIES_PATTERNS = RegExp[];
```


## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Practical food score is monotonic in strong parts

*For any* set of source records, the `Practical_Food_Score` returned by `computePracticalFoodScore()` must equal the sum of: (
ust be strictly below `PRACTICAL_FOOD_SCORE.minimumForPromotion` (2.0). Conversely, *for any* set of source records containing at least one `Strong_Edible_Part`, the `Practical_Food_Score` must be ≥ `PRACTICAL_FOOD_SCORE.minimumForPromotion`.

**Validates: Requirements 1.3, 1.4**

### Property 3: Conifer guardrail blocks weak-only edible evidence

*For any* set of source records where the combined name text matches conifer patterns (`CONIFER_TERMS`) and every edible part is a `Weak_Edible_Part` (no strong parts), `classifyCanonical()` must return `relevance_class` of `non_food`, regardless of `OpenFarm_Support` or number of providers.

**Validates: Requirements 2.1, 2.2, 2.4, 7.3**

### Property 4: Conifer guardrail override requires strong evidence AND strong parts

*For any* set of source records where the combined name text matches conifer patterns, `strongFoodEvidence` is true (≥2 providers with edible signals), and at least one `Strong_Edible_Part` is present, the conifer guardrail must be inactive (`guardrail_flags.conifer === false`) and the record must be eligible for food-crop classification (not `non_food`).

**Validates: Requirements 2.3**

### Property 5: Industrial guardrail blocks matching patterns without strong override

*For any* set of source records where the combined name text matches an `INDUSTRIAL_SPECIES_PATTERNS` entry or the utility text matches `INDUSTRIAL_TERMS`, and the record lacks both `strongFoodEvidence` and a `Strong_Edible_Part`, `classifyCanonical()` must return `relevance_class` of `non_food` or `industrial_crop` with `catalog_status` of `excluded`.

**Validates: Requirements 3.2, 3.3, 3.4**

### Property 6: Cultivation signal affects core vs niche classification

*For any* set of source records with edible evidence and at least one `Strong_Edible_Part`, but with `cultivationSignal === 0` (no OpenFarm, no cultivated category, no cultivated life cycle) and no `strongFoodEvidence`, `classifyCanonical()` must return `food_crop_niche` rather than `food_crop_core`.

**Validates: Requirements 4.2, 4.4**

### Property 7: Promotion gate enforces practical food score threshold

*For any* classified record where `practical_food_score` is below `PRACTICAL_FOOD_SCORE.minimumForPromotion`, the promotion gate must reject the record (not promote), even if all other promotion checks pass (eligible class, eligible review, confidence band, edible signal, no guardrail). Conversely, *for any* record where `practical_food_score` meets the threshold AND all other checks pass, the record must be promoted.

**Validates: Requirements 5.1, 5.2, 5.3**

### Property 8: Strong edible part without guardrail prevents non_food

*For any* set of source records where at least one record has a `Strong_Edible_Part` in `normalized.edible_parts` and no record's name matches conifer or industrial patterns, `classifyCanonical()` must not return `relevance_class` of `non_food`.

**Validates: Requirements 7.4**

### Property 9: Classification output includes diagnostic fields

*For any* valid array of source records, the object returned by `classifyCanonical()` must contain `practical_food_score` (a finite number ≥ 0), `practical_food_parts` (an object with `strong` and `weak` arrays), and `cultivation_signal` (a finite number ≥ 0).

**Validates: Requirements 1.5**

## Error Handling

### Existing Error Patterns (preserved)

All existing error handling in the pipeline is preserved unchanged:
- Missing input files throw with descriptive messages
- Checksum mismatches throw with reset instructions
- Progress tracking enables resume after partial failures

### New Error Scenarios

| Scenario | Handling |
|----------|----------|
| `edible_parts` contains unknown part name | Score contribution is 0 (conservative default); part is not included in `strong` or `weak` diagnostic arrays |
| `edible_parts` is null/undefined | Treated as empty array; score contribution is 0 |
| `practical_food_score` missing on record reaching promotion gate | Defaults to 0 via `rec.practical_food_score ?? 0`; record fails score threshold |
| `normalized.category` or `normalized.life_cycle` missing | Cultivation signal contribution is 0 for that component; no error thrown |
| All source records have empty `normalized` | Score is 0, cultivation signal is 0; classification proceeds with existing logic |

### Backward Compatibility

The new fields (`practical_food_score`, `practical_food_parts`, `cultivation_signal`) are additive to the classification output. Steps 5 and 6 pass through unknown fields unchanged. The promotion gate reads `practical_food_score` with a `?? 0` fallback, so records classified before this change (without the field) will default to score 0 and be routed to review — a safe degradation.

## Testing Strategy

### Existing Tests (must continue passing)

All existing tests in `scripts/catalog/tests/` must pass without modification. The changes to `classifyCanonical()` are additive (new fields, tightened guardrails) and the existing test fixtures use safe plant names that have strong edible parts, so they will continue to classify correctly.

Key existing test files:
- `step4_tuned.test.mjs` — tests OpenFarm-originated classification, edible evidence, guardrail behavior
- `classification.property.test.mjs` — property tests for classifier invariants (P6-P9 from previous spec)
- `promotion.property.test.mjs` — property tests for promotion gate

### New Unit Tests

| File | Coverage |
|------|----------|
| `tests/step4_practical.test.mjs` | `computePracticalFoodScore()`: strong parts scoring, weak parts scoring, mixed parts, empty parts, edible flag bonus, unknown parts ignored. Strengthened conifer guardrail: fir with inner bark → non_food, pine nut with strong evidence → overridden. Industrial species patterns: China jute → excluded, chew stick → excluded. Cultivation signal: OpenFarm + vegetable category → core, no signals → niche. |

### New Property-Based Tests

All property tests use `fast-check` (already a dependency). Each test runs minimum 100 iterations.

| File | Properties Covered | Tag Format |
|------|-------------------|------------|
| `tests/practical_food.property.test.mjs` | P1, P2, P3, P4, P5, P6, P7, P8, P9 | `Feature: catalog-practical-food-filter, Property N: ...` |

### Property Test Configuration

```javascript
// Each property test must:
// 1. Use fast-check with { numRuns: 100 } minimum
// 2. Reference the design property in a comment tag
// 3. Be implemented as a SINGLE property-based test per design property

// Example:
// Feature: catalog-practical-food-filter, Property 3: Conifer guardrail blocks weak-only edible evidence
test('conifer + weak-only edible parts → non_food regardless of OpenFarm', async () => {
  await fc.assert(
    fc.asyncProperty(arbConiferWeakOnlyRecords, async (records) => {
      const result = classifyCanonical(records);
      assert.equal(result.relevance_class, 'non_food');
      assert.equal(result.guardrail_flags.conifer, true);
    }),
    { numRuns: 100 }
  );
});
```

### Dual Testing Approach

- **Unit tests** verify specific examples: fir trees with inner bark, China jute rejection, pine nut override, tomato scoring, empty edible parts.
- **Property tests** verify universal invariants: score monotonicity, threshold dichotomy, guardrail activation/deactivation across all generated inputs, promotion gate enforcement.
- Both are complementary: unit tests catch concrete regressions from known problem plants, property tests catch unexpected input combinations.

### Benchmark Validation

After all code changes, run the full pipeline and benchmark:
```bash
cd scripts/catalog
node run_pipeline.mjs --reset
node benchmark_400.mjs
```
The benchmark must report `pass: true` with `promoted_pct >= 5`. The expectation is that the promotion rate will decrease from 17.5% (some bad records removed) but remain well above the 5% threshold since the filter targets a small number of problematic species.
