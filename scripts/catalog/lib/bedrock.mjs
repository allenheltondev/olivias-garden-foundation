import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { fromSSO } from '@aws-sdk/credential-providers';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createBedrockClient({ region = process.env.AWS_REGION || 'us-east-1', client, profile } = {}) {
  if (client) return client;
  const opts = { region };
  if (profile) opts.credentials = fromSSO({ profile });
  return new BedrockRuntimeClient(opts);
}

export function parseModelJson(text) {
  if (!text) throw new Error('Empty model response');
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') throw new Error('Model response is not an object');
    return parsed;
  } catch (error) {
    throw new Error(`Invalid model JSON: ${error.message}`);
  }
}

export function validateAugmentationSchema(payload = {}) {
  const VALID_CATEGORIES = new Set(['fruit', 'fruit_tree', 'fruit_shrub', 'vegetable', 'leafy_green', 'root_tuber', 'herb', 'grain', 'nut_seed', 'edible_flower', 'legume']);
  const VALID_LIFE_CYCLES = new Set(['annual', 'biennial', 'perennial']);
  const VALID_FROST = new Set(['tender', 'semi-hardy', 'hardy']);

  const desc = typeof payload.description === 'string' && payload.description.trim() ? payload.description.trim() : null;
  const cat = typeof payload.category === 'string' && VALID_CATEGORIES.has(payload.category.trim().toLowerCase()) ? payload.category.trim().toLowerCase() : null;
  const lc = typeof payload.life_cycle === 'string' && VALID_LIFE_CYCLES.has(payload.life_cycle.trim().toLowerCase()) ? payload.life_cycle.trim().toLowerCase() : null;
  const hz = Array.isArray(payload.hardiness_zones) ? payload.hardiness_zones.filter((z) => typeof z === 'string' && /^\d{1,2}[ab]?$/.test(z.trim())).map((z) => z.trim()) : [];
  const frost = typeof payload.frost_tolerance === 'string' && VALID_FROST.has(payload.frost_tolerance.trim().toLowerCase()) ? payload.frost_tolerance.trim().toLowerCase() : null;

  // Days to maturity: integer or range object
  let dtm = null;
  if (payload.days_to_maturity != null) {
    if (typeof payload.days_to_maturity === 'number' && Number.isFinite(payload.days_to_maturity) && payload.days_to_maturity > 0) {
      dtm = { min: payload.days_to_maturity, max: payload.days_to_maturity };
    } else if (typeof payload.days_to_maturity === 'object' && payload.days_to_maturity.min && payload.days_to_maturity.max) {
      const min = Number(payload.days_to_maturity.min);
      const max = Number(payload.days_to_maturity.max);
      if (Number.isFinite(min) && Number.isFinite(max) && min > 0 && max >= min) dtm = { min, max };
    }
  }

  // Sowing months: array of 1-12
  const sowMonths = Array.isArray(payload.sowing_months)
    ? payload.sowing_months.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 12)
    : [];

  // Harvest months: array of 1-12
  const harvestMonths = Array.isArray(payload.harvest_months)
    ? payload.harvest_months.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 12)
    : [];

  // Spacing: object with plant_cm and row_cm
  let spacing = null;
  if (payload.spacing && typeof payload.spacing === 'object') {
    const p = Number(payload.spacing.plant_cm);
    const r = Number(payload.spacing.row_cm);
    if (Number.isFinite(p) && p > 0) spacing = { plant_cm: p, row_cm: Number.isFinite(r) && r > 0 ? r : p };
  }

  // Soil pH: object with min and max
  let soilPh = null;
  if (payload.soil_ph && typeof payload.soil_ph === 'object') {
    const min = Number(payload.soil_ph.min);
    const max = Number(payload.soil_ph.max);
    if (Number.isFinite(min) && Number.isFinite(max) && min >= 3 && max <= 10 && min <= max) soilPh = { min, max };
  }

  // Companion plants: array of strings (scientific or common names)
  const companions = Array.isArray(payload.companion_plants)
    ? payload.companion_plants.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim().toLowerCase()).slice(0, 10)
    : [];

  // Antagonist plants: array of strings
  const antagonists = Array.isArray(payload.antagonist_plants)
    ? payload.antagonist_plants.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim().toLowerCase()).slice(0, 10)
    : [];

  return {
    description: desc && desc.length <= 200 ? desc : (desc ? desc.slice(0, 200) : null),
    category: cat,
    life_cycle: lc,
    hardiness_zones: hz,
    frost_tolerance: frost,
    days_to_maturity: dtm,
    sowing_months: sowMonths,
    harvest_months: harvestMonths,
    spacing,
    soil_ph: soilPh,
    companion_plants: companions,
    antagonist_plants: antagonists,
    display_notes: typeof payload.display_notes === 'string' && payload.display_notes.trim() ? payload.display_notes.trim() : null,
    review_notes: typeof payload.review_notes === 'string' && payload.review_notes.trim() ? payload.review_notes.trim() : null,
  };
}

