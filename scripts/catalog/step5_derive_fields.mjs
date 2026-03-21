import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { PATHS } from './lib/config.mjs';
import { readJsonl, appendJsonl, computeChecksum } from './lib/io.mjs';
import { readProgress, writeProgress, verifyChecksum, resetProgress } from './lib/progress.mjs';

const pick = (arr, ...fns) => {
  for (const fn of fns) {
    for (const rec of arr) {
      const v = fn(rec);
      if (v !== null && v !== undefined && v !== '') return { value: v, rec };
    }
  }
  return { value: null, rec: null };
};

const pickFromArrays = (arrays, ...fns) => {
  for (const arr of arrays) {
    const found = pick(arr, ...fns);
    if (found.value !== null && found.value !== undefined && found.value !== '') return found;
  }
  return { value: null, rec: null };
};

const firstArray = (...vals) => vals.find((v) => Array.isArray(v) && v.length > 0) || [];

function computeOpenFarmSupport(records) {
  return records.some((r) => r.source_provider === 'openfarm' && r.match_type !== 'unresolved');
}

function computeStrongFoodEvidence(records) {
  const providers = new Set();
  for (const rec of records) {
    const n = rec.normalized || {};
    const edible = n.edible === true || (Array.isArray(n.edible_parts) && n.edible_parts.length > 0);
    const utility = Array.isArray(n.utility) ? n.utility.join(' ').toLowerCase() : '';
    const foodUtility = /edible|food|culinary|fruit|vegetable|grain|herb|spice|nut|bean|seed|leaf|root|tuber/.test(utility);
    if ((edible || foodUtility) && rec.source_provider) providers.add(rec.source_provider);
  }
  return providers.size >= 2;
}

export function deriveCanonicalRecord(records, classificationMeta = null) {
  const byProvider = (p) => records.filter((r) => r.source_provider === p);
  const usda = byProvider('usda');
  const openfarm = byProvider('openfarm');
  const permapeople = byProvider('permapeople');

  const scientific = pickFromArrays(
    [usda, permapeople, openfarm],
    (r) => r.normalized?.scientific_name,
  );
  const family = pickFromArrays(
    [usda, permapeople],
    (r) => r.normalized?.family,
  );
  const commonOpenfarm = pick(openfarm, (r) => r.normalized?.common_names?.[0]);
  const commonPermapeople = pick(permapeople, (r) => r.normalized?.common_names?.[0]);
  const commonUsda = pick(usda, (r) => r.normalized?.common_names?.[0]);
  const scientificFallbackCommon = scientific.value
    ? { value: String(scientific.value).split(' ').slice(0, 2).join(' '), rec: scientific.rec }
    : { value: null, rec: null };
  const common = commonOpenfarm.value
    ? commonOpenfarm
    : (commonPermapeople.value
      ? commonPermapeople
      : (commonUsda.value ? commonUsda : scientificFallbackCommon));

  const commonFromPermapeople = commonPermapeople.value;
  const commonFromOpenfarm = commonOpenfarm.value;
  const commonNameMismatch = Boolean(commonFromOpenfarm && commonFromPermapeople
    && commonFromOpenfarm.toLowerCase() !== commonFromPermapeople.toLowerCase());

  const practicalSource = pickFromArrays([permapeople, openfarm], (r) => r.normalized);
  const practical = practicalSource.value || {};

  const lifeCycle = practical.life_cycle || null;
  const hardiness = firstArray(practical.hardiness_zones, ...usda.map((r) => r.normalized?.hardiness_zones));
  const useHardiness = lifeCycle && !/annual/.test(String(lifeCycle).toLowerCase()) && hardiness.length > 0;

  const lead = records[0] || {};
  const meta = classificationMeta || lead;
  const field_sources = {};
  if (scientific.value) field_sources.scientific_name = scientific.rec?.source_provider;
  if (family.value) field_sources.family = family.rec?.source_provider;
  if (common.value) field_sources.common_name = common.rec?.source_provider;
  if (practical.edible !== undefined && practical.edible !== null) field_sources.edible = practicalSource.rec?.source_provider;
  if (practical.edible_parts?.length) field_sources.edible_parts = practicalSource.rec?.source_provider;
  if (useHardiness) field_sources.hardiness_zones = practicalSource.rec?.source_provider || 'usda';

  const hasOpenFarmSupport = meta.has_openfarm_support ?? computeOpenFarmSupport(records);
  const strongFoodEvidence = meta.strong_food_evidence ?? computeStrongFoodEvidence(records);

  return {
    canonical_id: meta.canonical_id || lead.canonical_id,
    catalog_status: meta.catalog_status,
    review_status: meta.review_status,
    relevance_class: meta.relevance_class,
    source_confidence: meta.source_confidence,
    match_confidence_band: meta.match_confidence_band || 'low',
    source_agreement_score: meta.source_agreement_score,
    scientific_name: scientific.value,
    family: family.value,
    common_name: common.value,
    edible: practical.edible ?? null,
    edible_parts: practical.edible_parts || [],
    water_requirement: practical.water_requirement || null,
    light_requirements: practical.light_requirements || [],
    life_cycle: lifeCycle,
    hardiness_zones: useHardiness ? hardiness : [],
    common_name_mismatch: commonNameMismatch,
    excluded_reason: meta.catalog_status === 'excluded' ? meta.classification_reason : null,
    has_openfarm_support: hasOpenFarmSupport,
    strong_food_evidence: strongFoodEvidence,
    edible_evidence_sources: meta.edible_evidence_sources || [],
    guardrail_flags: meta.guardrail_flags || {},
    field_sources,
    source_records: records.map((r) => ({
      source_provider: r.source_provider,
      source_record_id: r.source_record_id,
      match_type: r.match_type,
      match_score: r.match_score,
    })),
  };
}

export async function runStep5({ reset = false, dryRun = false, limit = null } = {}) {
  if (!fs.existsSync(PATHS.step4)) throw new Error(`Missing required input from Step 4: ${PATHS.step4}`);
  if (reset) await resetProgress(5);

  const checksum = await computeChecksum(PATHS.step4);
  await verifyChecksum(5, checksum);

  const input = [];
  for await (const r of readJsonl(PATHS.step4)) input.push(r);

  const progress = await readProgress(5);
  const startIndex = progress ? progress.lastProcessedIndex + 1 : 0;
  const slice = input.slice(startIndex, limit ? startIndex + limit : undefined);

  const out = slice.map((rec) => {
    if (Array.isArray(rec.source_records) && rec.source_records.length > 0) {
      const expanded = rec.source_records.map((s) => ({
        canonical_id: rec.canonical_id,
        source_provider: s.source_provider,
        source_record_id: s.source_record_id,
        match_type: s.match_type,
        match_score: s.match_score,
        normalized: s.normalized || {},
      }));
      return deriveCanonicalRecord(expanded, rec);
    }

    const singleton = [{
      canonical_id: rec.canonical_id,
      source_provider: rec.source_provider,
      source_record_id: rec.source_record_id,
      match_type: rec.match_type,
      match_score: rec.match_score,
      normalized: rec.normalized || {},
      ...rec,
    }];
    return deriveCanonicalRecord(singleton, rec);
  });

  if (!dryRun) {
    await fsp.mkdir('data/catalog', { recursive: true });
    await appendJsonl(PATHS.step5, out);
    if (out.length > 0) await writeProgress(5, startIndex + out.length - 1, checksum);
  }

  return { processedThisRun: out.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runStep5().then((s) => console.log(JSON.stringify(s, null, 2))).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
