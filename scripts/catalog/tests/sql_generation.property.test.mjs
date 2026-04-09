import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import fc from 'fast-check';
import { generateSql, slugify, parseZoneNumber } from '../generate_sql.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Write records as JSONL, run generateSql, return { sql, summary }, then clean up. */
async function runWithRecords(records, batchId = 'prop_test') {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sql-prop-'));
  const inputPath = path.join(root, 'promoted.jsonl');
  const outputPath = path.join(root, 'output.sql');

  const jsonl = records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : '');
  await fsp.writeFile(inputPath, jsonl, 'utf8');

  const summary = await generateSql({ inputPath, outputPath, batchId });
  const sql = await fsp.readFile(outputPath, 'utf8');

  await fsp.rm(root, { recursive: true, force: true });
  return { sql, summary };
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Safe non-empty string without single quotes (avoids SQL quoting noise in assertions). */
const arbSafeStr = fc
  .stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789 -'), { minLength: 1, maxLength: 20 })
  .filter((s) => s.trim().length > 0);

/** Hardiness zone string like "3a", "10b", "7". */
const arbZoneStr = fc
  .tuple(fc.integer({ min: 1, max: 13 }), fc.constantFrom('a', 'b', ''))
  .map(([n, suffix]) => `${n}${suffix}`);

/** Arbitrary promoted record with guaranteed non-null canonical_id, common_name, scientific_name. */
const arbPromotedRecord = fc
  .record({
    canonical_id: arbSafeStr,
    common_name: arbSafeStr,
    scientific_name: arbSafeStr,
    category: fc.oneof(fc.constant(null), arbSafeStr),
    description: fc.oneof(fc.constant(null), arbSafeStr),
    edible: fc.boolean(),
    edible_parts: fc.oneof(fc.constant([]), fc.array(arbSafeStr, { minLength: 1, maxLength: 3 })),
    water_requirement: fc.oneof(fc.constant(null), arbSafeStr),
    light_requirements: fc.oneof(fc.constant([]), fc.array(arbSafeStr, { minLength: 1, maxLength: 3 })),
    life_cycle: fc.oneof(fc.constant(null), arbSafeStr),
    hardiness_zones: fc.oneof(fc.constant([]), fc.array(arbZoneStr, { minLength: 1, maxLength: 4 })),
    catalog_status: fc.constant('core'),
    review_status: fc.constant('auto_approved'),
    field_sources: fc.constant({}),
    import_batch_id: fc.constant('prop_batch'),
    imported_at: fc.constant('2025-01-01T00:00:00.000Z'),
    last_verified_at: fc.constant(null),
  });


