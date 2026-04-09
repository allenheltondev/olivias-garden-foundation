import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { buildOpenFarmCanonicals, normalizeScientificName } from '../step1_canonical_identity.mjs';

// Feature: catalog-pipeline-quality, Property 1: OpenFarm canonical determinism and uniqueness
// Validates: Requirements 1.1, 1.2, 1.5
test('buildOpenFarmCanonicals is deterministic and count equals unique normalized names not in USDA set', async () => {
  // Arbitrary for a single OpenFarm row with { scientific_name, common_name }
  const arbOpenfarmRow = fc.record({
    scientific_name: fc.oneof(
      fc.constant(null),
      fc.constant(''),
      fc.constant('  '),
      // Generate realistic binomial names: two lowercase alpha tokens
      fc.tuple(
        fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'), { minLength: 2, maxLength: 10 }),
        fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'), { minLength: 2, maxLength: 10 }),
      ).map(([g, s]) => `${g} ${s}`),
    ),
    common_name: fc.oneof(
      fc.constant(null),
      fc.constant(''),
      fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz -'), { minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0),
    ),
  });

  const arbRows = fc.array(arbOpenfarmRow, { minLength: 0, maxLength: 30 });

  // Arbitrary for a USDA normalized set (set of lowercase binomial strings)
  const arbUsdaSet = fc.array(
    fc.tuple(
      fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'), { minLength: 2, maxLength: 10 }),
      fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'), { minLength: 2, maxLength: 10 }),
    ).map(([g, s]) => `${g} ${s}`),
    { minLength: 0, maxLength: 10 },
  ).map(arr => new Set(arr));

  await fc.assert(
    fc.asyncProperty(arbRows, arbUsdaSet, async (rows, usdaSet) => {
      // Run twice on the same input
      const result1 = buildOpenFarmCanonicals(rows, usdaSet);
      const result2 = buildOpenFarmCanonicals(rows, usdaSet);

      // Determinism: identical output
      assert.deepStrictEqual(result1, result2);

      // Uniqueness: count equals unique dedup keys not in USDA set
      const expectedKeys = new Set();
      for (const row of rows) {
        const sciNorm = normalizeScientificName(row.scientific_name);
        const commonName = row.common_name != null ? row.common_name.trim() : null;
        const hasCommon = commonName && commonName.length > 0 && commonName.toLowerCase() !== 'not specified' && commonName.toLowerCase() !== 'n/a';

        if (!sciNorm && !hasCommon) continue;

        let dedupKey;
        if (sciNorm) {
          if (usdaSet.has(sciNorm)) continue;
          dedupKey = sciNorm;
        } else {
          // common-name fallback slug
          const slug = commonName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
            .slice(0, 96);
          if (!slug) continue;
          dedupKey = `common:${slug}`;
        }
        expectedKeys.add(dedupKey);
      }

      assert.equal(result1.length, expectedKeys.size,
        `Expected ${expectedKeys.size} canonicals but got ${result1.length}`);
    }),
    { numRuns: 100 },
  );
});

