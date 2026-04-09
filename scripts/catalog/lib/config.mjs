import path from 'node:path';

export const ROOT = path.resolve(process.cwd());
export const DATA_DIR = path.join(ROOT, 'data', 'catalog');

export const PATHS = {
  usdaPlants: path.join(ROOT, 'lib', 'usda-plants.txt'),
  openfarmCrops: path.join(ROOT, 'lib', 'openfarm-crops.csv'),
  mustHaveCrops: path.join(ROOT, 'lib', 'must-have-crops.csv'),
  permapeopleCacheDir: path.join(DATA_DIR, 'permapeople', 'cache'),
  permapeopleManifest: path.join(DATA_DIR, 'permapeople', 'manifest.json'),
  step1: path.join(DATA_DIR, 'step1_canonical_identity.jsonl'),
  step2: path.join(DATA_DIR, 'step2_source_matches.jsonl'),
  step3: path.join(DATA_DIR, 'step3_normalized_sources.jsonl'),
  step4: path.join(DATA_DIR, 'step4_relevance_classified.jsonl'),
  step5: path.join(DATA_DIR, 'step5_canonical_drafts.jsonl'),
  step6: path.join(DATA_DIR, 'step6_augmented_catalog.jsonl'),
  promoted: path.join(DATA_DIR, 'promoted_crops.jsonl'),
  generatedSql: path.join(DATA_DIR, 'promoted_crops.sql'),
  reviewNeedsReview: path.join(DATA_DIR, 'review_queue_needs_review.jsonl'),
  reviewUnresolved: path.join(DATA_DIR, 'review_queue_unresolved.jsonl'),
  reviewExcluded: path.join(DATA_DIR, 'review_queue_excluded.jsonl'),
  reviewSummary: path.join(DATA_DIR, 'review_summary.json'),
};

export const PROGRESS_PATHS = {
  1: path.join(DATA_DIR, 'step1_progress.json'),
  2: path.join(DATA_DIR, 'step2_progress.json'),
  3: path.join(DATA_DIR, 'step3_progress.json'),
  4: path.join(DATA_DIR, 'step4_progress.json'),
  5: path.join(DATA_DIR, 'step5_progress.json'),
  6: path.join(DATA_DIR, 'step6_progress.json'),
  7: path.join(DATA_DIR, 'promote_progress.json'),
};

export const ENUMS = {
  matchType: ['exact_scientific', 'normalized_scientific', 'cultivar_stripped', 'synonym_match', 'common_name_fallback', 'parenthetical_common', 'genus_match', 'fuzzy_fallback', 'ambiguous_common_name', 'unresolved'],
  relevanceClass: ['food_crop_core', 'food_crop_niche', 'edible_ornamental', 'medicinal_only', 'industrial_crop', 'weed_or_invasive', 'non_food'],
};

export const MATCH_SCORES = {
  exact_scientific: 1,
  normalized_scientific: 0.95,
  cultivar_stripped: 0.90,
  synonym_match: 0.85,
  common_name_fallback: 0.7,
  parenthetical_common: 0.65,
  genus_match: 0.60,
  fuzzy_fallback: 0.55,
  ambiguous_common_name: 0.4,
  unresolved: 0,
};

export const PERMAPEOPLE = {
  endpoint: 'https://permapeople.org/indexes/Plant_production/search',
  hitsPerPage: 10,
  requestDelayMs: 500,
  retries: 3,
  backoffMs: 2000,
  rateLimitBackoffMs: 30000,
};

export const EDIBLE_PART_TIERS = {
  strong: new Set([
    'fruit', 'leaves', 'leaf', 'root', 'seed', 'tuber', 'grain',
    'shoots', 'flowers', 'seedpod', 'legume', 'bulb', 'stem', 'nut',
  ]),
  weak: new Set([
    'inner bark', 'bark', 'sap', 'resin', 'gum', 'pollen',
  ]),
};

export const PRACTICAL_FOOD_SCORE = {
  strongPartWeight: 2,
  weakPartWeight: 0.25,
  edibleFlagBonus: 0.5,
  cultivationBonus: 1.0,
  multiProviderBonus: 1.0,
  minimumForPromotion: 2.0,
};

export const CULTIVATION_CATEGORIES = new Set([
  'vegetable', 'fruit', 'herb', 'grain', 'legume', 'spice',
  'fruit_tree', 'fruit_shrub', 'root_vegetable', 'leafy_green',
]);

export const CULTIVATED_LIFE_CYCLES = new Set([
  'annual', 'biennial',
]);

export const INDUSTRIAL_SPECIES_PATTERNS = [
  /\bjute\b/i,
  /\bhemp\s+fiber\b/i,
  /\bchew\s+stick\b/i,
  /\bkenaf\b/i,
  /\bsisal\b/i,
  /\bramie\b/i,
  /\babutilon\s+theophrasti\b/i,
  /\bgouania\b/i,
  /\bcorchorus\b/i,
];
