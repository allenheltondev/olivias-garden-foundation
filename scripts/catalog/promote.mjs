import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { PATHS } from './lib/config.mjs';
import { readJsonl, appendJsonl, computeChecksum } from './lib/io.mjs';
import { validateRecord } from './lib/schemas.mjs';
import { readProgress, writeProgress, verifyChecksum, resetProgress } from './lib/progress.mjs';

function formatBatchId(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `catalog_${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function mapToImportRecord(rec, import_batch_id, imported_at) {
  return {
    canonical_id: rec.canonical_id,
    scientific_name: rec.scientific_name,
    common_name: rec.common_name,
    family: rec.family,
    category: rec.category || null,
    description: rec.description || null,
    edible: rec.edible ?? null,
    edible_parts: rec.edible_parts || [],
    water_requirement: rec.water_requirement || null,
    light_requirements: rec.light_requirements || [],
    life_cycle: rec.life_cycle || null,
    hardiness_zones: rec.hardiness_zones || [],
    catalog_status: rec.catalog_status,
    review_status: rec.review_status,
    field_sources: rec.field_sources || {},
    import_batch_id,
    imported_at,
    last_verified_at: null,
  };
}

export async function runPromote({ reset = false, dryRun = false, limit = null } = {}) {
  if (!fs.existsSync(PATHS.step6)) throw new Error(`Missing required input from Step 6: ${PATHS.step6}`);
  if (reset) await resetProgress(7);

  const checksum = await computeChecksum(PATHS.step6);
  await verifyChecksum(7, checksum);

  const input = [];
  for await (const r of readJsonl(PATHS.step6)) input.push(r);

  const progress = await readProgress(7);
  const startIndex = progress ? progress.lastProcessedIndex + 1 : 0;
  const slice = input.slice(startIndex, limit ? startIndex + limit : undefined);

  const import_batch_id = formatBatchId();
  const imported_at = new Date().toISOString();

  const promoted = [];
  const reviewNeedsReview = [];
  const reviewUnresolved = [];
  const reviewExcluded = [];

  for (const rec of slice) {
    const eligibleClass = rec.catalog_status === 'core' || rec.catalog_status === 'extended';
    const eligibleReview = rec.review_status === 'auto_approved';
    const candidate = mapToImportRecord(rec, import_batch_id, imported_at);
    const validation = validateRecord(['canonical_id', 'scientific_name', 'common_name', 'catalog_status', 'review_status'], candidate);
    const contentValid = Boolean(candidate.canonical_id && candidate.scientific_name && candidate.common_name);

    if (eligibleClass && eligibleReview && validation.valid && contentValid) {
      promoted.push(candidate);
      continue;
    }

    if (rec.catalog_status === 'excluded') {
      reviewExcluded.push(rec);
    } else if (rec.review_status === 'needs_review') {
      reviewNeedsReview.push({ ...rec, validation_errors: validation.errors });
    } else {
      reviewUnresolved.push({ ...rec, validation_errors: validation.errors });
    }
  }

  const summary = {
    import_batch_id,
    promotedCount: promoted.length,
    reviewNeedsReviewCount: reviewNeedsReview.length,
    reviewUnresolvedCount: reviewUnresolved.length,
    reviewExcludedCount: reviewExcluded.length,
    processedThisRun: slice.length,
  };

  if (!dryRun) {
    await fsp.mkdir('data/catalog', { recursive: true });
    await appendJsonl(PATHS.promoted, promoted);
    await appendJsonl(PATHS.reviewNeedsReview, reviewNeedsReview);
    await appendJsonl(PATHS.reviewUnresolved, reviewUnresolved);
    await appendJsonl(PATHS.reviewExcluded, reviewExcluded);
    await fsp.writeFile(PATHS.reviewSummary, JSON.stringify(summary, null, 2));
    if (slice.length > 0) await writeProgress(7, startIndex + slice.length - 1, checksum);
  }

  return summary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPromote().then((s) => console.log(JSON.stringify(s, null, 2))).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