// Feature: catalog-pipeline-quality, Property 2: OpenFarm canonical shape invariant
// Validates: Requirements 1.3, 1.4
test('every OpenFarm-originated canonical has origin "openfarm" and fields populated from source', async () => {
  // Generate OpenFarm rows that have at least a scientific_name or common_name
  // so that canonicals are actually produced.
  const arbScientificName = fc.tuple(
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'), { minLength: 2, maxLength: 10 }),
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'), { minLength: 2, maxLength: 10 }),
  ).map(([g, s]) => `${g} ${s}`);

  const arbCommonName = fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz -'),
    { minLength: 1, maxLength: 20 },
  ).filter(s => s.trim().length > 0 && /[a-z]/.test(s));

  // Row with at least one of scientific_name or common_name present
  const arbOpenfarmRow = fc.oneof(
    // Has both scientific_name and common_name
    fc.record({
      scientific_name: arbScientificName,
      common_name: arbCommonName,
    }),
    // Has only scientific_name
    fc.record({
      scientific_name: arbScientificName,
      common_name: fc.constant(null),
    }),
    // Has only common_name
    fc.record({
      scientific_name: fc.constant(null),
      common_name: arbCommonName,
    }),
  );

  const arbRows = fc.array(arbOpenfarmRow, { minLength: 1, maxLength: 30 });

  await fc.assert(
    fc.asyncProperty(arbRows, async (rows) => {
      // Pass empty USDA set so all rows can produce canonicals
      const usdaSet = new Set();
      const canonicals = buildOpenFarmCanonicals(rows, usdaSet);

      // Must produce at least one canonical since rows have names
      assert.ok(canonicals.length > 0, 'Expected at least one canonical');

      for (const canonical of canonicals) {
        // origin must be 'openfarm'
        assert.equal(canonical.origin, 'openfarm',
          `Expected origin "openfarm" but got "${canonical.origin}"`);

        // Find the source row that produced this canonical by matching on dedup key
        const sourceRow = rows.find(row => {
          const sciNorm = normalizeScientificName(row.scientific_name);
          if (sciNorm) {
            return canonical.canonical_id === `openfarm:${sciNorm}`;
          }
          // common-name fallback
          const cn = row.common_name != null ? row.common_name.trim() : null;
          if (cn && cn.length > 0) {
            const slug = cn.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 96);
            return canonical.canonical_id === `openfarm:common:${slug}`;
          }
          return false;
        });

        assert.ok(sourceRow, `Could not find source row for canonical ${canonical.canonical_id}`);

        const sourceSciNorm = normalizeScientificName(sourceRow.scientific_name);

        // accepted_scientific_name populated from source when source provides it
        if (sourceRow.scientific_name != null) {
          assert.equal(canonical.accepted_scientific_name, sourceRow.scientific_name,
            'accepted_scientific_name should match source scientific_name');
        }

        // scientific_name_normalized populated when source has scientific_name
        if (sourceSciNorm) {
          assert.equal(canonical.scientific_name_normalized, sourceSciNorm,
            'scientific_name_normalized should be the normalized form of source scientific_name');
        }

        // common_names populated from source when source provides common_name
        if (sourceRow.common_name != null && sourceRow.common_name.trim().length > 0) {
          assert.ok(Array.isArray(canonical.common_names), 'common_names should be an array');
          assert.ok(canonical.common_names.length > 0,
            'common_names should be non-empty when source provides common_name');
          // Each common_name entry should be a trimmed token from the source
          const expectedNames = sourceRow.common_name.split(',').map(n => n.trim()).filter(Boolean);
          assert.deepStrictEqual(canonical.common_names, expectedNames,
            'common_names should be split from source common_name');
        }
      }
    }),
    { numRuns: 100 },
  );
});

// Feature: catalog-pipeline-quality, Property 11: No canonical for records lacking both names
// Validates: Requirements 6.3
test('buildOpenFarmCanonicals produces no canonical for records lacking both names', async () => {
  // Arbitrary that generates values normalizeToNull treats as empty:
  // null, undefined, empty string, whitespace-only, 'not specified', 'n/a'
  const arbEmpty = fc.oneof(
    fc.constant(null),
    fc.constant(undefined),
    fc.constant(''),
    fc.stringOf(fc.constantFrom(' ', '\t', '\n'), { minLength: 1, maxLength: 8 }),
    fc.constant('not specified'),
    fc.constant('n/a'),
    fc.constant('Not Specified'),
    fc.constant('N/A'),
  );

  const arbRowMissingBothNames = fc.record({
    scientific_name: arbEmpty,
    common_name: arbEmpty,
  });

  const arbRows = fc.array(arbRowMissingBothNames, { minLength: 1, maxLength: 30 });

  // USDA set doesn't matter since no canonical should be created regardless
  const arbUsdaSet = fc.array(
    fc.tuple(
      fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'), { minLength: 2, maxLength: 8 }),
      fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'), { minLength: 2, maxLength: 8 }),
    ).map(([g, s]) => `${g} ${s}`),
    { minLength: 0, maxLength: 5 },
  ).map(arr => new Set(arr));

  await fc.assert(
    fc.asyncProperty(arbRows, arbUsdaSet, async (rows, usdaSet) => {
      const canonicals = buildOpenFarmCanonicals(rows, usdaSet);
      assert.equal(canonicals.length, 0,
        `Expected 0 canonicals for rows lacking both names, got ${canonicals.length}`);
    }),
    { numRuns: 100 },
  );
});
