import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { computePracticalFoodScore, computeCultivationSignal, classifyCanonical } from '../step4_classify.mjs';
import {
  EDIBLE_PART_TIERS,
  PRACTICAL_FOOD_SCORE,
  CULTIVATION_CATEGORIES,
  CULTIVATED_LIFE_CYCLES,
  INDUSTRIAL_SPECIES_PATTERNS,
  ENUMS,
} from '../lib/config.mjs';

// ---------------------------------------------------------------------------
// Shared generators (same patterns as classification.property.test.mjs)
// ---------------------------------------------------------------------------

const arbProvider = fc.constantFrom('openfarm', 'permapeople', 'usda');
const arbMatchType = fc.constantFrom(...ENUMS.matchType);
const arbMatchScore = fc.double({ min: 0, max: 1, noNaN: true });

const SAFE_SCIENTIFIC = [
  'solanum lycopersicum', 'cucumis sativus', 'daucus carota',
  'beta vulgaris', 'lactuca sativa', 'capsicum annuum',
  'phaseolus vulgaris', 'zea mays', 'oryza sativa',
  'triticum aestivum', 'mangifera indica', 'musa acuminata',
];
const SAFE_COMMON = [
  'tomato', 'cucumber', 'carrot', 'beet', 'lettuce', 'pepper',
  'bean', 'corn', 'rice', 'wheat', 'mango', 'banana',
];

const arbSafeSciName = fc.constantFrom(...SAFE_SCIENTIFIC);
const arbSafeCommonName = fc.constantFrom(...SAFE_COMMON);

const SAFE_UTILITY = ['food', 'culinary', 'edible', 'fruit', 'vegetable'];

const STRONG_PARTS = [...EDIBLE_PART_TIERS.strong];
const WEAK_PARTS = [...EDIBLE_PART_TIERS.weak];

const arbStrongPart = fc.constantFrom(...STRONG_PARTS);
const arbWeakPart = fc.constantFrom(...WEAK_PARTS);

const CONIFER_NAMES = [
  'abies alba', 'pinus strobus', 'picea abies',
  'cedrus libani', 'juniperus communis', 'taxus baccata',
  'abies balsamea', 'pinus sylvestris', 'picea glauca',
];
const CONIFER_COMMON = [
  'eastern white pine', 'norway spruce', 'balsam fir',
  'cedar of lebanon', 'common juniper', 'english yew',
];

const INDUSTRIAL_NAMES = [
  'jute plant', 'kenaf crop', 'gouania lupuloides',
  'corchorus olitorius', 'abutilon theophrasti',
];

const arbConiferSciName = fc.constantFrom(...CONIFER_NAMES);
const arbConiferCommonName = fc.constantFrom(...CONIFER_COMMON);
const arbIndustrialName = fc.constantFrom(...INDUSTRIAL_NAMES);

function arbSourceRecord({ providerArb, edibleArb, ediblePartsArb, sciNameArb, commonNamesArb, utilityArb, warningsArb, categoryArb, lifeCycleArb } = {}) {
  const normalizedFields = {
    edible: edibleArb || fc.boolean(),
    edible_parts: ediblePartsArb || fc.array(fc.constantFrom('fruit', 'leaf', 'root', 'seed'), { minLength: 0, maxLength: 3 }),
    utility: utilityArb || fc.array(fc.constantFrom(...SAFE_UTILITY), { minLength: 0, maxLength: 2 }),
    warnings: warningsArb || fc.constant([]),
    scientific_name: sciNameArb || arbSafeSciName,
    common_names: commonNamesArb || fc.array(arbSafeCommonName, { minLength: 1, maxLength: 2 }),
  };
  if (categoryArb) normalizedFields.category = categoryArb;
  if (lifeCycleArb) normalizedFields.life_cycle = lifeCycleArb;

  return fc.record({
    source_provider: providerArb || arbProvider,
    source_record_id: fc.string({ minLength: 1, maxLength: 8 }).map(s => `rec-${s}`),
    canonical_id: fc.constant('test:canonical'),
    match_type: arbMatchType,
    match_score: arbMatchScore,
    normalized: fc.record(normalizedFields),
  });
}


