import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { PRACTICAL_FOOD_SCORE } from '../lib/config.mjs';

function partition(records) {
  let promoted = 0;
  let review = 0;
  let unresolved = 0;
  let excluded = 0;
  for (const rec of records) {
    const valid = Boolean(rec.canonical_id && rec.scientific_name && rec.common_name);
    if ((rec.catalog_status === 'core' || rec.catalog_status === 'extended') && rec.review_status === 'auto_approved' && valid) promoted += 1;
    else if (rec.catalog_status === 'excluded') excluded += 1;
    else if (rec.review_status === 'needs_review') review += 1;
    else unresolved += 1;
  }
  return { promoted, review, unresolved, excluded };
}

test('promotion partition is exhaustive', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(
        fc.record({
          canonical_id: fc.option(fc.string({ minLength: 1, maxLength: 5 }), { nil: undefined }),
          scientific_name: fc.option(fc.string({ minLength: 1, maxLength: 5 }), { nil: undefined }),
          common_name: fc.option(fc.string({ minLength: 1, maxLength: 5 }), { nil: undefined }),
          catalog_status: fc.constantFrom('core', 'extended', 'excluded', 'hidden'),
          review_status: fc.constantFrom('auto_approved', 'needs_review', 'rejected'),
        }),
        { maxLength: 80 },
      ),
      async (records) => {
        const r = partition(records);
        assert.equal(r.promoted + r.review + r.unresolved + r.excluded, records.length);
      },
    ),
  );
});


// ---------------------------------------------------------------------------
// Property 10: Promotion gate respects confidence bands and guardrails
// Feature: catalog-pipeline-quality, Property 10: Promotion gate respects confidence bands and guardrails
// **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5**
// ---------------------------------------------------------------------------

/**
 * Replicates the promotion gate logic from promote.mjs so we can test it
 * as a pure function without file I/O.
 */
function wouldPromote(rec) {
  const eligibleClass = rec.catalog_status === 'core' || rec.catalog_status === 'extended';
  const eligibleReview = rec.review_status === 'auto_approved';
  const hasOpenFarmSupport = rec.has_openfarm_support === true;
  const hasStrongFoodEvidence = rec.strong_food_evidence === true;
  const confidenceBand = rec.match_confidence_band || 'low';
  const edibleSignal = rec.edible === true
    || (Array.isArray(rec.edible_parts) && rec.edible_parts.length > 0)
    || hasStrongFoodEvidence;
  const guardrailBlocked = Boolean(rec.guardrail_flags?.conifer || rec.guardrail_flags?.industrial);
  const contentValid = Boolean(rec.canonical_id && rec.scientific_name && rec.common_name);

  if (confidenceBand === 'low') return false;

  const confidenceGatePassed = confidenceBand === 'high'
    || (confidenceBand === 'medium' && (hasOpenFarmSupport || hasStrongFoodEvidence));

  const practicalFoodScore = rec.practical_food_score ?? 0;
  const promotionGatePassed = confidenceGatePassed
    && edibleSignal
    && !guardrailBlocked
    && practicalFoodScore >= PRACTICAL_FOOD_SCORE.minimumForPromotion;

  return eligibleClass && eligibleReview && promotionGatePassed && contentValid;
}

// Arbitrary: a valid promoted-shape record with all required content fields
const arbValidContent = () => fc.record({
  canonical_id: fc.string({ minLength: 1, maxLength: 12 }),
  scientific_name: fc.string({ minLength: 1, maxLength: 20 }),
  common_name: fc.string({ minLength: 1, maxLength: 20 }),
});

// (a) low band → never promoted
test('Property 10a: low confidence band records are never promoted', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.record({
        canonical_id: fc.option(fc.string({ minLength: 1, maxLength: 10 }), { nil: undefined }),
        scientific_name: fc.option(fc.string({ minLength: 1, maxLength: 10 }), { nil: undefined }),
        common_name: fc.option(fc.string({ minLength: 1, maxLength: 10 }), { nil: undefined }),
        catalog_status: fc.constantFrom('core', 'extended', 'excluded', 'hidden'),
        review_status: fc.constantFrom('auto_approved', 'needs_review', 'rejected'),
        match_confidence_band: fc.constant('low'),
        edible: fc.boolean(),
        edible_parts: fc.array(fc.string({ minLength: 1, maxLength: 8 }), { maxLength: 3 }),
        has_openfarm_support: fc.boolean(),
        strong_food_evidence: fc.boolean(),
        guardrail_flags: fc.record({
          conifer: fc.boolean(),
          industrial: fc.boolean(),
        }),
        practical_food_score: fc.double({ min: 0, max: 10, noNaN: true }),
      }),
      async (rec) => {
        assert.equal(wouldPromote(rec), false, 'low band must never promote');
      },
    ),
    { numRuns: 100 },
  );
});

