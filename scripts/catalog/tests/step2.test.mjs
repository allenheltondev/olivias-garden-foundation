import test from 'node:test';
import assert from 'node:assert/strict';
import { matchRecord } from '../step2_match_sources.mjs';

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

  const fuzzyCommon = matchRecord({ common_name: 'tomat0' }, indexes);
  assert.equal(fuzzyCommon.match_type, 'fuzzy_fallback');
  assert.equal(fuzzyCommon.needs_review, true);

  const un = matchRecord({ scientific_name: 'Unknown plant' }, indexes);
  assert.equal(un.match_type, 'unresolved');
  assert.equal(un.match_score, 0);
});

test('step2 normalization tolerates cultivar punctuation', () => {
  const normalized = matchRecord({ scientific_name: 'Solanum lycopersicum cv. Roma' }, indexes);
  assert.equal(normalized.match_type, 'normalized_scientific');
});
