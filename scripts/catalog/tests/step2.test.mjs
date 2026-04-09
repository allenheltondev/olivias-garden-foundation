import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { matchRecord, runStep2 } from '../step2_match_sources.mjs';
import { PATHS, PROGRESS_PATHS } from '../lib/config.mjs';
import { readJsonl } from '../lib/io.mjs';
import { readProgress } from '../lib/progress.mjs';

const indexes = {
  exact: new Map([['Solanum lycopersicum L.', 'LYCO2']]),
  normalized: new Map([['solanum lycopersicum', 'LYCO2']]),
  synonym: new Map([['lycopersicon esculentum', 'LYCO2']]),
  common: new Map([['tomato', ['LYCO2']], ['mint', ['A', 'B']]]),
  fuzzyScientific: [{ normalized: 'solanum lycopersicum', canonical_id: 'LYCO2' }],
  fuzzyCommon: [{ normalized: 'tomato', canonical_id: 'LYCO2' }],
};

test('step2 cascade exact -> unresolved', () => {
  const exact = matchRecord({ scientific_name: 'Solanum lycopersicum L.' }, indexes);
  assert.equal(exact.match_type, 'exact_scientific');
  assert.equal(exact.match_score, 1);

  const syn = matchRecord({ scientific_name: 'Lycopersicon esculentum Mill.' }, indexes);
  assert.equal(syn.match_type, 'synonym_match');

  const common = matchRecord({ common_name: 'tomato' }, indexes);
  assert.equal(common.match_type, 'common_name_fallback');

  const amb = matchRecord({ common_name: 'mint' }, indexes);
  assert.equal(amb.match_type, 'ambiguous_common_name');

  const fuzzySci = matchRecord({ scientific_name: 'Solanum lycoperscum' }, indexes);
  assert.equal(fuzzySci.match_type, 'fuzzy_fallback');
  assert.equal(fuzzySci.needs_review, true);
  assert.equal(fuzzySci.diagnostics.fuzzy.type, 'scientific');

  const fuzzyCommon = matchRecord({ common_name: 'tomat0' }, indexes);
  assert.equal(fuzzyCommon.match_type, 'fuzzy_fallback');
  assert.equal(fuzzyCommon.needs_review, true);
  assert.equal(fuzzyCommon.diagnostics.fuzzy.type, 'common');

  const un = matchRecord({ scientific_name: 'Unknown plant' }, indexes);
  assert.equal(un.match_type, 'unresolved');
  assert.equal(un.match_score, 0);
});

test('step2 normalization tolerates cultivar punctuation', () => {
  const normalized = matchRecord({ scientific_name: 'Solanum lycopersicum cv. Roma' }, indexes);
  assert.equal(normalized.match_type, 'normalized_scientific');
});

test('step2 bounded fuzzy skips very short common names', () => {
  const rec = matchRecord({ common_name: 'tom' }, indexes);
  assert.equal(rec.match_type, 'unresolved');
});

test('step2 resume appends only records after the saved absolute index', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'step2-progress-'));
  const originalPaths = { ...PATHS };
  const originalProgressPaths = { ...PROGRESS_PATHS };

  try {
    PATHS.step1 = path.join(root, 'step1.jsonl');
    PATHS.step2 = path.join(root, 'step2.jsonl');
    PATHS.openfarmCrops = path.join(root, 'openfarm.csv');
    PATHS.permapeopleCacheDir = path.join(root, 'permapeople-cache');
    PATHS.permapeopleManifest = path.join(root, 'permapeople-manifest.json');
    PROGRESS_PATHS[2] = path.join(root, 'step2-progress.json');

    await fsp.writeFile(
      PATHS.step1,
      `${JSON.stringify({
        canonical_id: 'KNOWN1',
        accepted_scientific_name: 'Known plant',
        scientific_name_normalized: 'known plant',
        synonyms: [],
        common_names: [],
      })}\n`,
      'utf8',
    );
    await fsp.writeFile(
      PATHS.openfarmCrops,
      [
        'Unknownus alpha,',
        'Unknownus beta,',
      ].join('\n'),
      'utf8',
    );

    await runStep2({ limit: 1 });
    await runStep2({ limit: 2 });

    const rows = [];
    for await (const row of readJsonl(PATHS.step2)) rows.push(row);
    const progress = await readProgress(2);

    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((row) => row.source_record_id),
      [
        'openfarm:unknownus-alpha:unknown:0',
        'openfarm:unknownus-beta:unknown:1',
      ],
    );
    assert.equal(progress.lastProcessedIndex, 1);
  } finally {
    Object.assign(PATHS, originalPaths);
    Object.assign(PROGRESS_PATHS, originalProgressPaths);
    await fsp.rm(root, { recursive: true, force: true });
  }
});