// ---------------------------------------------------------------------------
// Feature: catalog-practical-food-filter, Property 1: Score monotonicity
// Validates: Requirements 1.1, 1.2
// ---------------------------------------------------------------------------
test('Property 1: practical food score equals deterministic formula from parts', async () => {
  // Generate records with random subsets of strong/weak edible parts
  const arbParts = fc.tuple(
    fc.subarray(STRONG_PARTS, { minLength: 0 }),
    fc.subarray(WEAK_PARTS, { minLength: 0 }),
  );

  const arbEdibleFlag = fc.boolean();

  await fc.assert(
    fc.asyncProperty(arbParts, arbEdibleFlag, async ([strongSubset, weakSubset], edibleFlag) => {
      const allParts = [...strongSubset, ...weakSubset];
      const records = [{
        source_provider: 'usda',
        source_record_id: 'rec-test',
        canonical_id: 'test:canonical',
        match_type: 'exact_scientific',
        match_score: 1,
        normalized: {
          edible: edibleFlag,
          edible_parts: allParts,
          utility: [],
          warnings: [],
          scientific_name: 'solanum lycopersicum',
          common_names: ['tomato'],
        },
      }];

      const result = computePracticalFoodScore(records);

      const expectedStrong = new Set(strongSubset);
      const expectedWeak = new Set(weakSubset);
      let expectedScore = expectedStrong.size * PRACTICAL_FOOD_SCORE.strongPartWeight
        + expectedWeak.size * PRACTICAL_FOOD_SCORE.weakPartWeight;
      if (edibleFlag && expectedStrong.size > 0) {
        expectedScore += PRACTICAL_FOOD_SCORE.edibleFlagBonus;
      }

      assert.equal(result.score, expectedScore,
        `Score mismatch: strong=${[...expectedStrong]}, weak=${[...expectedWeak]}, edible=${edibleFlag}`);
      assert.equal(result.strongParts.length, expectedStrong.size);
      assert.equal(result.weakParts.length, expectedWeak.size);
    }),
    { numRuns: 100 },
  );
});

// ---------------------------------------------------------------------------
// Feature: catalog-practical-food-filter, Property 2: Weak-only threshold
// Validates: Requirements 1.3, 1.4
// ---------------------------------------------------------------------------
test('Property 2: weak-only parts score below minimumForPromotion; strong parts score at or above', async () => {
  // Part A: weak-only → score < minimumForPromotion
  await fc.assert(
    fc.asyncProperty(
      fc.subarray(WEAK_PARTS, { minLength: 1 }),
      fc.boolean(),
      async (weakSubset, edibleFlag) => {
        const records = [{
          source_provider: 'usda',
          source_record_id: 'rec-test',
          canonical_id: 'test:canonical',
          match_type: 'exact_scientific',
          match_score: 1,
          normalized: {
            edible: edibleFlag,
            edible_parts: weakSubset,
            utility: [],
            warnings: [],
            scientific_name: 'solanum lycopersicum',
            common_names: ['tomato'],
          },
        }];

        const result = computePracticalFoodScore(records);
        assert.ok(result.score < PRACTICAL_FOOD_SCORE.minimumForPromotion,
          `Weak-only score ${result.score} should be < ${PRACTICAL_FOOD_SCORE.minimumForPromotion}`);
      },
    ),
    { numRuns: 100 },
  );

  // Part B: at least one strong part → score >= minimumForPromotion
  await fc.assert(
    fc.asyncProperty(
      fc.subarray(STRONG_PARTS, { minLength: 1 }),
      fc.subarray(WEAK_PARTS, { minLength: 0 }),
      async (strongSubset, weakSubset) => {
        const records = [{
          source_provider: 'usda',
          source_record_id: 'rec-test',
          canonical_id: 'test:canonical',
          match_type: 'exact_scientific',
          match_score: 1,
          normalized: {
            edible: true,
            edible_parts: [...strongSubset, ...weakSubset],
            utility: [],
            warnings: [],
            scientific_name: 'solanum lycopersicum',
            common_names: ['tomato'],
          },
        }];

        const result = computePracticalFoodScore(records);
        assert.ok(result.score >= PRACTICAL_FOOD_SCORE.minimumForPromotion,
          `Strong-part score ${result.score} should be >= ${PRACTICAL_FOOD_SCORE.minimumForPromotion}`);
      },
    ),
    { numRuns: 100 },
  );
});


// ---------------------------------------------------------------------------
// Feature: catalog-practical-food-filter, Property 3: Conifer weak-only blocking
// Validates: Requirements 2.1, 2.2, 2.4, 7.3
// ---------------------------------------------------------------------------
test('Property 3: conifer + weak-only edible parts → non_food regardless of OpenFarm or providers', async () => {
  // Generate 1-3 records from different providers, all with conifer names and only weak edible parts
  // Even with multiple providers (strong food evidence) and OpenFarm, result should be non_food
  // because hasStrongEdiblePart is false
  const arbConiferWeakRecord = arbSourceRecord({
    providerArb: arbProvider,
    edibleArb: fc.constant(true),
    ediblePartsArb: fc.subarray(WEAK_PARTS, { minLength: 1 }),
    sciNameArb: arbConiferSciName,
    commonNamesArb: fc.array(arbConiferCommonName, { minLength: 1, maxLength: 1 }),
    utilityArb: fc.array(fc.constantFrom(...SAFE_UTILITY), { minLength: 0, maxLength: 2 }),
    warningsArb: fc.constant([]),
  });

  const arbRecords = fc.array(arbConiferWeakRecord, { minLength: 1, maxLength: 3 });

  await fc.assert(
    fc.asyncProperty(arbRecords, async (records) => {
      const result = classifyCanonical(records);
      assert.equal(result.relevance_class, 'non_food',
        `Expected non_food for conifer with weak-only parts, got "${result.relevance_class}"`);
      assert.equal(result.guardrail_flags.conifer, true,
        'Conifer guardrail should be active for weak-only parts');
    }),
    { numRuns: 100 },
  );
});

