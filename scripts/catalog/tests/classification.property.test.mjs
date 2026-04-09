import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { classifyCanonical } from '../step4_classify.mjs';
import { ENUMS } from '../lib/config.mjs';

// ---------------------------------------------------------------------------
// Shared generators
// ---------------------------------------------------------------------------

const arbProvider = fc.constantFrom('openfarm', 'permapeople', 'usda');
const arbMatchType = fc.constantFrom(...ENUMS.matchType);
const arbMatchScore = fc.double({ min: 0, max: 1, noNaN: true });

// Safe plant names that will never trigger conifer, industrial, or weed guardrails.
// Avoids: pinus, pine, spruce, picea, fir, abies, cedar, cedrus, cypress, cupress,
//         juniper, juniperus, taxus, sequoia, redwood, hemlock, larch, taxodium,
//         fiber, fibre, textile, timber, lumber, biofuel, fuel, rubber, resin,
//         pulp, paper, dye, ornamental, industrial, weed, invasive, noxious
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

// Conifer / industrial name patterns that WILL trigger guardrails
const CONIFER_NAMES = [
  'pinus strobus', 'picea abies', 'abies balsamea',
  'cedrus libani', 'juniperus communis', 'taxus baccata',
];
const CONIFER_COMMON = [
  'eastern white pine', 'norway spruce', 'balsam fir',
  'cedar of lebanon', 'common juniper', 'english yew',
];

// Safe utility terms that won't trigger industrial guardrail
const SAFE_UTILITY = ['food', 'culinary', 'edible', 'fruit', 'vegetable'];

// Build an arbitrary source record with full control over normalized fields
function arbSourceRecord({ providerArb, edibleArb, ediblePartsArb, sciNameArb, commonNamesArb, utilityArb, warningsArb } = {}) {
  return fc.record({
    source_provider: providerArb || arbProvider,
    source_record_id: fc.string({ minLength: 1, maxLength: 8 }).map(s => `rec-${s}`),
    canonical_id: fc.constant('test:canonical'),
    match_type: arbMatchType,
    match_score: arbMatchScore,
    normalized: fc.record({
      edible: edibleArb || fc.boolean(),
      edible_parts: ediblePartsArb || fc.array(fc.constantFrom('fruit', 'leaf', 'root', 'seed'), { minLength: 0, maxLength: 3 }),
      utility: utilityArb || fc.array(fc.constantFrom(...SAFE_UTILITY), { minLength: 0, maxLength: 2 }),
      warnings: warningsArb || fc.constant([]),
      scientific_name: sciNameArb || arbSafeSciName,
      common_names: commonNamesArb || fc.array(arbSafeCommonName, { minLength: 1, maxLength: 2 }),
    }),
  });
}

// ---------------------------------------------------------------------------
// Feature: catalog-pipeline-quality, Property 6: Classification produces valid relevance_class
// Validates: Requirements 7.3
// ---------------------------------------------------------------------------
test('classifyCanonical always returns valid relevance_class', async () => {
  const arbRecords = fc.array(arbSourceRecord(), { minLength: 1, maxLength: 5 });

  await fc.assert(
    fc.asyncProperty(arbRecords, async (records) => {
      const result = classifyCanonical(records);
      assert.ok(
        ENUMS.relevanceClass.includes(result.relevance_class),
        `Expected relevance_class in ${JSON.stringify(ENUMS.relevanceClass)} but got "${result.relevance_class}"`,
      );
    }),
    { numRuns: 100 },
  );
});


// ---------------------------------------------------------------------------
// Feature: catalog-pipeline-quality, Property 7: Edible evidence without guardrail prevents non_food classification
// Validates: Requirements 3.2, 7.4
// ---------------------------------------------------------------------------
test('edible evidence without conifer/industrial name patterns prevents non_food', async () => {
  // Generate records that have edible evidence and safe names (no guardrail triggers)
  const arbEdibleRecord = arbSourceRecord({
    edibleArb: fc.constant(true),
    ediblePartsArb: fc.array(fc.constantFrom('fruit', 'leaf', 'root', 'seed'), { minLength: 1, maxLength: 3 }),
    sciNameArb: arbSafeSciName,
    commonNamesArb: fc.array(arbSafeCommonName, { minLength: 1, maxLength: 2 }),
    utilityArb: fc.array(fc.constantFrom(...SAFE_UTILITY), { minLength: 0, maxLength: 2 }),
    warningsArb: fc.constant([]),
  });

  // At least one edible record, optionally more records (all safe names)
  const arbSafeExtra = arbSourceRecord({
    sciNameArb: arbSafeSciName,
    commonNamesArb: fc.array(arbSafeCommonName, { minLength: 1, maxLength: 2 }),
    utilityArb: fc.array(fc.constantFrom(...SAFE_UTILITY), { minLength: 0, maxLength: 2 }),
    warningsArb: fc.constant([]),
  });

  const arbRecords = fc.tuple(
    arbEdibleRecord,
    fc.array(arbSafeExtra, { minLength: 0, maxLength: 3 }),
  ).map(([edible, extras]) => [edible, ...extras]);

  await fc.assert(
    fc.asyncProperty(arbRecords, async (records) => {
      const result = classifyCanonical(records);
      assert.notEqual(
        result.relevance_class,
        'non_food',
        `Expected relevance_class != "non_food" for records with edible evidence and safe names, but got "${result.relevance_class}"`,
      );
    }),
    { numRuns: 100 },
  );
});