export async function invokeAugmentModel({
  client,
  modelId,
  record,
  profile,
  maxRetries = 2,
  retryDelayMs = 500,
  dryRun = false,
} = {}) {
  if (dryRun) {
    return { result: validateAugmentationSchema({}), apiCalls: 0 };
  }

  const runtime = createBedrockClient({ client, profile });
  const prompt = {
    task: 'Fill ONLY missing fields for this food crop catalog entry. This data will be used for garden planning — watering schedules, harvest timing, and companion planting. Keep descriptions under 120 characters, factual, and grower-focused. Use null for any field you are not confident about. Do not guess hardiness zones. For sowing/harvest months, use Northern Hemisphere temperate zone defaults (USDA zones 5-8). Companion and antagonist plants should use common names.',
    record: {
      canonical_id: record.canonical_id,
      scientific_name: record.scientific_name,
      common_name: record.common_name,
      family: record.family,
      category: record.category,
      edible_parts: record.edible_parts,
      life_cycle: record.life_cycle,
      hardiness_zones: record.hardiness_zones,
      water_requirement: record.water_requirement,
    },
    fill_only: Object.entries({
      description: !record.description,
      category: !record.category,
      life_cycle: !record.life_cycle,
      hardiness_zones: !record.hardiness_zones?.length,
      frost_tolerance: true,
      days_to_maturity: true,
      sowing_months: true,
      harvest_months: true,
      spacing: true,
      soil_ph: true,
      companion_plants: true,
      antagonist_plants: true,
    }).filter(([, missing]) => missing).map(([k]) => k),
    response_schema: {
      description: 'string|null — under 120 chars, factual, no marketing language',
      category: 'string|null — one of: fruit, fruit_tree, fruit_shrub, vegetable, leafy_green, root_tuber, herb, grain, nut_seed, edible_flower, legume',
      life_cycle: 'string|null — one of: annual, biennial, perennial',
      hardiness_zones: 'string[]|[] — USDA zones as strings, e.g. ["3","4","5","6","7","8"]',
      frost_tolerance: 'string|null — one of: tender, semi-hardy, hardy',
      days_to_maturity: '{ min: number, max: number }|null — days from transplant/sowing to first harvest',
      sowing_months: 'number[]|[] — months 1-12 when seeds can be started (Northern Hemisphere temperate)',
      harvest_months: 'number[]|[] — months 1-12 when crop is typically harvested',
      spacing: '{ plant_cm: number, row_cm: number }|null — recommended spacing in centimeters',
      soil_ph: '{ min: number, max: number }|null — preferred soil pH range',
      companion_plants: 'string[]|[] — common names of beneficial companion plants (max 10)',
      antagonist_plants: 'string[]|[] — common names of plants to avoid planting nearby (max 10)',
    },
  };

  let lastError;
  let apiCalls = 0;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      apiCalls += 1;
      const response = await runtime.send(new InvokeModelCommand({
        modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 1024,
          messages: [{ role: 'user', content: JSON.stringify(prompt) }],
        }),
      }));
      const body = JSON.parse(Buffer.from(response.body).toString('utf8'));
      const text = body.content?.[0]?.text || '';
      const parsed = parseModelJson(text);
      return { result: validateAugmentationSchema(parsed), apiCalls };
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) await sleep(retryDelayMs * (attempt + 1));
    }
  }
  throw new Error(`Bedrock invocation failed: ${lastError?.message || 'unknown error'}`);
}

export async function batchAugment({ records, invoke = invokeAugmentModel, batchSize = 20, ...options } = {}) {
  const successes = [];
  const failures = [];
  let apiCalls = 0;

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    for (const record of batch) {
      try {
        const { result, apiCalls: count = 0 } = await invoke({ ...options, record });
        apiCalls += count;
        successes.push({ record, augmentation: result });
      } catch (error) {
        failures.push({ record, error: error.message });
      }
    }
  }

  return { successes, failures, apiCalls };
}