// ---------------------------------------------------------------------------
// Feature: catalog-practical-food-filter, Property 4: Conifer override requires strong evidence AND strong parts
// Validates: Requirements 2.3
// ---------------------------------------------------------------------------
test('Property 4: conifer + strongFoodEvidence + strong edible part → guardrail inactive', async () => {
  // Generate 2 records from different providers with conifer names but with strong edible parts
  const twoProviders = fc.constantFrom(
    ['openfarm', 'permapeople'],
    ['openfarm', 'usda'],
    ['permapeople', 'usda'],
  );

  const arbRecords = twoProviders.chain(([provA, provB]) => {
    const recA = arbSourceRecord({
      providerArb: fc.constant(provA),
      edibleArb: fc.constant(true),
      ediblePartsArb: fc.tuple(arbStrongPart).map(([p]) => [p]),
      sciNameArb: arbConiferSciName,
      commonNamesArb: fc.array(arbConiferCommonName, { minLength: 1, maxLength: 1 }),
      utilityArb: fc.array(fc.constantFrom(...SAFE_UTILITY), { minLength: 0, maxLength: 2 }),
      warningsArb: fc.constant([]),
    });
    const recB = arbSourceRecord({
      providerArb: fc.constant(provB),
      edibleArb: fc.constant(true),
      ediblePartsArb: fc.tuple(arbStrongPart).map(([p]) => [p]),
      sciNameArb: arbConiferSciName,
      commonNamesArb: fc.array(arbConiferCommonName, { minLength: 1, maxLength: 1 }),
      utilityArb: fc.array(fc.constantFrom(...SAFE_UTILITY), { minLength: 0, maxLength: 2 }),
      warningsArb: fc.constant([]),
    });
    return fc.tuple(recA, recB).map(([a, b]) => [a, b]);
  });

  await fc.assert(
    fc.asyncProperty(arbRecords, async (records) => {
      const result = classifyCanonical(records);
      assert.equal(result.guardrail_flags.conifer, false,
        'Conifer guardrail should be inactive with strong evidence + strong parts');
      assert.notEqual(result.relevance_class, 'non_food',
        `Expected not non_food for conifer with strong evidence + strong parts, got "${result.relevance_class}"`);
    }),
    { numRuns: 100 },
  );
});


// ---------------------------------------------------------------------------
// Feature: catalog-practical-food-filter, Property 5: Industrial guardrail blocks without strong override
// Validates: Requirements 3.2, 3.3, 3.4
// ---------------------------------------------------------------------------
test('Property 5: industrial name pattern without strong override → excluded', async () => {
  // Single-provider records with industrial names and no/weak edible parts
  const arbIndustrialRecord = arbSourceRecord({
    providerArb: fc.constantFrom('usda', 'permapeople'),
    edibleArb: fc.boolean(),
    ediblePartsArb: fc.subarray(WEAK_PARTS, { minLength: 0 }),
    sciNameArb: arbIndustrialName,
    commonNamesArb: fc.constant(['industrial plant']),
    utilityArb: fc.constant([]),
    warningsArb: fc.constant([]),
  });

  const arbRecords = arbIndustrialRecord.map(rec => [rec]);

  await fc.assert(
    fc.asyncProperty(arbRecords, async (records) => {
      const result = classifyCanonical(records);
      assert.ok(
        result.relevance_class === 'non_food' || result.relevance_class === 'industrial_crop',
        `Expected non_food or industrial_crop for industrial species, got "${result.relevance_class}"`,
      );
      assert.equal(result.catalog_status, 'excluded',
        `Expected catalog_status excluded for industrial species, got "${result.catalog_status}"`);
    }),
    { numRuns: 100 },
  );
});

