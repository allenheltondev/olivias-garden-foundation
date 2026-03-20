import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { PATHS, MATCH_SCORES } from './lib/config.mjs';
import { readJsonl, readHeaderlessCsv, appendJsonl, computeChecksum } from './lib/io.mjs';
import { normalizeToNull } from './lib/normalize.mjs';
import { searchPlant, searchPlantByCommonName, getCacheStats, updateManifest } from './lib/permapeople.mjs';
import { readProgress, writeProgress, verifyChecksum, resetProgress } from './lib/progress.mjs';

function normSci(name) {
  const v = normalizeToNull(name);
  if (!v) return null;
  return v.toLowerCase().split(/\s+/).slice(0, 2).join(' ');
}

function buildIndexes(canonicalRows) {
  const exact = new Map();
  const normalized = new Map();
  const synonym = new Map();
  const common = new Map();
  for (const c of canonicalRows) {
    exact.set(c.accepted_scientific_name, c.canonical_id);
    normalized.set(c.scientific_name_normalized, c.canonical_id);
    for (const s of c.synonyms || []) synonym.set(normSci(s), c.canonical_id);
    for (const n of c.common_names || []) {
      const k = String(n).trim().toLowerCase();
      if (!common.has(k)) common.set(k, []);
      common.get(k).push(c.canonical_id);
    }
  }
  return { exact, normalized, synonym, common };
}

export function matchRecord(record, indexes) {
  const scientificName = normalizeToNull(record.scientific_name);
  const commonName = normalizeToNull(record.common_name);
  const normalizedName = normSci(scientificName);

  if (scientificName && indexes.exact.has(scientificName)) {
    return { canonical_id: indexes.exact.get(scientificName), match_type: 'exact_scientific', match_score: MATCH_SCORES.exact_scientific };
  }
  if (normalizedName && indexes.normalized.has(normalizedName)) {
    return { canonical_id: indexes.normalized.get(normalizedName), match_type: 'normalized_scientific', match_score: MATCH_SCORES.normalized_scientific };
  }
  if (normalizedName && indexes.synonym.has(normalizedName)) {
    return { canonical_id: indexes.synonym.get(normalizedName), match_type: 'synonym_match', match_score: MATCH_SCORES.synonym_match };
  }
  if (commonName) {
    const k = commonName.toLowerCase();
    const candidates = indexes.common.get(k) || [];
    if (candidates.length === 1) {
      return { canonical_id: candidates[0], match_type: 'common_name_fallback', match_score: MATCH_SCORES.common_name_fallback };
    }
    if (candidates.length > 1) {
      return { canonical_id: null, match_type: 'ambiguous_common_name', match_score: MATCH_SCORES.ambiguous_common_name, ambiguous_candidates: candidates };
    }
  }
  return { canonical_id: null, match_type: 'unresolved', match_score: MATCH_SCORES.unresolved };
}

export async function runStep2({ reset = false, dryRun = false, limit = null } = {}) {
  if (!fs.existsSync(PATHS.step1)) throw new Error(`Missing required input from Step 1: ${PATHS.step1}`);
  if (!fs.existsSync(PATHS.openfarmCrops)) throw new Error(`Missing OpenFarm dataset: ${PATHS.openfarmCrops}`);

  if (reset) await resetProgress(2);
  const checksum = await computeChecksum(PATHS.step1);
  await verifyChecksum(2, checksum);

  const canonicalRows = [];
  for await (const r of readJsonl(PATHS.step1)) canonicalRows.push(r);
  const indexes = buildIndexes(canonicalRows);

  const openfarm = await readHeaderlessCsv(PATHS.openfarmCrops, ['scientific_name', 'common_name']);
  const allRecords = [];

  const fetchLimit = Number.isFinite(limit) && limit > 0 ? limit : null;
  const canonicalForFetch = fetchLimit ? canonicalRows.slice(0, fetchLimit) : canonicalRows;
  const openfarmForFetch = fetchLimit ? openfarm.slice(0, fetchLimit) : openfarm;

  // OpenFarm-first ordering to ensure practical grower context exists in limited smoke runs.
  openfarmForFetch.forEach((r, i) => {
    allRecords.push({
      source_provider: 'openfarm',
      source_record_id: `openfarm:${i}`,
      scientific_name: r.scientific_name ?? null,
      common_name: r.common_name ?? null,
      raw_payload: r,
    });
  });

  for (const c of canonicalForFetch) {
    const sci = c.scientific_name_normalized || c.accepted_scientific_name;
    const ppA = await searchPlant(sci);
    let hits = Array.isArray(ppA?.hits) ? ppA.hits : [];
    if (hits.length === 0 && c.common_names?.[0]) {
      const ppB = await searchPlantByCommonName(c.common_names[0]);
      hits = Array.isArray(ppB?.hits) ? ppB.hits : [];
    }

    for (const hit of hits) {
      allRecords.push({
        source_provider: 'permapeople',
        source_record_id: String(hit.id ?? `${sci}:${Math.random().toString(16).slice(2, 8)}`),
        scientific_name: hit.scientific_name ?? null,
        common_name: hit.name ?? null,
        raw_payload: hit,
      });
    }
  }

  let selected = allRecords;
  if (fetchLimit) {
    const openfarmRecords = allRecords.filter((r) => r.source_provider === 'openfarm');
    const otherRecords = allRecords.filter((r) => r.source_provider !== 'openfarm');
    const openfarmQuota = Math.min(openfarmRecords.length, Math.ceil(fetchLimit / 2));
    const otherQuota = Math.min(otherRecords.length, fetchLimit - openfarmQuota);
    selected = [
      ...openfarmRecords.slice(0, openfarmQuota),
      ...otherRecords.slice(0, otherQuota),
    ];
  }

  const progress = await readProgress(2);
  const startIndex = progress ? progress.lastProcessedIndex + 1 : 0;
  const slice = selected.slice(startIndex, fetchLimit ? startIndex + fetchLimit : undefined);

  const out = slice.map((r) => {
    const m = matchRecord(r, indexes);
    return {
      source_provider: r.source_provider,
      source_record_id: r.source_record_id,
      source_scientific_name: r.scientific_name ?? null,
      source_common_name: r.common_name ?? null,
      raw_payload: r.raw_payload ?? null,
      canonical_id: m.canonical_id,
      match_type: m.match_type,
      match_score: m.match_score,
      matched_at: new Date().toISOString(),
      ...(m.ambiguous_candidates ? { ambiguous_candidates: m.ambiguous_candidates } : {}),
    };
  });

  if (!dryRun) {
    await fsp.mkdir('data/catalog', { recursive: true });
    await appendJsonl(PATHS.step2, out);
    if (out.length > 0) await writeProgress(2, startIndex + out.length - 1, checksum);
    await updateManifest();
  }

  const stats = getCacheStats();
  return { processedThisRun: out.length, cacheHits: stats.hits, cacheMisses: stats.misses };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runStep2().then((s) => console.log(JSON.stringify(s, null, 2))).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
