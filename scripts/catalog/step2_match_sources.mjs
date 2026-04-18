import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { PATHS, MATCH_SCORES } from './lib/config.mjs';
import { readJsonl, readHeaderlessCsv, appendJsonl, computeChecksum } from './lib/io.mjs';
import { normalizeToNull } from './lib/normalize.mjs';
import { searchPlant, searchPlantByCommonName, getCacheStats, updateManifest } from './lib/permapeople.mjs';
import { readProgress, writeProgress, verifyChecksum, resetProgress } from './lib/progress.mjs';

function cleanToken(value) {
  const v = normalizeToNull(value);
  if (!v) return null;
  return v
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[×x]\s+/g, ' ')
    .replace(/[‘''"`]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .toLowerCase()
    .replace(/\b(var\.?|subsp\.?|ssp\.?|f\.?|forma|cv\.?|cultivar|group|agg\.?|cf\.?|aff\.?)\b/g, ' ')
    .replace(/\b[a-z]\./g, ' ')
    .replace(/\b[a-z]{1,2}\b/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normSci(name) {
  const cleaned = cleanToken(name);
  if (!cleaned) return null;
  const tokens = cleaned.split(' ').filter(Boolean);
  if (tokens.length < 2) return tokens[0] || null;
  return tokens.slice(0, 2).join(' ');
}

function normCommon(name) {
  const cleaned = cleanToken(name);
  if (!cleaned) return null;
  return cleaned
    .replace(/\b(tree|plant|common|wild|garden)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || null;
}

function editDistance(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;

  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }

  return dp[a.length][b.length];
}

function fuzzyPick(query, candidates, {
  threshold = 0.92,
  maxLengthDelta = 4,
  minQueryLength = 5,
  maxCandidatesToScore = 200,
} = {}) {
  if (!query || candidates.length === 0) return null;
  if (query.length < minQueryLength) return null;

  let best = null;
  let secondBest = null;
  let scoredCandidates = 0;

  for (const candidate of candidates.slice(0, maxCandidatesToScore)) {
    const lenDelta = Math.abs((candidate.normalized || '').length - query.length);
    if (lenDelta > maxLengthDelta) continue;

    const distance = editDistance(query, candidate.normalized);
    const maxDistance = Math.max(1, Math.floor(query.length * (1 - threshold)));
    if (distance > maxDistance) continue;

    const score = 1 - (distance / Math.max(query.length, candidate.normalized.length, 1));
    scoredCandidates += 1;
    if (!best || score > best.score) {
      secondBest = best;
      best = { ...candidate, score };
    } else if (!secondBest || score > secondBest.score) {
      secondBest = { ...candidate, score };
    }
  }

  if (!best || best.score < threshold) return null;

  if (secondBest && Math.abs(best.score - secondBest.score) < 0.03) {
    return {
      ambiguous: true,
      candidates: [best.canonical_id, secondBest.canonical_id],
      score: best.score,
      diagnostics: { query, threshold, scoredCandidates },
    };
  }

  return {
    ambiguous: false,
    canonical_id: best.canonical_id,
    score: best.score,
    diagnostics: { query, threshold, scoredCandidates },
  };
}

function stableSlug(value) {
  const cleaned = cleanToken(value);
  return cleaned ? cleaned.replace(/\s+/g, '-') : 'unknown';
}

function buildOpenFarmSourceId(row, index) {
  const sci = stableSlug(row.scientific_name);
  const common = stableSlug(row.common_name);
  return `openfarm:${sci}:${common}:${index}`;
}

/**
 * Strip cultivar designations from a scientific name.
 * Removes: cv. XXX, 'QuotedVariety', "QuotedVariety", var. XXX patterns,
 * then returns the cleaned binomial (first two tokens).
 */
function stripCultivar(name) {
  const v = normalizeToNull(name);
  if (!v) return null;
  const stripped = v
    .replace(/\bcv\.?\s*\S+/gi, ' ')
    .replace(/[''\u2018\u2019][^''\u2018\u2019]+[''\u2018\u2019]/g, ' ')
    .replace(/[""\u201C\u201D][^""\u201C\u201D]+[""\u201C\u201D]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normSci(stripped);
}

/**
 * Extract parenthetical content from a name string.
 * E.g. "Envy (apple)" → "apple"
 */
function extractParenthetical(name) {
  const v = normalizeToNull(name);
  if (!v) return null;
  const match = v.match(/\(([^)]+)\)/);
  if (!match) return null;
  return normCommon(match[1]);
}

export function buildIndexes(canonicalRows) {
  const exact = new Map();
  const normalized = new Map();
  const synonym = new Map();
  const common = new Map();
  const genus = new Map();
  const fuzzyScientific = [];
  const fuzzyCommon = [];

  for (const c of canonicalRows) {
    if (c.accepted_scientific_name) exact.set(c.accepted_scientific_name, c.canonical_id);
    if (c.scientific_name_normalized) {
      normalized.set(c.scientific_name_normalized, c.canonical_id);
      fuzzyScientific.push({ normalized: c.scientific_name_normalized, canonical_id: c.canonical_id });

      // Build genus index from first token of normalized scientific name
      const genusToken = c.scientific_name_normalized.split(' ')[0];
      if (genusToken) {
        if (!genus.has(genusToken)) genus.set(genusToken, []);
        genus.get(genusToken).push(c.canonical_id);
      }
    }
    for (const s of c.synonyms || []) {
      const k = normSci(s);
      if (k) {
        synonym.set(k, c.canonical_id);
        fuzzyScientific.push({ normalized: k, canonical_id: c.canonical_id });
      }
    }
    for (const n of c.common_names || []) {
      const k = normCommon(n);
      if (!k) continue;
      if (!common.has(k)) common.set(k, []);
      common.get(k).push(c.canonical_id);
      fuzzyCommon.push({ normalized: k, canonical_id: c.canonical_id });
    }
  }
  return { exact, normalized, synonym, common, genus, fuzzyScientific, fuzzyCommon };
}

export function matchRecord(record, indexes) {
  const scientificName = normalizeToNull(record.scientific_name);
  const commonName = normalizeToNull(record.common_name);
  const normalizedName = normSci(scientificName);
  const normalizedCommon = normCommon(commonName);
  const diagnostics = {
    scientific_name_input: scientificName,
    common_name_input: commonName,
    normalized_scientific: normalizedName,
    normalized_common: normalizedCommon,
  };

  if (scientificName && indexes.exact.has(scientificName)) {
    return { canonical_id: indexes.exact.get(scientificName), match_type: 'exact_scientific', match_score: MATCH_SCORES.exact_scientific, diagnostics };
  }
  if (normalizedName && indexes.normalized.has(normalizedName)) {
    return { canonical_id: indexes.normalized.get(normalizedName), match_type: 'normalized_scientific', match_score: MATCH_SCORES.normalized_scientific, diagnostics };
  }
  if (normalizedName && indexes.synonym.has(normalizedName)) {
    return { canonical_id: indexes.synonym.get(normalizedName), match_type: 'synonym_match', match_score: MATCH_SCORES.synonym_match, diagnostics };
  }

  // Cultivar stripping: strip cultivar designations and retry normalized lookup
  const strippedName = stripCultivar(scientificName);
  if (strippedName && strippedName !== normalizedName && indexes.normalized.has(strippedName)) {
    return { canonical_id: indexes.normalized.get(strippedName), match_type: 'cultivar_stripped', match_score: MATCH_SCORES.cultivar_stripped, diagnostics };
  }

  // Parenthetical common name extraction: extract parenthetical content and attempt common_name lookup
  const parentheticalCommon = extractParenthetical(scientificName);
  if (parentheticalCommon) {
    const pCandidates = indexes.common.get(parentheticalCommon) || [];
    if (pCandidates.length === 1) {
      return { canonical_id: pCandidates[0], match_type: 'parenthetical_common', match_score: MATCH_SCORES.parenthetical_common, diagnostics };
    }
  }

  if (normalizedCommon) {
    const candidates = indexes.common.get(normalizedCommon) || [];
    if (candidates.length === 1) {
      return { canonical_id: candidates[0], match_type: 'common_name_fallback', match_score: MATCH_SCORES.common_name_fallback, diagnostics };
    }
    if (candidates.length > 1) {
      return { canonical_id: null, match_type: 'ambiguous_common_name', match_score: MATCH_SCORES.ambiguous_common_name, ambiguous_candidates: candidates, diagnostics };
    }
  }

  // Genus-level match: extract first token (genus) and look up in genus index
  if (normalizedName && indexes.genus) {
    const genusToken = normalizedName.split(' ')[0];
    if (genusToken) {
      const genusCandidates = indexes.genus.get(genusToken) || [];
      if (genusCandidates.length === 1) {
        return { canonical_id: genusCandidates[0], match_type: 'genus_match', match_score: MATCH_SCORES.genus_match, diagnostics };
      }
      if (genusCandidates.length > 1) {
        return { canonical_id: null, match_type: 'ambiguous_common_name', match_score: MATCH_SCORES.ambiguous_common_name, ambiguous_candidates: genusCandidates, diagnostics };
      }
    }
  }

  const fuzzyScientific = fuzzyPick(normalizedName, indexes.fuzzyScientific || [], { threshold: 0.92, maxLengthDelta: 4, minQueryLength: 8, maxCandidatesToScore: 250 });
  if (fuzzyScientific) {
    if (fuzzyScientific.ambiguous) {
      return {
        canonical_id: null,
        match_type: 'ambiguous_common_name',
        match_score: MATCH_SCORES.ambiguous_common_name,
        ambiguous_candidates: fuzzyScientific.candidates,
        diagnostics: { ...diagnostics, fuzzy: { type: 'scientific', ...fuzzyScientific.diagnostics, score: fuzzyScientific.score } },
      };
    }
    return {
      canonical_id: fuzzyScientific.canonical_id,
      match_type: 'fuzzy_fallback',
      match_score: MATCH_SCORES.fuzzy_fallback,
      needs_review: true,
      diagnostics: { ...diagnostics, fuzzy: { type: 'scientific', ...fuzzyScientific.diagnostics, score: fuzzyScientific.score } },
    };
  }

  const fuzzyCommon = fuzzyPick(normalizedCommon, indexes.fuzzyCommon || [], { threshold: 0.82, maxLengthDelta: 3, minQueryLength: 6, maxCandidatesToScore: 250 });
  if (fuzzyCommon) {
    if (fuzzyCommon.ambiguous) {
      return {
        canonical_id: null,
        match_type: 'ambiguous_common_name',
        match_score: MATCH_SCORES.ambiguous_common_name,
        ambiguous_candidates: fuzzyCommon.candidates,
        diagnostics: { ...diagnostics, fuzzy: { type: 'common', ...fuzzyCommon.diagnostics, score: fuzzyCommon.score } },
      };
    }
    return {
      canonical_id: fuzzyCommon.canonical_id,
      match_type: 'fuzzy_fallback',
      match_score: MATCH_SCORES.fuzzy_fallback,
      needs_review: true,
      diagnostics: { ...diagnostics, fuzzy: { type: 'common', ...fuzzyCommon.diagnostics, score: fuzzyCommon.score } },
    };
  }

  return { canonical_id: null, match_type: 'unresolved', match_score: MATCH_SCORES.unresolved, diagnostics };
}

export async function runStep2({ reset = false, dryRun = false, limit = null } = {}) {
  if (!fs.existsSync(PATHS.step1)) throw new Error(`Missing required input from Step 1: ${PATHS.step1}`);
  if (!fs.existsSync(PATHS.openfarmCrops)) throw new Error(`Missing OpenFarm dataset: ${PATHS.openfarmCrops}`);

  if (reset) await resetProgress(2);
  const checksum = await computeChecksum(PATHS.step1);
  await verifyChecksum(2, checksum);
  const progress = await readProgress(2);
  const startIndex = progress ? progress.lastProcessedIndex + 1 : 0;

  const canonicalRows = [];
  for await (const r of readJsonl(PATHS.step1)) canonicalRows.push(r);
  const indexes = buildIndexes(canonicalRows);
  const canonicalById = new Map(canonicalRows.map((c) => [c.canonical_id, c]));

  const openfarm = await readHeaderlessCsv(PATHS.openfarmCrops, ['scientific_name', 'common_name']);
  const fetchLimit = Number.isFinite(limit) && limit > 0 ? limit : null;
  const openfarmSlice = fetchLimit ? openfarm.slice(0, fetchLimit) : openfarm;

  // Extract only the fields normalizeProviderPayload needs — drop everything else to save memory
  function slimHit(hit) {
    return {
      id: hit.id,
      scientific_name: hit.scientific_name ?? null,
      name: hit.name ?? null,
      description: hit.description ?? null,
      Family: hit.Family ?? hit.family ?? null,
      'Light requirement': hit['Light requirement'] ?? null,
      'Water requirement': hit['Water requirement'] ?? null,
      Edible: hit.Edible ?? hit.edible ?? null,
      'Edible parts': hit['Edible parts'] ?? null,
      'Life cycle': hit['Life cycle'] ?? null,
      'USDA Hardiness zone': hit['USDA Hardiness zone'] ?? null,
      Layer: hit.Layer ?? null,
      Growth: hit.Growth ?? null,
      Warning: hit.Warning ?? hit.warning ?? null,
      Utility: hit.Utility ?? hit.utility ?? null,
      'Plants For A Future': hit['Plants For A Future'] ?? null,
      'Plants of the World Online': hit['Plants of the World Online'] ?? null,
      Wikipedia: hit.Wikipedia ?? null,
      companions: hit.companions ?? null,
      antagonists: hit.antagonists ?? null,
      common_name: hit.common_name ?? null,
      category: hit.category ?? null,
      life_cycle: hit.life_cycle ?? null,
    };
  }

  function matchAndFormat(r) {
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
      ...(m.needs_review ? { needs_review: true } : {}),
      ...(m.diagnostics ? { match_diagnostics: m.diagnostics } : {}),
    };
  }

  if (!dryRun) await fsp.mkdir('data/catalog', { recursive: true });

  let totalWritten = 0;
  let absoluteIndex = 0;
  const BATCH_SIZE = 500;
  let batch = [];
  const matchedCanonicalIds = new Set();
  const unmatchedCommonNames = [];

  async function flushBatch() {
    if (batch.length === 0) return;
    if (!dryRun) await appendJsonl(PATHS.step2, batch);
    totalWritten += batch.length;
    batch = [];
  }

  async function enqueueMatchedRecord(record, matched = null) {
    const resolved = matched ?? matchAndFormat(record);

    if (record.source_provider === 'openfarm' && resolved.canonical_id) {
      matchedCanonicalIds.add(resolved.canonical_id);
    }
    if (record.source_provider === 'openfarm' && !resolved.canonical_id && record.common_name) {
      const key = normCommon(record.common_name);
      if (key) unmatchedCommonNames.push({ common_name: record.common_name, key });
    }

    if (absoluteIndex < startIndex) {
      absoluteIndex += 1;
      return;
    }

    batch.push(resolved);
    absoluteIndex += 1;
    if (batch.length >= BATCH_SIZE) await flushBatch();
  }

  // 1. Match and write OpenFarm records
  for (const [i, r] of openfarmSlice.entries()) {
    const rec = {
      source_provider: 'openfarm',
      source_record_id: buildOpenFarmSourceId(r, i),
      scientific_name: r.scientific_name ?? null,
      common_name: r.common_name ?? null,
      raw_payload: r,
    };
    await enqueueMatchedRecord(rec);
  }
  await flushBatch();
  process.stderr.write(`  OpenFarm: ${totalWritten} records written\n`);

  // 2. Query Permapeople for each unique matched canonical, stream hits to disk
  const queriedCanonicals = new Set();
  let ppHitCount = 0;
  let queryCount = 0;

  for (const cid of matchedCanonicalIds) {
    if (queriedCanonicals.has(cid)) continue;
    queriedCanonicals.add(cid);
    queryCount += 1;
    const canonical = canonicalById.get(cid);
    const sci = canonical?.scientific_name_normalized || canonical?.accepted_scientific_name;
    if (!sci) continue;

    process.stderr.write(`\r  Permapeople: ${queryCount}/${matchedCanonicalIds.size} queries (${ppHitCount} hits) — ${sci.slice(0, 40)}   `);
    const ppA = await searchPlant(sci);
    let hits = Array.isArray(ppA?.hits) ? ppA.hits : [];
    if (hits.length === 0 && canonical?.common_names?.[0]) {
      const ppB = await searchPlantByCommonName(canonical.common_names[0]);
      hits = Array.isArray(ppB?.hits) ? ppB.hits : [];
    }
    for (const hit of hits) {
      const slim = slimHit(hit);
      await enqueueMatchedRecord({
        source_provider: 'permapeople',
        source_record_id: String(slim.id ?? `${sci}:${Math.random().toString(16).slice(2, 8)}`),
        scientific_name: slim.scientific_name,
        common_name: slim.name,
        raw_payload: slim,
      });
      ppHitCount += 1;
    }
  }

  // Unmatched common name queries
  const queriedCommonKeys = new Set();
  for (const { common_name, key } of unmatchedCommonNames) {
    if (queriedCommonKeys.has(key)) continue;
    queriedCommonKeys.add(key);
    process.stderr.write(`\r  Permapeople: ${queryCount} canonical + ${queriedCommonKeys.size} common (${ppHitCount} hits) — ${common_name.slice(0, 40)}   `);
    const ppC = await searchPlantByCommonName(common_name);
    const hits = Array.isArray(ppC?.hits) ? ppC.hits : [];
    for (const hit of hits) {
      const slim = slimHit(hit);
      await enqueueMatchedRecord({
        source_provider: 'permapeople',
        source_record_id: String(slim.id ?? `common:${common_name}:${Math.random().toString(16).slice(2, 8)}`),
        scientific_name: slim.scientific_name,
        common_name: slim.name,
        raw_payload: slim,
      });
      ppHitCount += 1;
    }
  }
  await flushBatch();
  process.stderr.write(`\r  Permapeople: ${queriedCanonicals.size} queries done, ${ppHitCount} hits total                    \n`);

  if (!dryRun && totalWritten > 0) {
    await writeProgress(2, startIndex + totalWritten - 1, checksum);
    await updateManifest();
  }

  const stats = getCacheStats();
  return { processedThisRun: totalWritten, cacheHits: stats.hits, cacheMisses: stats.misses };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runStep2().then((s) => console.log(JSON.stringify(s, null, 2))).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