// ---------------------------------------------------------------------------
// Feature: catalog-practical-food-filter, Property 6: Cultivation signal affects core vs niche
// Validates: Requirements 4.2, 4.4
// ---------------------------------------------------------------------------
test('Property 6: cultivationSignal=0 + no strongFoodEvidence + strong edible part → food_crop_niche', async () => {
  // Single provider, no OpenFarm, no cultivated category, no cultivated life cycle
  // but has strong edible parts and edible evidence → should be niche not core
  // Use safe names (no guardrail triggers)
  const arbNicheRecord = arbSourceRecord({
    providerArb: fc.constantFrom('usda', 'permapeople'),
    edibleArb: fc.constant(true),
    ediblePartsArb: fc.tuple(arbStrongPart).map(([p]) => [p]),
    sciNameArb: arbSafeSciName,
    commonNamesArb: fc.array(arbSafeCommonName, { minLength: 1, maxLength: 2 }),
    utilityArb: fc.constant([]),
    warningsArb: fc.constant([]),
  });

  const arbRecords = arbNicheRecord.map(rec => [rec]);

  await fc.assert(
    fc.asyncProperty(arbRecords, async (records) => {
      const result = classifyCanonical(records);
      assert.equal(result.relevance_class, 'food_crop_niche',
        `Expected food_crop_niche for single-provider no-cultivation-signal, got "${result.relevance_class}"`);
      assert.notEqual(result.relevance_class, 'food_crop_core',
        'Should not be food_crop_core without cultivation signal or strong food evidence');
    }),
    { numRuns: 100 },
  );
});

// ---------------------------------------------------------------------------
// Feature: catalog-practical-food-filter, Property 8: Strong edible part without guardrail prevents non_food
// Validates: Requirements 7.4
// ---------------------------------------------------------------------------
test('Property 8: strong edible part + safe name → not non_food', async () => {
  // At least one record with a strong edible part, safe names (no guardrail triggers)
  const arbEdibleRecord = arbSourceRecord({
    edibleArb: fc.constant(true),
    ediblePartsArb: fc.tuple(arbStrongPart, fc.subarray(STRONG_PARTS, { minLength: 0, maxLength: 2 }))
      .map(([first, rest]) => [first, ...rest]),
    sciNameArb: arbSafeSciName,
    commonNamesArb: fc.array(arbSafeCommonName, { minLength: 1, maxLength: 2 }),
    utilityArb: fc.array(fc.constantFrom(...SAFE_UTILITY), { minLength: 0, maxLength: 2 }),
    warningsArb: fc.constant([]),
  });

  const arbSafeExtra = arbSourceRecord({
    sciNameArb: arbSafeSciName,
    commonNamesArb: fc.array(arbSafeCommonName, { minLength: 1, maxLength: 2 }),
    utilityArb: fc.array(fc.constantFrom(...SAFE_UTILITY), { minLength: 0, maxLength: 2 }),
    warningsArb: fc.constant([]),
  });

  const arbRecords = fc.tuple(
    arbEdibleRecord,
    fc.array(arbSafeExtra, { minLength: 0, maxLength: 2 }),
  ).map(([edible, extras]) => [edible, ...extras]);

  await fc.assert(
    fc.asyncProperty(arbRecords, async (records) => {
      const result = classifyCanonical(records);
      assert.notEqual(result.relevance_class, 'non_food',
        `Expected not non_food for records with strong edible part and safe names, got "${result.relevance_class}"`);
    }),
    { numRuns: 100 },
  );
});

// ---------------------------------------------------------------------------
// Feature: catalog-practical-food-filter, Property 9: Diagnostic fields present
// Validates: Requirements 1.5
// ---------------------------------------------------------------------------
test('Property 9: classifyCanonical output includes diagnostic fields', async () => {
  const arbRecords = fc.array(arbSourceRecord(), { minLength: 1, maxLength: 5 });

  await fc.assert(
    fc.asyncProperty(arbRecords, async (records) => {
      const result = classifyCanonical(records);

      // practical_food_score: finite number >= 0
      assert.equal(typeof result.practical_food_score, 'number',
        'practical_food_score must be a number');
      assert.ok(Number.isFinite(result.practical_food_score),
        'practical_food_score must be finite');
      assert.ok(result.practical_food_score >= 0,
        `practical_food_score must be >= 0, got ${result.practical_food_score}`);

      // practical_food_parts: object with strong and weak arrays
      assert.equal(typeof result.practical_food_parts, 'object',
        'practical_food_parts must be an object');
      assert.ok(Array.isArray(result.practical_food_parts.strong),
        'practical_food_parts.strong must be an array');
      assert.ok(Array.isArray(result.practical_food_parts.weak),
        'practical_food_parts.weak must be an array');

      // cultivation_signal: finite number >= 0
      assert.equal(typeof result.cultivation_signal, 'number',
        'cultivation_signal must be a number');
      assert.ok(Number.isFinite(result.cultivation_signal),
        'cultivation_signal must be finite');
      assert.ok(result.cultivation_signal >= 0,
        `cultivation_signal must be >= 0, got ${result.cultivation_signal}`);
    }),
    { numRuns: 100 },
  );
});
