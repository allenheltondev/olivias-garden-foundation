import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { PATHS } from './lib/config.mjs';
import { readJsonl, appendJsonl, computeChecksum } from './lib/io.mjs';
import { readProgress, writeProgress, verifyChecksum, resetProgress } from './lib/progress.mjs';
import { batchAugment } from './lib/bedrock.mjs';

function isEligible(rec) {
  return rec.catalog_status === 'core' || rec.catalog_status === 'extended';
}

function applyAugmentation(record, augmentation) {
  const out = { ...record, field_sources: { ...(record.field_sources || {}) } };

  if (augmentation.description && !out.description) {
    out.description = augmentation.description;
    out.field_sources.description = 'llm';
  }

  if (augmentation.category && !out.category) {
    out.category = augmentation.category;
    out.field_sources.category = 'llm';
  }

  if (augmentation.life_cycle && !out.life_cycle) {
    out.life_cycle = augmentation.life_cycle;
    out.field_sources.life_cycle = 'llm';
  }

  if (augmentation.hardiness_zones?.length && (!out.hardiness_zones || !out.hardiness_zones.length)) {
    out.hardiness_zones = augmentation.hardiness_zones;
    out.field_sources.hardiness_zones = 'llm';
  }

  // New garden planning fields — always apply from LLM since these don't exist in source data
  if (augmentation.frost_tolerance) {
    out.frost_tolerance = augmentation.frost_tolerance;
    out.field_sources.frost_tolerance = 'llm';
  }

  if (augmentation.days_to_maturity) {
    out.days_to_maturity = augmentation.days_to_maturity;
    out.field_sources.days_to_maturity = 'llm';
  }

  if (augmentation.sowing_months?.length) {
    out.sowing_months = augmentation.sowing_months;
    out.field_sources.sowing_months = 'llm';
  }

  if (augmentation.harvest_months?.length) {
    out.harvest_months = augmentation.harvest_months;
    out.field_sources.harvest_months = 'llm';
  }

  if (augmentation.spacing) {
    out.spacing = augmentation.spacing;
    out.field_sources.spacing = 'llm';
  }

  if (augmentation.soil_ph) {
    out.soil_ph = augmentation.soil_ph;
    out.field_sources.soil_ph = 'llm';
  }

  if (augmentation.companion_plants?.length) {
    out.companion_plants = augmentation.companion_plants;
    out.field_sources.companion_plants = 'llm';
  }

  if (augmentation.antagonist_plants?.length) {
    out.antagonist_plants = augmentation.antagonist_plants;
    out.field_sources.antagonist_plants = 'llm';
  }

  if (augmentation.display_notes) {
    out.display_notes = augmentation.display_notes;
    out.field_sources.display_notes = 'llm';
  }

  if (augmentation.review_notes) {
    out.review_notes = augmentation.review_notes;
    out.field_sources.review_notes = 'llm';
  }

  return out;
}

export async function runStep6({ reset = false, dryRun = false, limit = null, invoke, profile, modelId = process.env.BEDROCK_MODEL_ID || 'us.anthropic.claude-3-5-haiku-20241022-v1:0' } = {}) {
  if (!fs.existsSync(PATHS.step5)) throw new Error(`Missing required input from Step 5: ${PATHS.step5}`);
  if (reset) await resetProgress(6);

  const checksum = await computeChecksum(PATHS.step5);
  await verifyChecksum(6, checksum);

  const input = [];
  for await (const r of readJsonl(PATHS.step5)) input.push(r);

  const progress = await readProgress(6);
  const startIndex = progress ? progress.lastProcessedIndex + 1 : 0;
  const slice = input.slice(startIndex, limit ? startIndex + limit : undefined);

  const eligible = slice.filter(isEligible);
  const passthrough = slice.filter((rec) => !isEligible(rec));

  const { successes, failures, apiCalls } = await batchAugment({
    records: eligible,
    invoke,
    modelId,
    profile,
    dryRun,
  });

  const failureById = new Map(failures.map((f) => [f.record.canonical_id, f.error]));

  const augmented = successes.map(({ record, augmentation }) => applyAugmentation(record, augmentation));
  const failedRecords = eligible
    .filter((r) => failureById.has(r.canonical_id))
    .map((r) => ({ ...r, augmentation_error: failureById.get(r.canonical_id) }));

  const out = [...augmented, ...failedRecords, ...passthrough];

  const summary = {
    processedThisRun: out.length,
    augmentedCount: augmented.length,
    failedCount: failedRecords.length,
    apiCallCount: apiCalls,
    fieldPopulationRates: {
      description: augmented.length ? augmented.filter((r) => r.description).length / augmented.length : 0,
      category: augmented.length ? augmented.filter((r) => r.category).length / augmented.length : 0,
      display_notes: augmented.length ? augmented.filter((r) => r.display_notes).length / augmented.length : 0,
      review_notes: augmented.length ? augmented.filter((r) => r.review_notes).length / augmented.length : 0,
    },
  };

  if (!dryRun) {
    await fsp.mkdir('data/catalog', { recursive: true });
    await appendJsonl(PATHS.step6, out);
    if (out.length > 0) await writeProgress(6, startIndex + out.length - 1, checksum);
  }

  return summary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runStep6().then((s) => console.log(JSON.stringify(s, null, 2))).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
