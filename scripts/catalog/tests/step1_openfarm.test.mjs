import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenFarmCanonicals, normalizeScientificName } from '../step1_canonical_identity.mjs';

// Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 7.2

test('happy path: OpenFarm row with scientific name creates canonical with origin "openfarm"', () => {
  const rows = [{ scientific_name: 'Mangifera indica', common_name: 'Mango' }];
  const usdaSet = new Set();

  const result = buildOpenFarmCanonicals(rows, usdaSet);

  assert.equal(result.length, 1);
  const c = result[0];
  assert.equal(c.origin, 'openfarm');
  assert.equal(c.canonical_id, 'openfarm:mangifera indica');
  assert.equal(c.scientific_name_normalized, 'mangifera indica');
  assert.equal(c.accepted_scientific_name, 'Mangifera indica');
  assert.deepEqual(c.common_names, ['Mango']);
  assert.equal(c.usda_symbol, null);
  assert.equal(c.family, null);
  assert.deepEqual(c.synonyms, []);
});

test('dedup: two OpenFarm rows with same normalized scientific name produce one canonical', () => {
  const rows = [
    { scientific_name: 'Mangifera indica', common_name: 'Mango' },
    { scientific_name: 'Mangifera Indica L.', common_name: 'Indian Mango' },
  ];
  const usdaSet = new Set();

  const result = buildOpenFarmCanonicals(rows, usdaSet);

  assert.equal(result.length, 1);
  // First row wins
  assert.deepEqual(result[0].common_names, ['Mango']);
});

test('skip-no-name: row with neither scientific name nor common name is skipped', () => {
  const rows = [
    { scientific_name: null, common_name: null },
    { scientific_name: '', common_name: '' },
    { scientific_name: '  ', common_name: '  ' },
    { scientific_name: undefined, common_name: undefined },
  ];
  const usdaSet = new Set();

  const result = buildOpenFarmCanonicals(rows, usdaSet);

  assert.equal(result.length, 0);
});

test('deterministic IDs: same input produces same canonical_id across runs', () => {
  const rows = [{ scientific_name: 'Carica papaya', common_name: 'Papaya' }];
  const usdaSet = new Set();

  const run1 = buildOpenFarmCanonicals(rows, usdaSet);
  const run2 = buildOpenFarmCanonicals(rows, usdaSet);

  assert.equal(run1.length, 1);
  assert.equal(run2.length, 1);
  assert.equal(run1[0].canonical_id, run2[0].canonical_id);
  assert.equal(run1[0].canonical_id, `openfarm:${normalizeScientificName('Carica papaya')}`);
});

test('common-name fallback ID: row with only common name gets openfarm:common:<slug> ID', () => {
  const rows = [{ scientific_name: null, common_name: 'Dragon Fruit' }];
  const usdaSet = new Set();

  const result = buildOpenFarmCanonicals(rows, usdaSet);

  assert.equal(result.length, 1);
  assert.equal(result[0].canonical_id, 'openfarm:common:dragon-fruit');
  assert.equal(result[0].scientific_name_normalized, null);
  assert.deepEqual(result[0].common_names, ['Dragon Fruit']);
});

test('USDA canonicals are skipped: OpenFarm row matching USDA normalized name is not duplicated', () => {
  const rows = [{ scientific_name: 'Solanum lycopersicum', common_name: 'Tomato' }];
  const usdaSet = new Set(['solanum lycopersicum']);

  const result = buildOpenFarmCanonicals(rows, usdaSet);

  assert.equal(result.length, 0);
});
