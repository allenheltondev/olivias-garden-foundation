import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { PATHS } from './lib/config.mjs';
import { readQuotedCsv, readHeaderlessCsv, appendJsonl, computeChecksum } from './lib/io.mjs';
import { normalizeToNull } from './lib/normalize.mjs';
import { writeProgress, readProgress, verifyChecksum, resetProgress } from './lib/progress.mjs';

export function normalizeScientificName(name) {
  const v = normalizeToNull(name);
  if (!v) return null;
  const parts = v.toLowerCase().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).join(' ');
}

function slugify(name) {
  if (!name) return null;
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 96) || null;
}

/**
 * Build OpenFarm-originated canonical identities for rows that have no USDA match.
 * Deduplicates by scientific_name_normalized — first row wins.
 * Skips rows lacking both a parseable scientific name and a common name.
 */
export function buildOpenFarmCanonicals(openfarmRows, usdaNormalizedSet) {
  const seen = new Set();
  const canonicals = [];

  for (const row of openfarmRows) {
    const sciNorm = normalizeScientificName(row.scientific_name);
    const commonName = normalizeToNull(row.common_name);

    // Skip rows lacking both parseable scientific name and common name
    if (!sciNorm && !commonName) continue;

    // Determine dedup key and canonical_id
    let dedupKey;
    let canonicalId;

    if (sciNorm) {
      dedupKey = sciNorm;
      canonicalId = `openfarm:${sciNorm}`;
    } else {
      const slug = slugify(commonName);
      if (!slug) continue;
      dedupKey = `common:${slug}`;
      canonicalId = `openfarm:common:${slug}`;
    }

    // Skip if USDA canonical already covers this normalized name
    if (sciNorm && usdaNormalizedSet.has(sciNorm)) continue;

    // Deduplicate — first OpenFarm row wins
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    canonicals.push({
      canonical_id: canonicalId,
      usda_symbol: null,
      origin: 'openfarm',
      accepted_scientific_name: row.scientific_name ?? null,
      family: null,
      scientific_name_normalized: sciNorm,
      synonyms: [],
      common_names: commonName
        ? commonName.split(',').map((n) => n.trim()).filter(Boolean)
        : [],
    });
  }

  return canonicals;
}

function mapRow(row) {
  return {
    symbol: row.Symbol?.trim(),
    synonymSymbol: normalizeToNull(row['Synonym Symbol']),
    scientificName: row['Scientific Name with Author']?.trim(),
    commonName: normalizeToNull(row['Common Name']),
    family: normalizeToNull(row.Family),
  };
}

export async function runStep1({ reset = false, dryRun = false, limit = null } = {}) {
  if (!fs.existsSync(PATHS.usdaPlants)) {
    throw new Error(`Missing USDA file: ${PATHS.usdaPlants}`);
  }

  if (reset) await resetProgress(1);

  const checksum = await computeChecksum(PATHS.usdaPlants);
  await verifyChecksum(1, checksum);

  const progress = await readProgress(1);
  const startIndex = progress ? progress.lastProcessedIndex + 1 : 0;

  const rows = (await readQuotedCsv(PATHS.usdaPlants)).map(mapRow);
  const accepted = rows.filter((r) => !r.synonymSymbol);
  const synonymRows = rows.filter((r) => r.synonymSymbol);

  const synonymsByAccepted = new Map();
  for (const s of synonymRows) {
    if (!synonymsByAccepted.has(s.symbol)) synonymsByAccepted.set(s.symbol, []);
    synonymsByAccepted.get(s.symbol).push(s.scientificName);
  }

  const out = [];
  const slice = accepted.slice(startIndex, limit ? startIndex + limit : undefined);
  for (let i = 0; i < slice.length; i += 1) {
    const a = slice[i];
    out.push({
      canonical_id: a.symbol,
      usda_symbol: a.symbol,
      origin: 'usda',
      accepted_scientific_name: a.scientificName,
      family: a.family,
      scientific_name_normalized: normalizeScientificName(a.scientificName),
      synonyms: synonymsByAccepted.get(a.symbol) || [],
      common_names: a.commonName ? [a.commonName] : [],
    });
  }

  // --- Second pass: OpenFarm-originated canonicals ---
  let openFarmCanonicalCount = 0;
  if (fs.existsSync(PATHS.openfarmCrops)) {
    const usdaNormalizedSet = new Set(
      out.map((c) => c.scientific_name_normalized).filter(Boolean),
    );
    const openfarmRows = await readHeaderlessCsv(PATHS.openfarmCrops, ['scientific_name', 'common_name']);
    const openfarmCanonicals = buildOpenFarmCanonicals(openfarmRows, usdaNormalizedSet);
    out.push(...openfarmCanonicals);
    openFarmCanonicalCount = openfarmCanonicals.length;
  }

  if (!dryRun) {
    await fsp.mkdir('data/catalog', { recursive: true });
    await appendJsonl(PATHS.step1, out);
    if (out.length > 0) {
      await writeProgress(1, startIndex + out.length - 1, checksum);
    }
  }

  return {
    totalCanonicalIdentitiesBuilt: accepted.length,
    processedThisRun: out.length,
    totalSynonymsIndexed: synonymRows.length,
    totalCommonNamesIndexed: accepted.filter((a) => a.commonName).length,
    openFarmCanonicalCount,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runStep1().then((s) => console.log(JSON.stringify(s, null, 2))).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
