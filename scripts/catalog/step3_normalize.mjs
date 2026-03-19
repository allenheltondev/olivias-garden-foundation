import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { PATHS } from './lib/config.mjs';
import { readJsonl, appendJsonl, computeChecksum } from './lib/io.mjs';
import { normalizeToNull, normalizeToArray, normalizeBool } from './lib/normalize.mjs';
import { readProgress, writeProgress, verifyChecksum, resetProgress } from './lib/progress.mjs';

function normalizeProviderPayload(raw = {}) {
  return {
    scientific_name: normalizeToNull(raw.scientific_name),
    common_names: normalizeToArray(raw.common_name || raw.name),
    light_requirements: normalizeToArray(raw['Light requirement']),
    water_requirement: normalizeToNull(raw['Water requirement'])?.toLowerCase() || null,
    edible: normalizeBool(raw.Edible),
    edible_parts: normalizeToArray(raw['Edible parts']),
    life_cycle: normalizeToNull(raw['Life cycle'])?.toLowerCase() || null,
    hardiness_zones: [],
    layer: normalizeToNull(raw.Layer)?.toLowerCase() || null,
    growth_habit: normalizeToNull(raw.Growth)?.toLowerCase() || null,
    warnings: normalizeToArray(raw.Warning),
    utility: normalizeToArray(raw.Utility),
    external_links: {
      pfaf_url: normalizeToNull(raw['Plants For A Future']),
      powo_url: normalizeToNull(raw['Plants of the World Online']),
      wikipedia_url: normalizeToNull(raw.Wikipedia),
    },
    companions: Array.isArray(raw.companions) ? raw.companions : [],
    antagonists: Array.isArray(raw.antagonists) ? raw.antagonists : [],
  };
}

export async function runStep3({ reset = false, dryRun = false, limit = null } = {}) {
  if (!fs.existsSync(PATHS.step2)) throw new Error(`Missing required input from Step 2: ${PATHS.step2}`);
  if (reset) await resetProgress(3);

  const checksum = await computeChecksum(PATHS.step2);
  await verifyChecksum(3, checksum);

  const step2 = [];
  for await (const r of readJsonl(PATHS.step2)) step2.push(r);

  const progress = await readProgress(3);
  const startIndex = progress ? progress.lastProcessedIndex + 1 : 0;
  const slice = step2.slice(startIndex, limit ? startIndex + limit : undefined);

  const out = slice.map((r) => ({
    source_provider: r.source_provider,
    source_record_id: r.source_record_id,
    canonical_id: r.canonical_id,
    match_type: r.match_type,
    match_score: r.match_score,
    normalized: normalizeProviderPayload({
      scientific_name: r.source_scientific_name,
      common_name: r.source_common_name,
    }),
    raw: {
      source_provider: r.source_provider,
      source_record_id: r.source_record_id,
    },
    normalization_warnings: [],
  }));

  if (!dryRun) {
    await fsp.mkdir('data/catalog', { recursive: true });
    await appendJsonl(PATHS.step3, out);
    if (out.length > 0) await writeProgress(3, startIndex + out.length - 1, checksum);
  }

  return { processedThisRun: out.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runStep3().then((s) => console.log(JSON.stringify(s, null, 2))).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
