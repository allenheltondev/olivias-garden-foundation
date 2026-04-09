import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCanonical } from '../step4_classify.mjs';

// Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 7.2

test('OpenFarm-originated canonical with edible evidence → food_crop_core', () => {
  const records = [
    {
      canonical_id: 'openfarm:mangifera indica',
      source_provider: 'openfarm',
      source_record_id: 'of1',
      match_type: 'exact_scientific',
      match_score: 0.95,
      normalized: {
        scientific_name: 'Mangifera indica',
        common_names: ['mango'],
        edible: true,
        edible_parts: ['fruit'],
      },
    },
  ];
  const canonical = { origin: 'openfarm' };

  const result = classifyCanonical(records, canonical);

  assert.equal(result.relevance_class, 'food_crop_core');
  assert.equal(result.catalog_status, 'core');
  assert.equal(result.has_openfarm_support, true);
});

test('edible evidence without guardrail → not non_food', () => {
  const records = [
    {
      canonical_id: 'SOME1',
      source_provider: 'permapeople',
      source_record_id: 'pp1',
      match_type: 'normalized_scientific',
      match_score: 0.95,
      normalized: {
        scientific_name: 'Cucumis sativus',
        common_names: ['cucumber'],
        edible: true,
        edible_parts: ['fruit'],
      },
    },
  ];

  const result = classifyCanonical(records);

  assert.notEqual(result.relevance_class, 'non_food');
});

test('conifer guardrail overrides edible evidence without strong food evidence', () => {
  const records = [
    {
      canonical_id: 'PINE1',
      source_provider: 'usda',
      source_record_id: 'u1',
      match_type: 'exact_scientific',
      match_score: 1.0,
      normalized: {
        scientific_name: 'Pinus strobus',
        common_names: ['eastern white pine'],
        edible: true,
        edible_parts: ['seed'],
      },
    },
  ];

  const result = classifyCanonical(records);

  assert.equal(result.relevance_class, 'non_food');
  assert.equal(result.guardrail_flags.conifer, true);
});

test('industrial guardrail overrides edible evidence without strong food evidence', () => {
  const records = [
    {
      canonical_id: 'IND1',
      source_provider: 'usda',
      source_record_id: 'u2',
      match_type: 'exact_scientific',
      match_score: 1.0,
      normalized: {
        scientific_name: 'Gossypium hirsutum',
        common_names: ['cotton'],
        edible: false,
        edible_parts: [],
        utility: ['fiber', 'textile', 'industrial'],
      },
    },
  ];

  const result = classifyCanonical(records);

  assert.equal(result.relevance_class, 'non_food');
  assert.equal(result.guardrail_flags.industrial, true);
});

test('strong food evidence overrides conifer guardrail', () => {
  // Strong food evidence = edible signals from ≥2 providers
  const records = [
    {
      canonical_id: 'PINE2',
      source_provider: 'openfarm',
      source_record_id: 'of2',
      match_type: 'exact_scientific',
      match_score: 0.95,
      normalized: {
        scientific_name: 'Pinus edulis',
        common_names: ['pinyon pine'],
        edible: true,
        edible_parts: ['nut'],
        utility: ['food', 'nut'],
      },
    },
    {
      canonical_id: 'PINE2',
      source_provider: 'permapeople',
      source_record_id: 'pp2',
      match_type: 'normalized_scientific',
      match_score: 0.95,
      normalized: {
        scientific_name: 'Pinus edulis',
        common_names: ['pinyon pine'],
        edible: true,
        edible_parts: ['nut'],
        utility: ['edible', 'nut'],
      },
    },
  ];

  const result = classifyCanonical(records);

  assert.notEqual(result.relevance_class, 'non_food');
  assert.equal(result.guardrail_flags.conifer, false);
  assert.equal(result.strong_food_evidence, true);
});

test('strong food evidence overrides industrial guardrail', () => {
  const records = [
    {
      canonical_id: 'IND2',
      source_provider: 'openfarm',
      source_record_id: 'of3',
      match_type: 'exact_scientific',
      match_score: 0.95,
      normalized: {
        scientific_name: 'Linum usitatissimum',
        common_names: ['flax'],
        edible: true,
        edible_parts: ['seed'],
        utility: ['food', 'fiber', 'industrial'],
      },
    },
    {
      canonical_id: 'IND2',
      source_provider: 'permapeople',
      source_record_id: 'pp3',
      match_type: 'normalized_scientific',
      match_score: 0.95,
      normalized: {
        scientific_name: 'Linum usitatissimum',
        common_names: ['flax'],
        edible: true,
        edible_parts: ['seed'],
        utility: ['edible', 'fiber'],
      },
    },
  ];

  const result = classifyCanonical(records);

  assert.notEqual(result.relevance_class, 'non_food');
  assert.equal(result.guardrail_flags.industrial, false);
  assert.equal(result.strong_food_evidence, true);
});