// ---------------------------------------------------------------------------
// Feature: catalog-pipeline-quality, Property 8: Strong food evidence determines core vs niche
// Validates: Requirements 3.3, 3.5
// ---------------------------------------------------------------------------
test('strong food evidence yields food_crop_core with OpenFarm or food_crop_niche without', async () => {
  // Strong food evidence requires edible signals from ≥2 distinct providers.
  // We generate exactly 2 records from different providers, both with edible evidence.
  // All names are safe (no guardrail triggers).
  //
  // OpenFarm support requires either:
  //   (a) an OpenFarm source with match_type !== 'unresolved', OR
  //   (b) an OpenFarm-originated canonical (origin === 'openfarm') with any OpenFarm source
  // We use resolved match types for OpenFarm records to ensure (a) holds.

  // Resolved match types (excludes 'unresolved' and 'ambiguous_common_name')
  const arbResolvedMatchType = fc.constantFrom(
    'exact_scientific', 'normalized_scientific', 'cultivar_stripped',
    'synonym_match', 'common_name_fallback', 'parenthetical_common',
    'genus_match', 'fuzzy_fallback',
  );

  const twoProviders = fc.constantFrom(
    ['openfarm', 'permapeople'],
    ['openfarm', 'usda'],
    ['permapeople', 'usda'],
  );

  const arbStrongRecords = twoProviders.chain(([provA, provB]) => {
    // OpenFarm records need resolved match types for hasOpenFarmSupport
    const matchTypeA = provA === 'openfarm' ? arbResolvedMatchType : arbMatchType;
    const matchTypeB = provB === 'openfarm' ? arbResolvedMatchType : arbMatchType;

    const recA = fc.record({
      source_provider: fc.constant(provA),
      source_record_id: fc.string({ minLength: 1, maxLength: 8 }).map(s => `rec-${s}`),
      canonical_id: fc.constant('test:canonical'),
      match_type: matchTypeA,
      match_score: fc.double({ min: 0.5, max: 1, noNaN: true }),
      normalized: fc.record({
        edible: fc.constant(true),
        edible_parts: fc.array(fc.constantFrom('fruit', 'leaf', 'root', 'seed'), { minLength: 1, maxLength: 3 }),
        utility: fc.array(fc.constantFrom(...SAFE_UTILITY), { minLength: 0, maxLength: 2 }),
        warnings: fc.constant([]),
        scientific_name: arbSafeSciName,
        common_names: fc.array(arbSafeCommonName, { minLength: 1, maxLength: 2 }),
      }),
    });
    const recB = fc.record({
      source_provider: fc.constant(provB),
      source_record_id: fc.string({ minLength: 1, maxLength: 8 }).map(s => `rec-${s}`),
      canonical_id: fc.constant('test:canonical'),
      match_type: matchTypeB,
      match_score: fc.double({ min: 0.5, max: 1, noNaN: true }),
      normalized: fc.record({
        edible: fc.constant(true),
        edible_parts: fc.array(fc.constantFrom('fruit', 'leaf', 'root', 'seed'), { minLength: 1, maxLength: 3 }),
        utility: fc.array(fc.constantFrom(...SAFE_UTILITY), { minLength: 0, maxLength: 2 }),
        warnings: fc.constant([]),
        scientific_name: arbSafeSciName,
        common_names: fc.array(arbSafeCommonName, { minLength: 1, maxLength: 2 }),
      }),
    });
    return fc.tuple(recA, recB);
  });

  await fc.assert(
    fc.asyncProperty(arbStrongRecords, async ([recA, recB]) => {
      const records = [recA, recB];
      const result = classifyCanonical(records);

      // hasOpenFarmSupport = resolved OpenFarm source present
      const hasOpenFarmSupport = records.some(
        r => r.source_provider === 'openfarm' && r.match_type !== 'unresolved',
      );

      if (hasOpenFarmSupport) {
        assert.equal(
          result.relevance_class,
          'food_crop_core',
          `Expected "food_crop_core" with OpenFarm support + strong food evidence, got "${result.relevance_class}"`,
        );
      } else {
        // Without OpenFarm support, strong food evidence → food_crop_niche
        assert.equal(
          result.relevance_class,
          'food_crop_niche',
          `Expected "food_crop_niche" without OpenFarm support + strong food evidence, got "${result.relevance_class}"`,
        );
      }
    }),
    { numRuns: 100 },
  );
});


// ---------------------------------------------------------------------------
// Feature: catalog-pipeline-quality, Property 9: Guardrail preservation
// Validates: Requirements 3.4
// ---------------------------------------------------------------------------
test('conifer/industrial patterns without strong food evidence yield non_food', async () => {
  // Generate records that match conifer or industrial guardrail patterns
  // but do NOT have strong food evidence (single provider only).

  const arbConiferSciName = fc.constantFrom(...CONIFER_NAMES);
  const arbConiferCommonName = fc.constantFrom(...CONIFER_COMMON);

  // Single provider — no strong food evidence (needs ≥2 providers)
  const arbSingleProvider = fc.constantFrom('usda', 'permapeople');

  const arbGuardrailRecord = arbSourceRecord({
    providerArb: arbSingleProvider,
    edibleArb: fc.boolean(), // may or may not be edible — guardrail should still fire
    ediblePartsArb: fc.array(fc.constantFrom('seed', 'leaf'), { minLength: 0, maxLength: 2 }),
    sciNameArb: arbConiferSciName,
    commonNamesArb: fc.array(arbConiferCommonName, { minLength: 1, maxLength: 1 }),
    utilityArb: fc.constant([]),
    warningsArb: fc.constant([]),
  });

  // Only one record from one provider → no strong food evidence
  const arbRecords = arbGuardrailRecord.map(rec => [rec]);

  await fc.assert(
    fc.asyncProperty(arbRecords, async (records) => {
      const result = classifyCanonical(records);
      assert.equal(
        result.relevance_class,
        'non_food',
        `Expected "non_food" for conifer-pattern record without strong food evidence, got "${result.relevance_class}"`,
      );
    }),
    { numRuns: 100 },
  );
});
