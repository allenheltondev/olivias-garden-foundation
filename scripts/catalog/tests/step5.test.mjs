import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveCanonicalRecord } from '../step5_derive_fields.mjs';

test('step5 enforces precedence and mismatch flags', () => {
  const out = deriveCanonicalRecord([
    {
      canonical_id: 'A',
      source_provider: 'usda',
      source_record_id: 'u1',
      catalog_status: 'core',
      review_status: 'auto_approved',
      relevance_class: 'food_crop_niche',
      source_confidence: 0.9,
      source_agreement_score: 0.7,
      normalized: { scientific_name: 'Solanum lycopersicum', family: 'Solanaceae', common_names: ['tomato'], hardiness_zones: ['8'] },
    },
    {
      canonical_id: 'A',
      source_provider: 'openfarm',
      source_record_id: 'o1',
      normalized: { common_names: ['Tomato'] },
    },
    {
      canonical_id: 'A',
      source_provider: 'permapeople',
      source_record_id: 'p1',
      normalized: { common_names: ['Love apple'], edible: true, edible_parts: ['fruit'], life_cycle: 'annual', hardiness_zones: ['5'] },
    },
  ]);

  assert.equal(out.scientific_name, 'Solanum lycopersicum');
  assert.equal(out.family, 'Solanaceae');
  assert.equal(out.common_name, 'Tomato');
  assert.equal(out.common_name_mismatch, true);
  assert.deepEqual(out.hardiness_zones, []);
  assert.equal(out.field_sources.common_name, 'openfarm');
});
