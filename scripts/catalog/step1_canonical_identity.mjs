import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { PATHS } from './lib/config.mjs';
import { readQuotedCsv, appendJsonl, computeChecksum } from './lib/io.mjs';
import { normalizeToNull } from './lib/normalize.mjs';
import { writeProgress, readProgress, verifyChecksum, resetProgress } from './lib/progress.mjs';

function normalizeScientificName(name) {
  const v = normalizeToNull(name);
  if (!v) return null;
  const parts = v.toLowerCase().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).join(' ');
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
      accepted_scientific_name: a.scientificName,
      family: a.family,
      scientific_name_normalized: normalizeScientificName(a.scientificName),
      synonyms: synonymsByAccepted.get(a.symbol) || [],
      common_names: a.commonName ? [a.commonName] : [],
    });
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
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runStep1().then((s) => console.log(JSON.stringify(s, null, 2))).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
