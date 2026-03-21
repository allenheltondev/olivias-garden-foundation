import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { PATHS } from './lib/config.mjs';
import { readJsonl, appendJsonl, computeChecksum } from './lib/io.mjs';
import { readProgress, writeProgress, verifyChecksum, resetProgress } from './lib/progress.mjs';

const FOOD_TERMS = /edible|food|culinary|fruit|vegetable|grain|herb|spice|nut|bean|seed|leaf|root|tuber/;
const INDUSTRIAL_TERMS = /fiber|fibre|textile|timber|lumber|biofuel|fuel|rubber|resin|pulp|paper|dye|ornamental wood|industrial/;
const WEED_TERMS = /weed|invasive|noxious/;
const CONIFER_TERMS = /\b(pinus|pine|spruce|picea|fir|abies|cedar|cedrus|cypress|cupress|juniper|juniperus|taxus|sequoia|redwood|hemlock|larch|taxodium)\b/;

function keyFor(rec) {
  return rec.canonical_id || `${rec.source_provider}:${rec.source_record_id}`;
}

function finiteScore(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function computeConfidenceBand(records, hasOpenFarmSupport) {
  const scored = records
    .map((r) => ({ ...r, score: finiteScore(r.match_score) }))
    .filter((r) => r.score !== null);

  const bestScore = scored.length > 0 ? Math.max(...scored.map((r) => r.score)) : 0;
  const openFarmScored = scored.filter((r) => r.source_provider === 'openfarm' && r.match_type !== 'unresolved');
  const openFarmBest = openFarmScored.length > 0 ? Math.max(...openFarmScored.map((r) => r.score)) : 0;

  const hasHighPrecisionOpenFarm = openFarmScored.some((r) =>
    (r.match_type === 'normalized_scientific' || r.match_type === 'synonym_match') && r.score >= 0.85);

  const hasMediumOpenFarm = openFarmScored.some((r) =>
    (r.match_type === 'common_name_fallback' || r.match_type === 'fuzzy_fallback') && r.score >= 0.7);

  if (hasOpenFarmSupport && (hasHighPrecisionOpenFarm || openFarmBest >= 0.9)) return { source_confidence: openFarmBest || bestScore, match_confidence_band: 'high' };
  if (hasOpenFarmSupport && (hasMediumOpenFarm || openFarmBest >= 0.7)) return { source_confidence: openFarmBest || bestScore, match_confidence_band: 'medium' };
  if (bestScore >= 0.85) return { source_confidence: bestScore, match_confidence_band: 'medium' };
  return { source_confidence: bestScore, match_confidence_band: 'low' };
}

export function classifyCanonical(records) {
  const providers = new Set(records.map((r) => r.source_provider).filter(Boolean));

  const hasOpenFarmSupport = records.some((r) => r.source_provider === 'openfarm' && r.match_type !== 'unresolved');

  const edibleProviders = new Set();
  const foodUtilityProviders = new Set();
  let warningText = '';
  let utilityText = '';
  let nameText = '';

  for (const rec of records) {
    const normalized = rec.normalized || {};
    const isEdible = normalized.edible === true || (Array.isArray(normalized.edible_parts) && normalized.edible_parts.length > 0);
    if (isEdible && rec.source_provider) edibleProviders.add(rec.source_provider);

    const util = Array.isArray(normalized.utility) ? normalized.utility.join(' ') : '';
    const isFoodUtility = FOOD_TERMS.test(util.toLowerCase());
    if (isFoodUtility && rec.source_provider) foodUtilityProviders.add(rec.source_provider);

    warningText += ` ${Array.isArray(normalized.warnings) ? normalized.warnings.join(' ') : ''}`;
    utilityText += ` ${util}`;
    nameText += ` ${normalized.scientific_name || ''} ${(normalized.common_names || []).join(' ')}`;
  }

  const lowerWarning = warningText.toLowerCase();
  const lowerUtility = utilityText.toLowerCase();
  const lowerName = nameText.toLowerCase();

  const edibleEvidenceSources = new Set([...edibleProviders, ...foodUtilityProviders]);
  const strongFoodEvidence = edibleEvidenceSources.size >= 2 || (edibleProviders.size >= 1 && foodUtilityProviders.size >= 1);

  const coniferGuardrail = CONIFER_TERMS.test(lowerName) && !strongFoodEvidence;
  const industrialGuardrail = INDUSTRIAL_TERMS.test(lowerUtility) && !strongFoodEvidence;

  let relevance_class = 'non_food';
  if (WEED_TERMS.test(lowerWarning) && !strongFoodEvidence) relevance_class = 'weed_or_invasive';
  else if (coniferGuardrail || industrialGuardrail) relevance_class = 'non_food';
  else if (hasOpenFarmSupport && (edibleEvidenceSources.size > 0 || FOOD_TERMS.test(lowerUtility))) relevance_class = 'food_crop_core';
  else if (!hasOpenFarmSupport && strongFoodEvidence) relevance_class = 'food_crop_niche';
  else if (INDUSTRIAL_TERMS.test(lowerUtility)) relevance_class = 'industrial_crop';

  const catalog_status = relevance_class === 'food_crop_core'
    ? 'core'
    : (relevance_class === 'food_crop_niche' || relevance_class === 'edible_ornamental')
      ? 'extended'
      : relevance_class === 'medicinal_only'
        ? 'hidden'
        : 'excluded';

  const { source_confidence, match_confidence_band } = computeConfidenceBand(records, hasOpenFarmSupport);
  const source_agreement_score = providers.size > 0 ? edibleEvidenceSources.size / providers.size : 0;

  const hasFuzzyFallback = records.some((r) => r.match_type === 'fuzzy_fallback' || r.needs_review === true);

  const review_status =
    catalog_status === 'excluded'
      ? 'rejected'
      : (hasFuzzyFallback
        ? 'needs_review'
        : (!hasOpenFarmSupport
          ? 'needs_review'
          : (match_confidence_band !== 'low' && source_agreement_score >= 0.34
            ? 'auto_approved'
            : 'needs_review')));

  const lead = records[0] || {};

  return {
    canonical_id: keyFor(lead),
    relevance_class,
    catalog_status,
    edibility_status: edibleProviders.size > 0 ? 'food_crop' : 'unknown',
    review_status,
    source_confidence,
    match_confidence_band,
    source_agreement_score,
    has_openfarm_support: hasOpenFarmSupport,
    strong_food_evidence: strongFoodEvidence,
    edible_evidence_sources: Array.from(edibleEvidenceSources),
    guardrail_flags: {
      conifer: coniferGuardrail,
      industrial: industrialGuardrail,
    },
    classification_reason: `Merged canonical classification (${relevance_class}; openfarm=${hasOpenFarmSupport}; strongFoodEvidence=${strongFoodEvidence})`,
    source_records: records.map((r) => ({
      source_provider: r.source_provider,
      source_record_id: r.source_record_id,
      match_type: r.match_type,
      match_score: r.match_score,
      normalized: r.normalized,
    })),
  };
}

export async function runStep4({ reset = false, dryRun = false, limit = null } = {}) {
  if (!fs.existsSync(PATHS.step3)) throw new Error(`Missing required input from Step 3: ${PATHS.step3}`);
  if (reset) await resetProgress(4);

  const checksum = await computeChecksum(PATHS.step3);
  await verifyChecksum(4, checksum);

  const input = [];
  for await (const r of readJsonl(PATHS.step3)) input.push(r);

  const grouped = new Map();
  for (const rec of input) {
    const key = keyFor(rec);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(rec);
  }

  const canonicals = Array.from(grouped.values());
  const progress = await readProgress(4);
  const startIndex = progress ? progress.lastProcessedIndex + 1 : 0;
  const slice = canonicals.slice(startIndex, limit ? startIndex + limit : undefined);

  const out = slice.map(classifyCanonical);

  if (!dryRun) {
    await fsp.mkdir('data/catalog', { recursive: true });
    await appendJsonl(PATHS.step4, out);
    if (out.length > 0) await writeProgress(4, startIndex + out.length - 1, checksum);
  }

  return { processedThisRun: out.length };
}
