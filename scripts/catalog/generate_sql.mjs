import fsp from 'node:fs/promises';
import path from 'node:path';
import { PATHS } from './lib/config.mjs';
import { readJsonl } from './lib/io.mjs';

/**
 * Derive a URL-safe slug from a common name.
 * Lowercases, replaces non-alphanumeric runs with hyphens,
 * trims leading/trailing hyphens, and caps at 96 chars.
 */
export function slugify(commonName) {
  return commonName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 96);
}

/**
 * Parse a hardiness zone string like "5a", "10b", "7" into its numeric zone.
 * Returns the integer zone number, or null if unparseable.
 */
export function parseZoneNumber(zoneStr) {
  if (typeof zoneStr !== 'string') return null;
  const m = zoneStr.trim().match(/^(\d+)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (Number.isNaN(n)) return null;
  return n;
}

/**
 * Escape a string for use in a SQL single-quoted literal.
 * Doubles any single quotes.
 */
function sqlEscape(val) {
  if (val == null) return 'NULL';
  return `'${String(val).replace(/'/g, "''")}'`;
}

/**
 * Build the SQL for a single promoted record's crops upsert.
 */
function buildCropsInsert(rec, slug) {
  const importedAt = rec.imported_at ? sqlEscape(rec.imported_at) : 'now()';
  return `INSERT INTO crops (slug, common_name, scientific_name, category, description,
                   source_provider, source_record_id, import_batch_id, imported_at, last_verified_at)
VALUES (${sqlEscape(slug)}, ${sqlEscape(rec.common_name)}, ${sqlEscape(rec.scientific_name)}, ${sqlEscape(rec.category)}, ${sqlEscape(rec.description)},
        'pipeline_enriched', ${sqlEscape(rec.canonical_id)}, ${sqlEscape(rec.import_batch_id)}, ${importedAt}, NULL)
ON CONFLICT (source_provider, source_record_id) DO UPDATE SET
  common_name = EXCLUDED.common_name,
  scientific_name = EXCLUDED.scientific_name,
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  import_batch_id = EXCLUDED.import_batch_id,
  imported_at = EXCLUDED.imported_at,
  updated_at = now();`;
}


/**
 * Build the crop_profiles upsert SQL.
 * Only called when at least one of water_requirement, light_requirements, or life_cycle is present.
 */
function buildCropProfileInsert(rec) {
  const cropIdSubquery = `(SELECT id FROM crops WHERE source_provider = 'pipeline_enriched' AND source_record_id = ${sqlEscape(rec.canonical_id)})`;
  const sunReq = Array.isArray(rec.light_requirements) && rec.light_requirements.length > 0
    ? sqlEscape(rec.light_requirements[0])
    : 'NULL';
  const waterReq = rec.water_requirement ? sqlEscape(rec.water_requirement) : 'NULL';

  const attrs = {};
  if (rec.life_cycle) attrs.life_cycle = rec.life_cycle;
  if (Array.isArray(rec.edible_parts) && rec.edible_parts.length > 0) attrs.edible_parts = rec.edible_parts;
  if (rec.field_sources && Object.keys(rec.field_sources).length > 0) attrs.field_sources = rec.field_sources;
  const attrsJson = sqlEscape(JSON.stringify(attrs));

  return `INSERT INTO crop_profiles (crop_id, variety_id, sun_requirement, water_requirement, attributes)
VALUES (${cropIdSubquery}, NULL, ${sunReq}, ${waterReq}, ${attrsJson}::jsonb)
ON CONFLICT (crop_id) WHERE variety_id IS NULL DO UPDATE SET
  sun_requirement = EXCLUDED.sun_requirement,
  water_requirement = EXCLUDED.water_requirement,
  attributes = EXCLUDED.attributes,
  updated_at = now();`;
}

/**
 * Build the crop_zone_suitability upsert SQL.
 * Only called when hardiness_zones is non-empty and at least one zone is parseable.
 */
function buildZoneSuitabilityInsert(rec, minZone, maxZone) {
  const cropIdSubquery = `(SELECT id FROM crops WHERE source_provider = 'pipeline_enriched' AND source_record_id = ${sqlEscape(rec.canonical_id)})`;

  return `INSERT INTO crop_zone_suitability (crop_id, variety_id, system, min_zone, max_zone)
VALUES (${cropIdSubquery}, NULL, 'USDA', ${minZone}, ${maxZone})
ON CONFLICT (crop_id, system) WHERE variety_id IS NULL DO UPDATE SET
  min_zone = EXCLUDED.min_zone,
  max_zone = EXCLUDED.max_zone,
  updated_at = now();`;
}

/**
 * Determine whether a promoted record has growing profile data.
 */
function hasProfileData(rec) {
  if (rec.water_requirement) return true;
  if (Array.isArray(rec.light_requirements) && rec.light_requirements.length > 0) return true;
  if (rec.life_cycle) return true;
  return false;
}

/**
 * Parse hardiness_zones array and return { minZone, maxZone } or null if none parseable.
 */
function parseZoneRange(zones) {
  if (!Array.isArray(zones) || zones.length === 0) return null;
  const parsed = zones.map(parseZoneNumber).filter((n) => n !== null);
  if (parsed.length === 0) return null;
  return { minZone: Math.min(...parsed), maxZone: Math.max(...parsed) };
}


/**
 * Generate SQL upsert statements from promoted_crops.jsonl.
 *
 * @param {object} opts
 * @param {string} [opts.inputPath]  - Path to promoted JSONL (default: PATHS.promoted)
 * @param {string} [opts.outputPath] - Path to write SQL file (default: PATHS.generatedSql)
 * @param {string} [opts.batchId]    - Optional batch ID for the header comment
 * @returns {Promise<{ recordCount: number, skippedCount: number, cropsCount: number, profilesCount: number, zonesCount: number }>}
 */
export async function generateSql({ inputPath, outputPath, batchId } = {}) {
  const inPath = inputPath || PATHS.promoted;
  const outPath = outputPath || PATHS.generatedSql;

  // Ensure output directory exists
  await fsp.mkdir(path.dirname(outPath), { recursive: true });

  const records = [];
  for await (const rec of readJsonl(inPath)) {
    records.push(rec);
  }

  const lines = [];
  const headerBatch = batchId || 'unknown';
  lines.push(`-- Generated by generate_sql.mjs`);
  lines.push(`-- Batch: ${headerBatch}`);
  lines.push(`-- Records: ${records.length}`);
  lines.push(`-- Generated at: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('BEGIN;');
  lines.push('');

  if (records.length === 0) {
    lines.push('-- No promoted records to import.');
    lines.push('');
    lines.push('COMMIT;');
    await fsp.writeFile(outPath, lines.join('\n') + '\n', 'utf8');
    return { recordCount: 0, skippedCount: 0, cropsCount: 0, profilesCount: 0, zonesCount: 0 };
  }

  const slugCounts = new Map();
  let skippedCount = 0;
  let cropsCount = 0;
  let profilesCount = 0;
  let zonesCount = 0;

  for (const rec of records) {
    // Skip records with null common_name
    if (!rec.common_name) {
      process.stderr.write(`WARNING: Skipping record with null common_name (canonical_id=${rec.canonical_id})\n`);
      skippedCount++;
      continue;
    }

    // Derive slug with dedup
    const baseSlug = slugify(rec.common_name);
    const count = slugCounts.get(baseSlug) || 0;
    slugCounts.set(baseSlug, count + 1);
    const slug = count === 0 ? baseSlug : `${baseSlug}-${count + 1}`;

    if (count >= 99) {
      throw new Error(`Slug collision limit exceeded for slug: ${baseSlug}`);
    }

    // crops upsert
    lines.push(`-- Record: ${rec.canonical_id}`);
    lines.push(buildCropsInsert(rec, slug));
    lines.push('');
    cropsCount++;

    // crop_profiles upsert (conditional)
    if (hasProfileData(rec)) {
      lines.push(buildCropProfileInsert(rec));
      lines.push('');
      profilesCount++;
    }

    // crop_zone_suitability upsert (conditional)
    if (Array.isArray(rec.hardiness_zones) && rec.hardiness_zones.length > 0) {
      const zoneRange = parseZoneRange(rec.hardiness_zones);
      if (zoneRange) {
        lines.push(buildZoneSuitabilityInsert(rec, zoneRange.minZone, zoneRange.maxZone));
        lines.push('');
        zonesCount++;
      } else {
        process.stderr.write(`WARNING: Unparseable zone strings for canonical_id=${rec.canonical_id}, skipping zone row\n`);
      }
    }
  }

  lines.push('COMMIT;');
  await fsp.writeFile(outPath, lines.join('\n') + '\n', 'utf8');

  return { recordCount: records.length, skippedCount, cropsCount, profilesCount, zonesCount };
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && args[i + 1]) opts.inputPath = args[++i];
    else if (args[i] === '--output' && args[i + 1]) opts.outputPath = args[++i];
    else if (args[i] === '--batch-id' && args[i + 1]) opts.batchId = args[++i];
  }
  generateSql(opts)
    .then((s) => console.log(JSON.stringify(s, null, 2)))
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
