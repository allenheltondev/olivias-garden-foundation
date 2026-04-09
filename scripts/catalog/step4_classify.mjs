import fs from 'node:fs';
import fsp from 'node:fs/promises';
import {
  PATHS,
  EDIBLE_PART_TIERS,
  PRACTICAL_FOOD_SCORE,
  CULTIVATION_CATEGORIES,
  CULTIVATED_LIFE_CYCLES,
  INDUSTRIAL_SPECIES_PATTERNS,
} from './lib/config.mjs';
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

export function computePracticalFoodScore(records) {
  const allParts = new Set();
  let hasEdibleFlag = false;

  for (const rec of records) {
    const normalized = rec.normalized || {};
    if (normalized.edible === true) hasEdibleFlag = true;
    for (const part of (normalized.edible_parts || [])) {
      allParts.add(part.toLowerCase().trim());
    }
  }

  let score = 0;
  const strongParts = [];
  const weakParts = [];

  for (const part of allParts) {
    if (EDIBLE_PART_TIERS.strong.has(part)) {
      score += PRACTICAL_FOOD_SCORE.strongPartWeight;
      strongParts.push(part);
    } else if (EDIBLE_PART_TIERS.weak.has(part)) {
      score += PRACTICAL_FOOD_SCORE.weakPartWeight;
      weakParts.push(part);
    }
    // Unknown parts get 0 — conservative default
  }

  if (hasEdibleFlag && strongParts.length > 0) {
    score += PRACTICAL_FOOD_SCORE.edibleFlagBonus;
  }

  return { score, strongParts, weakParts, hasEdibleFlag };
}

export function computeCultivationSignal(records, hasOpenFarmSupport) {
  let signal = 0;
  if (hasOpenFarmSupport) signal += 1;

  const categories = new Set();
  const lifeCycles = new Set();
  for (const rec of records) {
    const n = rec.normalized || {};
    if (n.category) categories.add(n.category.toLowerCase().trim());
    if (n.life_cycle) lifeCycles.add(n.life_cycle.toLowerCase().trim());
  }

  const hasCultivatedCategory = [...categories].some(c => CULTIVATION_CATEGORIES.has(c));
  if (hasCultivatedCategory) signal += 1;

  const hasCultivatedLifeCycle = [...lifeCycles].some(lc => CULTIVATED_LIFE_CYCLES.has(lc));
  if (hasCultivatedLifeCycle) signal += 1;

  return signal; // 0-3 range
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

export function classifyCanonical(records, canonical = {}) {
  const providers = new Set(records.map((r) => r.source_provider).filter(Boolean));

  // Compute practical food score early (Task 4.1)
  const practicalFoodResult = computePracticalFoodScore(records);
  const hasStrongEdiblePart = practicalFoodResult.strongParts.length > 0;

  // Detect OpenFarm-originated canonical via explicit origin field or canonical_id prefix
  const lead = records[0] || {};
  const canonicalOrigin = canonical.origin || (lead.canonical_id && lead.canonical_id.startsWith('openfarm:') ? 'openfarm' : null);
  const isOpenFarmCanonical = canonicalOrigin === 'openfarm';

  // Original check: openfarm source with a resolved match
  const hasResolvedOpenFarm = records.some((r) => r.source_provider === 'openfarm' && r.match_type !== 'unresolved');

  // Enhancement: OpenFarm-originated canonicals with any openfarm source count as OpenFarm-supported
  const hasOpenFarmSource = records.some((r) => r.source_provider === 'openfarm');
  const hasOpenFarmSupport = hasResolvedOpenFarm || (isOpenFarmCanonical && hasOpenFarmSource);

  // Compute cultivation signal after OpenFarm support is determined (Task 4.1)
  const cultivationSignal = computeCultivationSignal(records, hasOpenFarmSupport);

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

  // Edible evidence: any source has edible: true or non-empty edible_parts
  const hasEdibleEvidence = edibleProviders.size > 0;

  // Apply cultivation bonus when cultivationSignal >= 2 AND hasStrongEdiblePart (Task 4.1)
  if (cultivationSignal >= 2 && hasStrongEdiblePart) {
    practicalFoodResult.score += PRACTICAL_FOOD_SCORE.cultivationBonus;
  }

  // Apply multi-provider bonus when strongFoodEvidence (Task 4.1)
  if (strongFoodEvidence) {
    practicalFoodResult.score += PRACTICAL_FOOD_SCORE.multiProviderBonus;
  }

  // Strengthened conifer guardrail (Task 4.2)
  // Override requires BOTH strongFoodEvidence AND at least one strong edible part
  const coniferGuardrail = CONIFER_TERMS.test(lowerName)
    && !(strongFoodEvidence && hasStrongEdiblePart);

  // Strengthened industrial guardrail (Task 4.3)
  // Also check name text against INDUSTRIAL_SPECIES_PATTERNS
  const industrialNameMatch = INDUSTRIAL_SPECIES_PATTERNS.some(p => p.test(lowerName));
  const industrialGuardrail = (INDUSTRIAL_TERMS.test(lowerUtility) || industrialNameMatch)
    && !(strongFoodEvidence && hasStrongEdiblePart);

  let relevance_class = 'non_food';
  if (WEED_TERMS.test(lowerWarning) && !strongFoodEvidence && !hasOpenFarmSupport) relevance_class = 'weed_or_invasive';
  else if (WEED_TERMS.test(lowerWarning) && !strongFoodEvidence && hasOpenFarmSupport && edibleEvidenceSources.size === 0) relevance_class = 'weed_or_invasive';
  else if (coniferGuardrail || industrialGuardrail) relevance_class = 'non_food';
  else if (hasOpenFarmSupport && (edibleEvidenceSources.size > 0 || FOOD_TERMS.test(lowerUtility))) {
    // Task 4.4: cultivationSignal === 0 AND no strongFoodEvidence → niche instead of core
    if (cultivationSignal === 0 && !strongFoodEvidence) {
      relevance_class = 'food_crop_niche';
    } else {
      relevance_class = 'food_crop_core';
    }
  }
  else if (hasEdibleEvidence && !hasOpenFarmSupport && !coniferGuardrail && !industrialGuardrail) relevance_class = 'food_crop_niche';
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
        : ((!hasOpenFarmSupport && !strongFoodEvidence && edibleEvidenceSources.size === 0)
          ? 'needs_review'
          : (match_confidence_band !== 'low' && source_agreement_score >= 0.34
            ? 'auto_approved'
            : 'needs_review')));

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
    practical_food_score: practicalFoodResult.score,
    practical_food_parts: { strong: practicalFoodResult.strongParts, weak: practicalFoodResult.weakParts },
    cultivation_signal: cultivationSignal,
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
