import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildOpenFarmCanonicals, normalizeScientificName } from '../step1_canonical_identity.mjs';
import { runStep1 } from '../step1_canonical_identity.mjs';
import { PATHS, PROGRESS_PATHS } from '../lib/config.mjs';
import { readJsonl, computeChecksum } from '../lib/io.mjs';
import { readProgress } from '../lib/progress.mjs';

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

test('runStep1 final USDA slice uses full USDA set and checkpoints USDA rows only', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'step1-openfarm-'));
  const originalPaths = { ...PATHS };
  const originalProgressPaths = { ...PROGRESS_PATHS };

  try {
    PATHS.usdaPlants = path.join(root, 'usda-plants.txt');
    PATHS.openfarmCrops = path.join(root, 'openfarm-crops.csv');
    PATHS.step1 = path.join(root, 'step1.jsonl');
    PROGRESS_PATHS[1] = path.join(root, 'step1-progress.json');

    await fsp.writeFile(
      PATHS.usdaPlants,
      [
        'Symbol,Synonym Symbol,Scientific Name with Author,Common Name,Family',
        'TOMA,,Solanum lycopersicum L.,Tomato,Solanaceae',
        'MANG,,Mangifera indica L.,Mango,Anacardiaceae',
      ].join('\n'),
      'utf8',
    );
    await fsp.writeFile(
      PATHS.openfarmCrops,
      [
        'Solanum lycopersicum,Tomato',
        'Carica papaya,Papaya',
      ].join('\n'),
      'utf8',
    );

    const checksum = await computeChecksum(PATHS.usdaPlants);
    await fsp.writeFile(
      PROGRESS_PATHS[1],
      JSON.stringify({ step: 1, lastProcessedIndex: 0, inputChecksum: checksum, updatedAt: new Date().toISOString() }),
      'utf8',
    );

    const summary = await runStep1({ limit: 1 });
    const rows = [];
    for await (const row of readJsonl(PATHS.step1)) rows.push(row);
    const progress = await readProgress(1);

    assert.equal(summary.openFarmCanonicalCount, 1);
    assert.deepEqual(
      rows.map((row) => row.canonical_id),
      ['MANG', 'openfarm:carica papaya'],
    );
    assert.equal(progress.lastProcessedIndex, 1);
  } finally {
    Object.assign(PATHS, originalPaths);
    Object.assign(PROGRESS_PATHS, originalProgressPaths);
    await fsp.rm(root, { recursive: true, force: true });
  }
});
