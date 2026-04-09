import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { buildIndexes, matchRecord } from '../step2_match_sources.mjs';

// Feature: catalog-pipeline-quality, Property 3: Cultivar stripping recovers base match
// Validates: Requirements 2.2
test('appending a cultivar designation to a valid binomial produces cultivar_stripped or normalized_scientific, not unresolved', async () => {
  // Generate valid binomial tokens that survive cleanToken/normSci intact:
  // - At least 3 chars (cleanToken strips 1-2 char words)
  // - Lowercase alpha only
  // - Must not end with 'x' (cleanToken strips 'x' followed by space as hybrid marker)
  const safeChars = 'abcdefghijklmnopqrstuvw';  // exclude x,y,z trailing issues; y/z are fine but x is not
  const arbToken = fc.tuple(
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'), { minLength: 2, maxLength: 9 }),
    fc.constantFrom(...safeChars),  // last char is never 'x'
  ).map(([body, last]) => body + last)
    .filter(t => !t.startsWith('cv') && !t.startsWith('var') && !t.startsWith('subsp') && !t.startsWith('ssp') && !t.startsWith('aff') && !t.startsWith('cf'));

  // Cultivar word: 3+ alpha chars (must survive cleanToken without being stripped)
  const arbCultivarWord = fc.tuple(
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'), { minLength: 2, maxLength: 11 }),
    fc.constantFrom(...safeChars),
  ).map(([body, last]) => body + last);

  // Cultivar designation patterns that get PREPENDED to the binomial.
  // Prepending causes normSci to produce a wrong two-token prefix,
  // so the cultivar_stripped strategy fires to recover the base match.
  // Trailing patterns (e.g., "Genus species cv. X") are handled by normSci directly
  // and resolve via normalized_scientific. Both outcomes satisfy the property.
  const arbCultivarDesignation = fc.oneof(
    arbCultivarWord.map(w => `cv. ${w}`),                          // cv. Roma
    arbCultivarWord.map(w => `'${w}'`),                            // 'Brandywine'
    arbCultivarWord.map(w => `\u2018${w}\u2019`),                  // \u2018Brandywine\u2019 (smart quotes)
  );

  await fc.assert(
    fc.asyncProperty(arbToken, arbToken, arbCultivarDesignation, async (genus, species, cultivar) => {
      // Ensure genus and species are different so the binomial is a valid two-token name
      fc.pre(genus !== species);

      const binomial = `${genus} ${species}`;

      // Build a canonical row with this binomial
      const canonical = {
        canonical_id: `test:${binomial}`,
        accepted_scientific_name: `${genus.charAt(0).toUpperCase() + genus.slice(1)} ${species}`,
        scientific_name_normalized: binomial,
        synonyms: [],
        common_names: [],
      };

      const indexes = buildIndexes([canonical]);

      // Prepend cultivar designation to the binomial
      const cultivarName = `${cultivar} ${canonical.accepted_scientific_name}`;

      const record = {
        scientific_name: cultivarName,
        common_name: null,
      };

      const result = matchRecord(record, indexes);

      // Must resolve via cultivar_stripped or normalized_scientific, not unresolved
      assert.ok(
        result.match_type === 'cultivar_stripped' || result.match_type === 'normalized_scientific',
        `Expected match_type "cultivar_stripped" or "normalized_scientific" but got "${result.match_type}" for input "${cultivarName}" (binomial: "${binomial}")`,
      );
      assert.equal(result.canonical_id, canonical.canonical_id,
        `Expected canonical_id "${canonical.canonical_id}" but got "${result.canonical_id}"`);
    }),
    { numRuns: 100 },
  );
});

// Feature: catalog-pipeline-quality, Property 4: Parenthetical extraction enables common name match
// Validates: Requirements 2.1
test('wrapping a canonical common name in parentheses in the scientific_name field produces parenthetical_common match', async () => {
  // Stop words that normCommon strips — common names must not be one of these
  const stopWords = new Set(['tree', 'plant', 'common', 'wild', 'garden']);

  // Generate a safe common name: 3-10 lowercase alpha chars, not a stop word
  const safeChars = 'abcdefghijklmnopqrstuvwxyz';
  const arbCommonName = fc.stringOf(fc.constantFrom(...safeChars), { minLength: 3, maxLength: 10 })
    .filter(w => !stopWords.has(w) && w.length >= 3);

  // Generate a prefix name: 3-8 lowercase alpha chars (used before the parenthetical)
  // Must be different enough to not accidentally match anything in the index
  const arbPrefix = fc.stringOf(fc.constantFrom(...safeChars), { minLength: 3, maxLength: 8 });

  await fc.assert(
    fc.asyncProperty(arbCommonName, arbPrefix, async (commonName, prefix) => {
      // Ensure prefix and commonName are different
      fc.pre(prefix !== commonName);

      // Build a canonical with this common name and a scientific name that won't collide
      // Use a unique genus+species that won't match the prefix
      const uniqueGenus = 'zzcanon';
      const uniqueSpecies = 'zzspecies';
      const canonical = {
        canonical_id: `test:${commonName}`,
        accepted_scientific_name: `${uniqueGenus.charAt(0).toUpperCase() + uniqueGenus.slice(1)} ${uniqueSpecies}`,
        scientific_name_normalized: `${uniqueGenus} ${uniqueSpecies}`,
        synonyms: [],
        common_names: [commonName],
      };

      const indexes = buildIndexes([canonical]);

      // Wrap the common name in parentheses after a prefix in the scientific_name field
      // e.g. "SomePrefix (commonName)"
      const scientificInput = `${prefix.charAt(0).toUpperCase() + prefix.slice(1)} (${commonName})`;

      const record = {
        scientific_name: scientificInput,
        common_name: null,
      };

      const result = matchRecord(record, indexes);

      // Must resolve via parenthetical_common, not unresolved
      assert.equal(
        result.match_type,
        'parenthetical_common',
        `Expected match_type "parenthetical_common" but got "${result.match_type}" for input "${scientificInput}" (common name: "${commonName}")`,
      );
      assert.equal(
        result.canonical_id,
        canonical.canonical_id,
        `Expected canonical_id "${canonical.canonical_id}" but got "${result.canonical_id}"`,
      );
    }),
    { numRuns: 100 },
  );
});

