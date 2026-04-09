import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { generateSql, slugify, parseZoneNumber } from '../generate_sql.mjs';

/**
 * Helper: create a temp dir, write a JSONL input file, run generateSql,
 * read the output SQL, and clean up.
 */
async function runWithRecords(records, batchId = 'test_batch') {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'gen-sql-test-'));
  const inputPath = path.join(root, 'promoted.jsonl');
  const outputPath = path.join(root, 'output.sql');

  const jsonl = records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : '');
  await fsp.writeFile(inputPath, jsonl, 'utf8');

  const summary = await generateSql({ inputPath, outputPath, batchId });
  const sql = await fsp.readFile(outputPath, 'utf8');

  await fsp.rm(root, { recursive: true, force: true });
  return { sql, summary };
}

/** Minimal promoted record with all fields populated. */
function makeRecord(overrides = {}) {
  return {
    canonical_id: 'LYCO2',
    scientific_name: 'Solanum lycopersicum',
    common_name: 'Tomato',
    category: 'vegetable',
    description: 'A common food crop',
    edible: true,
    edible_parts: ['fruit'],
    water_requirement: 'moderate',
    light_requirements: ['full sun'],
    life_cycle: 'annual',
    hardiness_zones: ['5a', '10b'],
    catalog_status: 'core',
    review_status: 'auto_approved',
    field_sources: {},
    import_batch_id: 'test_batch',
    imported_at: '2025-01-01T00:00:00.000Z',
    last_verified_at: null,
    ...overrides,
  };
}

// --- slugify helper ---

test('slugify lowercases and replaces non-alphanumeric with hyphens', () => {
  assert.equal(slugify('Cherry Tomato'), 'cherry-tomato');
  assert.equal(slugify('Bell Pepper (Sweet)'), 'bell-pepper-sweet');
});

// --- parseZoneNumber helper ---

test('parseZoneNumber extracts integer zone from zone strings', () => {
  assert.equal(parseZoneNumber('5a'), 5);
  assert.equal(parseZoneNumber('10b'), 10);
  assert.equal(parseZoneNumber('7'), 7);
  assert.equal(parseZoneNumber('invalid'), null);
  assert.equal(parseZoneNumber(null), null);
});

// --- crops upsert ---

test('crops upsert: INSERT INTO crops with all required columns and ON CONFLICT', async () => {
  const { sql } = await runWithRecords([makeRecord()]);

  assert.ok(sql.includes('INSERT INTO crops'), 'should contain INSERT INTO crops');
  // Required columns
  assert.ok(sql.includes('slug'), 'should include slug column');
  assert.ok(sql.includes('common_name'), 'should include common_name column');
  assert.ok(sql.includes('scientific_name'), 'should include scientific_name column');
  assert.ok(sql.includes('category'), 'should include category column');
  assert.ok(sql.includes('description'), 'should include description column');
  assert.ok(sql.includes('source_provider'), 'should include source_provider column');
  assert.ok(sql.includes('source_record_id'), 'should include source_record_id column');
  assert.ok(sql.includes('import_batch_id'), 'should include import_batch_id column');
  assert.ok(sql.includes('imported_at'), 'should include imported_at column');
  assert.ok(sql.includes('last_verified_at'), 'should include last_verified_at column');
  assert.ok(sql.includes('ON CONFLICT'), 'should include ON CONFLICT clause');
  assert.ok(sql.includes('source_provider, source_record_id'), 'ON CONFLICT should key on source_provider, source_record_id');
});

// --- source_provider and source_record_id ---

test('source_provider is pipeline_enriched and source_record_id is canonical_id', async () => {
  const rec = makeRecord({ canonical_id: 'MY_CANON_42' });
  const { sql } = await runWithRecords([rec]);

  assert.ok(sql.includes("'pipeline_enriched'"), 'source_provider should be pipeline_enriched');
  assert.ok(sql.includes("'MY_CANON_42'"), 'source_record_id should be the canonical_id');
});

// --- crop_profiles conditional ---