// (b) guardrail active → never promoted
test('Property 10b: guardrail-blocked records are never promoted', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.record({
        canonical_id: fc.string({ minLength: 1, maxLength: 10 }),
        scientific_name: fc.string({ minLength: 1, maxLength: 10 }),
        common_name: fc.string({ minLength: 1, maxLength: 10 }),
        catalog_status: fc.constantFrom('core', 'extended'),
        review_status: fc.constant('auto_approved'),
        match_confidence_band: fc.constantFrom('high', 'medium'),
        edible: fc.constant(true),
        edible_parts: fc.constant(['leaves']),
        has_openfarm_support: fc.boolean(),
        strong_food_evidence: fc.boolean(),
        guardrail_flags: fc.oneof(
          fc.record({ conifer: fc.constant(true), industrial: fc.boolean() }),
          fc.record({ conifer: fc.boolean(), industrial: fc.constant(true) }),
        ),
      }),
      async (rec) => {
        assert.equal(wouldPromote(rec), false, 'guardrail-blocked must never promote');
      },
    ),
    { numRuns: 100 },
  );
});

// (c) high band + core/extended + auto_approved + edible + no guardrail + valid content → promoted
test('Property 10c: high-confidence eligible records are promoted', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.record({
        canonical_id: fc.string({ minLength: 1, maxLength: 10 }),
        scientific_name: fc.string({ minLength: 1, maxLength: 10 }),
        common_name: fc.string({ minLength: 1, maxLength: 10 }),
        catalog_status: fc.constantFrom('core', 'extended'),
        review_status: fc.constant('auto_approved'),
        match_confidence_band: fc.constant('high'),
        edible: fc.constant(true),
        edible_parts: fc.constant([]),
        has_openfarm_support: fc.boolean(),
        strong_food_evidence: fc.boolean(),
        guardrail_flags: fc.constant({ conifer: false, industrial: false }),
        practical_food_score: fc.double({ min: PRACTICAL_FOOD_SCORE.minimumForPromotion, max: 10, noNaN: true }),
      }),
      async (rec) => {
        assert.equal(wouldPromote(rec), true, 'high band + eligible + edible + no guardrail + score above threshold must promote');
      },
    ),
    { numRuns: 100 },
  );
});

// (d) medium band without OpenFarm or strong food evidence → not promoted
test('Property 10d: medium-confidence without OpenFarm or strong food evidence is not promoted', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.record({
        canonical_id: fc.string({ minLength: 1, maxLength: 10 }),
        scientific_name: fc.string({ minLength: 1, maxLength: 10 }),
        common_name: fc.string({ minLength: 1, maxLength: 10 }),
        catalog_status: fc.constantFrom('core', 'extended'),
        review_status: fc.constant('auto_approved'),
        match_confidence_band: fc.constant('medium'),
        edible: fc.constant(true),
        edible_parts: fc.constant(['fruit']),
        has_openfarm_support: fc.constant(false),
        strong_food_evidence: fc.constant(false),
        guardrail_flags: fc.constant({ conifer: false, industrial: false }),
      }),
      async (rec) => {
        assert.equal(wouldPromote(rec), false, 'medium band without OpenFarm/strongFood must not promote');
      },
    ),
    { numRuns: 100 },
  );
});


// ---------------------------------------------------------------------------
// Property 7: Promotion gate enforces practical food score threshold
// Feature: catalog-practical-food-filter, Property 7: Promotion gate enforces practical food score threshold
// **Validates: Requirements 5.1, 5.2, 5.3**
// ---------------------------------------------------------------------------

// (7a) Below-threshold score → never promoted, even if all other checks pass
test('Property 7a: below-threshold practical_food_score rejects promotion', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.record({
        canonical_id: fc.string({ minLength: 1, maxLength: 10 }),
        scientific_name: fc.string({ minLength: 1, maxLength: 10 }),
        common_name: fc.string({ minLength: 1, maxLength: 10 }),
        catalog_status: fc.constantFrom('core', 'extended'),
        review_status: fc.constant('auto_approved'),
        match_confidence_band: fc.constant('high'),
        edible: fc.constant(true),
        edible_parts: fc.constant(['fruit']),
        has_openfarm_support: fc.constant(true),
        strong_food_evidence: fc.constant(true),
        guardrail_flags: fc.constant({ conifer: false, industrial: false }),
        practical_food_score: fc.double({ min: 0, max: PRACTICAL_FOOD_SCORE.minimumForPromotion - 0.01, noNaN: true }),
      }),
      async (rec) => {
        assert.equal(wouldPromote(rec), false, 'below-threshold score must reject even with all other checks passing');
      },
    ),
    { numRuns: 100 },
  );
});

// (7b) At-or-above-threshold score + all other checks passing → promoted
test('Property 7b: at-or-above-threshold practical_food_score with all checks passing promotes', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.record({
        canonical_id: fc.string({ minLength: 1, maxLength: 10 }),
        scientific_name: fc.string({ minLength: 1, maxLength: 10 }),
        common_name: fc.string({ minLength: 1, maxLength: 10 }),
        catalog_status: fc.constantFrom('core', 'extended'),
        review_status: fc.constant('auto_approved'),
        match_confidence_band: fc.constant('high'),
        edible: fc.constant(true),
        edible_parts: fc.constant(['fruit']),
        has_openfarm_support: fc.constant(true),
        strong_food_evidence: fc.constant(true),
        guardrail_flags: fc.constant({ conifer: false, industrial: false }),
        practical_food_score: fc.double({ min: PRACTICAL_FOOD_SCORE.minimumForPromotion, max: 10, noNaN: true }),
      }),
      async (rec) => {
        assert.equal(wouldPromote(rec), true, 'at-or-above-threshold score with all checks passing must promote');
      },
    ),
    { numRuns: 100 },
  );
});