// Feature: catalog-pipeline-quality, Property 5: Genus match resolves unique genus, marks ambiguous multi-genus
// Validates: Requirements 2.3, 2.4, 2.5
test('unique genus resolves via genus_match with score between 0.55 and 0.7; ambiguous genus returns ambiguous_common_name', async () => {
  // Safe token generator: 3+ lowercase alpha chars, never ending with 'x'
  // (cleanToken strips 1-2 char words and 'x' followed by space as hybrid marker)
  const safeEndChars = 'abcdefghijklmnopqrstuvw'; // exclude x
  const arbToken = fc.tuple(
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwyz'), { minLength: 2, maxLength: 6 }),
    fc.constantFrom(...safeEndChars),
  ).map(([body, last]) => body + last);

  // --- Sub-property A: unique genus resolves via genus_match ---
  await fc.assert(
    fc.asyncProperty(arbToken, arbToken, arbToken, async (genus, species, otherSpecies) => {
      // Ensure species tokens are distinct so the query doesn't match via normalized_scientific
      fc.pre(species !== otherSpecies);
      // Ensure genus differs from both species to avoid single-token collisions
      fc.pre(genus !== species && genus !== otherSpecies);

      const binomial = `${genus} ${species}`;
      const canonical = {
        canonical_id: `test:${binomial}`,
        accepted_scientific_name: `${genus.charAt(0).toUpperCase() + genus.slice(1)} ${species}`,
        scientific_name_normalized: binomial,
        synonyms: [],
        common_names: [],
      };

      const indexes = buildIndexes([canonical]);

      // Query with same genus but different species
      const queryName = `${genus} ${otherSpecies}`;
      const record = { scientific_name: queryName, common_name: null };
      const result = matchRecord(record, indexes);

      assert.equal(result.match_type, 'genus_match',
        `Expected "genus_match" but got "${result.match_type}" for query "${queryName}" against canonical "${binomial}"`);
      assert.equal(result.canonical_id, canonical.canonical_id);
      assert.ok(result.match_score > 0.55 && result.match_score < 0.7,
        `Expected score between 0.55 and 0.7 but got ${result.match_score}`);
    }),
    { numRuns: 100 },
  );

  // --- Sub-property B: ambiguous genus returns ambiguous_common_name ---
  await fc.assert(
    fc.asyncProperty(arbToken, arbToken, arbToken, arbToken, async (genus, speciesA, speciesB, otherSpecies) => {
      // All species tokens must be distinct
      fc.pre(speciesA !== speciesB && speciesA !== otherSpecies && speciesB !== otherSpecies);
      // Genus must differ from all species
      fc.pre(genus !== speciesA && genus !== speciesB && genus !== otherSpecies);

      const canonicalA = {
        canonical_id: `test:${genus}-${speciesA}`,
        accepted_scientific_name: `${genus.charAt(0).toUpperCase() + genus.slice(1)} ${speciesA}`,
        scientific_name_normalized: `${genus} ${speciesA}`,
        synonyms: [],
        common_names: [],
      };
      const canonicalB = {
        canonical_id: `test:${genus}-${speciesB}`,
        accepted_scientific_name: `${genus.charAt(0).toUpperCase() + genus.slice(1)} ${speciesB}`,
        scientific_name_normalized: `${genus} ${speciesB}`,
        synonyms: [],
        common_names: [],
      };

      const indexes = buildIndexes([canonicalA, canonicalB]);

      // Query with same genus but a third species not matching either canonical
      const queryName = `${genus} ${otherSpecies}`;
      const record = { scientific_name: queryName, common_name: null };
      const result = matchRecord(record, indexes);

      assert.equal(result.match_type, 'ambiguous_common_name',
        `Expected "ambiguous_common_name" but got "${result.match_type}" for query "${queryName}" against genus "${genus}" with two canonicals`);
      assert.equal(result.canonical_id, null);
    }),
    { numRuns: 100 },
  );
});
