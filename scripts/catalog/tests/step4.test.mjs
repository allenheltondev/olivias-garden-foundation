import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCanonical } from '../step4_classify.mjs';

test('step4 enforces openfarm-first and guardrails', () => {
  const noOpenFarm = classifyCanonical([
    {
      canonical_id: 'A',
      source_provider: 'usda',
      source_record_id: 'u1',
      match_type: 'exact',
      match_score: 0.9,
      normalized: { scientific_name: 'Pinus banksiana', common_names: ['jack pine'], edible: true, edible_parts: ['seed'] },
    },
  ]);

  assert.equal(noOpenFarm.relevance_class, 'non_food');
  assert.equal(noOpenFarm.catalog_status, 'excluded');

  const openFarmSupported = classifyCanonical([
    {
      canonical_id: 'B',
      source_provider: 'openfarm',
      source_record_id: 'o1',
      match_type: 'exact',
      match_score: 0.95,
      normalized: { scientific_name: 'Solanum lycopersicum', common_names: ['tomato'], edible: true, edible_parts: ['fruit'] },
    },
  ]);

  assert.equal(openFarmSupported.relevance_class, 'food_crop_core');
  assert.equal(openFarmSupported.catalog_status, 'core');
  assert.equal(openFarmSupported.has_openfarm_support, true);

  const fuzzyMatched = classifyCanonical([
    {
      canonical_id: 'C',
      source_provider: 'openfarm',
      source_record_id: 'o2',
      match_type: 'fuzzy_fallback',
      match_score: 0.55,
      needs_review: true,
      normalized: { scientific_name: 'Ocimum basilicum', common_names: ['basil'], edible: true, edible_parts: ['leaf'] },
    },
  ]);

  assert.equal(fuzzyMatched.review_status, 'needs_review');
});
