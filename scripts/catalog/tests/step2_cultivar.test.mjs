import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIndexes, matchRecord } from '../step2_match_sources.mjs';
import { MATCH_SCORES } from '../lib/config.mjs';

/**
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 7.1, 7.2
 *
 * Tests for the expanded match cascade: cultivar stripping,
 * parenthetical common name extraction, and genus-level matching.
 */

// --- Test canonical rows ---
const canonicalRows = [
  {
    canonical_id: 'LYCO2',
    accepted_scientific_name: 'Solanum lycopersicum L.',
    scientific_name_normalized: 'solanum lycopersicum',
    synonyms: ['lycopersicon esculentum'],
    common_names: ['tomato'],
  },
  {
    canonical_id: 'MALU2',
    accepted_scientific_name: 'Malus domestica Borkh.',
    scientific_name_normalized: 'malus domestica',
    synonyms: [],
    common_names: ['apple'],
  },
  {
    canonical_id: 'CAPS1',
    accepted_scientific_name: 'Capsicum annuum L.',
    scientific_name_normalized: 'capsicum annuum',
    synonyms: [],
    common_names: ['pepper'],
  },
  // Second Capsicum species to create ambiguous genus
  {
    canonical_id: 'CAPS2',
    accepted_scientific_name: 'Capsicum frutescens L.',
    scientific_name_normalized: 'capsicum frutescens',
    synonyms: [],
    common_names: ['tabasco pepper'],
  },
  // Unique genus for genus_match test
  {
    canonical_id: 'CUCU1',
    accepted_scientific_name: 'Cucumis sativus L.',
    scientific_name_normalized: 'cucumis sativus',
    synonyms: [],
    common_names: ['cucumber'],
  },
];

const indexes = buildIndexes(canonicalRows);

// --- Cultivar stripping tests ---
// Note: cleanToken/normSci already strips cv. and quotes for standard
// "Genus species cv. Variety" patterns, resolving via normalized_scientific.
// The cultivar_stripped strategy fires when the cultivar portion appears
// before the binomial, causing normSci to produce a wrong two-token prefix.

test('cultivar stripping: leading cultivar designation resolves via cultivar_stripped', () => {
  // "cv. Roma Solanum lycopersicum" — normSci sees "roma solanum" (wrong),
  // but stripCultivar removes "cv. Roma" first → "solanum lycopersicum"
  const result = matchRecord({ scientific_name: 'cv. Roma Solanum lycopersicum' }, indexes);
  assert.equal(result.match_type, 'cultivar_stripped');
  assert.equal(result.match_score, MATCH_SCORES.cultivar_stripped);
  assert.equal(result.canonical_id, 'LYCO2');
});

test('cultivar stripping: leading quoted variety resolves via cultivar_stripped', () => {
  // "'Brandywine' Solanum lycopersicum" — normSci sees "brandywine solanum" (wrong),
  // but stripCultivar removes the quoted portion first → "solanum lycopersicum"
  const result = matchRecord({ scientific_name: "'Brandywine' Solanum lycopersicum" }, indexes);
  assert.equal(result.match_type, 'cultivar_stripped');
  assert.equal(result.match_score, MATCH_SCORES.cultivar_stripped);
  assert.equal(result.canonical_id, 'LYCO2');
});

test('cultivar stripping: standard cv. pattern still resolves (via normalized_scientific)', () => {
  // Standard "Genus species cv. Variety" is handled by normSci directly
  const result = matchRecord({ scientific_name: 'Solanum lycopersicum cv. Roma' }, indexes);
  assert.equal(result.match_type, 'normalized_scientific');
  assert.equal(result.match_score, MATCH_SCORES.normalized_scientific);
  assert.equal(result.canonical_id, 'LYCO2');
});

// --- Parenthetical extraction test ---

test('parenthetical extraction: "Envy (apple)" as scientific_name resolves via parenthetical_common', () => {
  const result = matchRecord({ scientific_name: 'Envy (apple)' }, indexes);
  assert.equal(result.match_type, 'parenthetical_common');
  assert.equal(result.match_score, MATCH_SCORES.parenthetical_common);
  assert.equal(result.canonical_id, 'MALU2');
});

// --- Genus match tests ---

test('genus match unique: genus with one canonical resolves via genus_match with correct score', () => {
  // Cucumis has only one canonical (CUCU1), so a non-matching species should genus_match
  const result = matchRecord({ scientific_name: 'Cucumis melo' }, indexes);
  assert.equal(result.match_type, 'genus_match');
  assert.equal(result.match_score, MATCH_SCORES.genus_match);
  assert.equal(result.canonical_id, 'CUCU1');
});

test('genus match ambiguous: genus with multiple canonicals returns ambiguous_common_name', () => {
  // Capsicum has two canonicals (CAPS1, CAPS2), so a non-matching species should be ambiguous
  const result = matchRecord({ scientific_name: 'Capsicum chinense' }, indexes);
  assert.equal(result.match_type, 'ambiguous_common_name');
  assert.equal(result.match_score, MATCH_SCORES.ambiguous_common_name);
  assert.equal(result.canonical_id, null);
});

// --- Existing cascade still works ---

test('existing cascade still works: exact, normalized, synonym, common, unresolved', () => {
  // Exact match
  const exact = matchRecord({ scientific_name: 'Solanum lycopersicum L.' }, indexes);
  assert.equal(exact.match_type, 'exact_scientific');
  assert.equal(exact.match_score, MATCH_SCORES.exact_scientific);

  // Normalized match
  const normalized = matchRecord({ scientific_name: 'Solanum lycopersicum' }, indexes);
  assert.equal(normalized.match_type, 'normalized_scientific');
  assert.equal(normalized.match_score, MATCH_SCORES.normalized_scientific);

  // Synonym match
  const synonym = matchRecord({ scientific_name: 'Lycopersicon esculentum Mill.' }, indexes);
  assert.equal(synonym.match_type, 'synonym_match');
  assert.equal(synonym.match_score, MATCH_SCORES.synonym_match);

  // Common name fallback (unique)
  const common = matchRecord({ common_name: 'cucumber' }, indexes);
  assert.equal(common.match_type, 'common_name_fallback');
  assert.equal(common.match_score, MATCH_SCORES.common_name_fallback);

  // Unresolved — use a name with no genus overlap to avoid genus_match
  const unresolved = matchRecord({ scientific_name: 'Zyxwvutia unknownia' }, indexes);
  assert.equal(unresolved.match_type, 'unresolved');
  assert.equal(unresolved.match_score, MATCH_SCORES.unresolved);
});