// ---------------------------------------------------------------------------
// Feature: catalog-pipeline-quality, Property 12: SQL generation for crops table is complete and idempotent
// Validates: Requirements 8.1, 8.4, 8.5
// ---------------------------------------------------------------------------
test('Property 12: crops INSERT contains all required columns, ON CONFLICT, pipeline_enriched provider, and canonical_id as source_record_id', async () => {
  await fc.assert(
    fc.asyncProperty(arbPromotedRecord, async (rec) => {
      const { sql } = await runWithRecords([rec]);

      // Must contain INSERT INTO crops
      assert.ok(sql.includes('INSERT INTO crops'), 'SQL must contain INSERT INTO crops');

      // Required columns present in the INSERT statement
      const requiredColumns = [
        'slug', 'common_name', 'scientific_name', 'source_provider',
        'source_record_id', 'import_batch_id', 'imported_at', 'last_verified_at',
      ];
      for (const col of requiredColumns) {
        assert.ok(sql.includes(col), `SQL must reference column: ${col}`);
      }

      // ON CONFLICT clause keyed on (source_provider, source_record_id)
      assert.ok(
        sql.includes('ON CONFLICT (source_provider, source_record_id)'),
        'SQL must include ON CONFLICT (source_provider, source_record_id)',
      );

      // source_provider is 'pipeline_enriched'
      assert.ok(
        sql.includes("'pipeline_enriched'"),
        "source_provider must be 'pipeline_enriched'",
      );

      // source_record_id equals the canonical_id (escaped)
      const escapedId = rec.canonical_id.replace(/'/g, "''");
      assert.ok(
        sql.includes(`'${escapedId}'`),
        `SQL must contain the canonical_id value '${escapedId}'`,
      );
    }),
    { numRuns: 100 },
  );
});

// ---------------------------------------------------------------------------
// Feature: catalog-pipeline-quality, Property 13: SQL generation for crop_profiles is conditional
// Validates: Requirements 8.2
// ---------------------------------------------------------------------------
test('Property 13: crop_profiles INSERT generated iff water_requirement, non-empty light_requirements, or life_cycle is present', async () => {
  await fc.assert(
    fc.asyncProperty(arbPromotedRecord, async (rec) => {
      const { sql } = await runWithRecords([rec]);

      const hasProfile =
        !!rec.water_requirement ||
        (Array.isArray(rec.light_requirements) && rec.light_requirements.length > 0) ||
        !!rec.life_cycle;

      const sqlHasProfile = sql.includes('INSERT INTO crop_profiles');

      if (hasProfile) {
        assert.ok(sqlHasProfile, 'crop_profiles INSERT must be present when profile data exists');
        assert.ok(
          sql.includes('ON CONFLICT (crop_id, variety_id)'),
          'crop_profiles must include ON CONFLICT (crop_id, variety_id)',
        );
      } else {
        assert.ok(!sqlHasProfile, 'crop_profiles INSERT must NOT be present when no profile data');
      }
    }),
    { numRuns: 100 },
  );
});

// ---------------------------------------------------------------------------
// Feature: catalog-pipeline-quality, Property 14: SQL generation for crop_zone_suitability is conditional
// Validates: Requirements 8.3
// ---------------------------------------------------------------------------
test('Property 14: crop_zone_suitability INSERT generated iff hardiness_zones is non-empty, min_zone <= max_zone, and includes ON CONFLICT', async () => {
  await fc.assert(
    fc.asyncProperty(arbPromotedRecord, async (rec) => {
      const { sql } = await runWithRecords([rec]);

      const hasZones = Array.isArray(rec.hardiness_zones) && rec.hardiness_zones.length > 0;
      // Check if at least one zone is parseable
      const parseableZones = hasZones
        ? rec.hardiness_zones.map(parseZoneNumber).filter((n) => n !== null)
        : [];
      const expectZoneInsert = parseableZones.length > 0;

      const sqlHasZone = sql.includes('INSERT INTO crop_zone_suitability');

      if (expectZoneInsert) {
        assert.ok(sqlHasZone, 'zone suitability INSERT must be present when parseable zones exist');
        assert.ok(
          sql.includes('ON CONFLICT'),
          'zone suitability must include ON CONFLICT clause',
        );

        // Extract min_zone and max_zone from the VALUES line containing 'USDA'
        const valuesLine = sql.split('\n').find((l) => l.includes("'USDA'"));
        assert.ok(valuesLine, 'zone INSERT must reference USDA system');

        const nums = valuesLine.match(/'USDA',\s*(\d+),\s*(\d+)/);
        assert.ok(nums, 'must find min_zone and max_zone integers');

        const minZone = parseInt(nums[1], 10);
        const maxZone = parseInt(nums[2], 10);
        assert.ok(minZone <= maxZone, `min_zone (${minZone}) must be <= max_zone (${maxZone})`);
      } else {
        assert.ok(!sqlHasZone, 'zone suitability INSERT must NOT be present when no parseable zones');
      }
    }),
    { numRuns: 100 },
  );
});

// ---------------------------------------------------------------------------
// Feature: catalog-pipeline-quality, Property 15: Slug uniqueness within a batch
// Validates: Requirements 8.6
// ---------------------------------------------------------------------------
test('Property 15: all generated slugs are unique within a batch; duplicate common_names get numeric suffixes', async () => {
  // Generate 2-15 records where some share the same common_name
  const arbBatch = fc
    .array(arbPromotedRecord, { minLength: 2, maxLength: 15 })
    .map((recs) =>
      // Ensure unique canonical_ids so records aren't identical
      recs.map((r, i) => ({ ...r, canonical_id: `cid${i}` })),
    );

  await fc.assert(
    fc.asyncProperty(arbBatch, async (records) => {
      const { sql } = await runWithRecords(records);

      // Compute expected slugs using the same algorithm as generate_sql.mjs
      const slugCounts = new Map();
      const expectedSlugs = [];
      for (const rec of records) {
        if (!rec.common_name) continue;
        const baseSlug = slugify(rec.common_name);
        const count = slugCounts.get(baseSlug) || 0;
        slugCounts.set(baseSlug, count + 1);
        const slug = count === 0 ? baseSlug : `${baseSlug}-${count + 1}`;
        expectedSlugs.push(slug);
      }

      // All expected slugs must be unique
      const slugSet = new Set(expectedSlugs);
      assert.equal(
        slugSet.size,
        expectedSlugs.length,
        `Slugs must be unique. Got duplicates: ${JSON.stringify(expectedSlugs)}`,
      );

      // Verify each expected slug appears in the SQL output
      for (const slug of expectedSlugs) {
        assert.ok(
          sql.includes(`'${slug}'`),
          `SQL must contain slug '${slug}'`,
        );
      }

      // If there are duplicate common_names, at least one slug must have a numeric suffix
      for (const [base, count] of slugCounts) {
        if (count > 1) {
          const hasSuffix = expectedSlugs.some((s) => s !== base && s.startsWith(base + '-') && /\d+$/.test(s));
          assert.ok(hasSuffix, `Duplicate common_name slug "${base}" must produce a numeric suffix`);
        }
      }
    }),
    { numRuns: 100 },
  );
});