test('crop_profiles generated when growing attributes present', async () => {
  const rec = makeRecord({ water_requirement: 'moderate', light_requirements: ['full sun'], life_cycle: 'annual' });
  const { sql, summary } = await runWithRecords([rec]);

  assert.ok(sql.includes('INSERT INTO crop_profiles'), 'should generate crop_profiles INSERT');
  assert.ok(sql.includes('ON CONFLICT (crop_id, variety_id)'), 'crop_profiles should have ON CONFLICT');
  assert.equal(summary.profilesCount, 1);
});

test('crop_profiles not generated when no growing attributes', async () => {
  const rec = makeRecord({
    water_requirement: null,
    light_requirements: [],
    life_cycle: null,
  });
  const { sql, summary } = await runWithRecords([rec]);

  assert.ok(!sql.includes('INSERT INTO crop_profiles'), 'should NOT generate crop_profiles INSERT');
  assert.equal(summary.profilesCount, 0);
});

// --- crop_zone_suitability conditional ---

test('crop_zone_suitability generated when hardiness_zones non-empty', async () => {
  const rec = makeRecord({ hardiness_zones: ['3a', '8b'] });
  const { sql, summary } = await runWithRecords([rec]);

  assert.ok(sql.includes('INSERT INTO crop_zone_suitability'), 'should generate zone suitability INSERT');
  assert.ok(sql.includes('ON CONFLICT'), 'zone suitability should have ON CONFLICT');
  assert.equal(summary.zonesCount, 1);
});

test('crop_zone_suitability not generated when hardiness_zones empty', async () => {
  const rec = makeRecord({ hardiness_zones: [] });
  const { sql, summary } = await runWithRecords([rec]);

  assert.ok(!sql.includes('INSERT INTO crop_zone_suitability'), 'should NOT generate zone suitability INSERT');
  assert.equal(summary.zonesCount, 0);
});

// --- zone parsing: min_zone <= max_zone ---

test('zone parsing: min_zone is less than or equal to max_zone', async () => {
  const rec = makeRecord({ hardiness_zones: ['10b', '3a'] });
  const { sql } = await runWithRecords([rec]);

  // Extract the VALUES line for crop_zone_suitability
  const zoneInsert = sql.split('\n').find((l) => l.includes('INSERT INTO crop_zone_suitability'));
  assert.ok(zoneInsert, 'should have zone suitability INSERT');

  // The VALUES line follows the INSERT; find the min/max numbers
  const valuesLine = sql.split('\n').find((l) => l.includes("'USDA'"));
  assert.ok(valuesLine, 'should have USDA system in VALUES');
  // Extract the two integers after 'USDA'
  const nums = valuesLine.match(/'USDA',\s*(\d+),\s*(\d+)/);
  assert.ok(nums, 'should find min_zone and max_zone numbers');
  const minZone = parseInt(nums[1], 10);
  const maxZone = parseInt(nums[2], 10);
  assert.ok(minZone <= maxZone, `min_zone (${minZone}) should be <= max_zone (${maxZone})`);
  assert.equal(minZone, 3);
  assert.equal(maxZone, 10);
});

// --- slug dedup ---

test('slug dedup: two records with same common_name get unique slugs', async () => {
  const rec1 = makeRecord({ canonical_id: 'A1', common_name: 'Tomato' });
  const rec2 = makeRecord({ canonical_id: 'A2', common_name: 'Tomato' });
  const { sql } = await runWithRecords([rec1, rec2]);

  // Both should produce crops INSERTs
  const inserts = sql.split('\n').filter((l) => l.trimStart().startsWith('INSERT INTO crops'));
  assert.equal(inserts.length, 2, 'should have two crops INSERTs');

  // First slug is 'tomato', second is 'tomato-2'
  assert.ok(sql.includes("'tomato'"), 'first slug should be tomato');
  assert.ok(sql.includes("'tomato-2'"), 'second slug should be tomato-2');
});

// --- empty input ---

test('empty input: produces SQL file with header comment only', async () => {
  const { sql, summary } = await runWithRecords([]);

  assert.ok(sql.includes('-- Generated by generate_sql.mjs'), 'should have header comment');
  assert.ok(sql.includes('-- Records: 0'), 'should show 0 records');
  assert.ok(!sql.includes('INSERT INTO crops'), 'should NOT have any crops INSERT');
  assert.equal(summary.recordCount, 0);
  assert.equal(summary.cropsCount, 0);
  assert.equal(summary.profilesCount, 0);
  assert.equal(summary.zonesCount, 0);
});
