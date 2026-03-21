import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const DATA_DIR = path.resolve(ROOT, "..", "..", "data", "catalog");
const STEP2_PATH = path.join(DATA_DIR, "step2_source_matches.jsonl");
const STEP4_PATH = path.join(DATA_DIR, "step4_relevance_classified.jsonl");
const STEP5_PATH = path.join(DATA_DIR, "step5_canonical_drafts.jsonl");
const OUT_JSON = path.join(DATA_DIR, "metrics_400.json");
const OUT_MD = path.join(DATA_DIR, "metrics_400.md");
const OUT_SUSPICIOUS = path.join(DATA_DIR, "metrics_400_suspicious.jsonl");
const BASELINE_PATH = process.env.BENCHMARK_BASELINE_JSON
  ? path.resolve(ROOT, process.env.BENCHMARK_BASELINE_JSON)
  : null;
const SAMPLE_SIZE = Number(process.env.BENCHMARK_SAMPLE_SIZE ?? 400);

const THRESHOLDS = {
  min_promoted_pct: Number(process.env.BENCHMARK_MIN_PROMOTED_PCT ?? 5),
  max_needs_review_pct: Number(process.env.BENCHMARK_MAX_NEEDS_REVIEW_PCT ?? 35),
  max_suspicious_pct: Number(process.env.BENCHMARK_MAX_SUSPICIOUS_PCT ?? 20),
  max_fuzzy_match_pct: Number(process.env.BENCHMARK_MAX_FUZZY_MATCH_PCT ?? 25),
};

function parseJsonl(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function countBy(items, keyFn) {
  const out = {};
  for (const item of items) {
    const key = keyFn(item) ?? "unknown";
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

function pct(n, total) {
  return total === 0 ? 0 : Number(((n / total) * 100).toFixed(2));
}

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function scoreSuspicious(record, step4) {
  let score = 0;
  const reasons = [];
  if (record.match_type === "fuzzy") {
    score += 2;
    reasons.push("fuzzy_match");
  }
  if ((record.match_score ?? 1) < 0.82) {
    score += 2;
    reasons.push("low_match_score");
  }
  if (step4?.catalog_status === "promoted" && (step4?.source_confidence ?? 0) < 0.75) {
    score += 2;
    reasons.push("promoted_low_confidence");
  }
  if (step4?.catalog_status === "needs_review") {
    score += 2;
    reasons.push("needs_review");
  }
  if (step4?.has_openfarm_support === false && step4?.relevance_class === "food_crop") {
    score += 2;
    reasons.push("food_without_openfarm_support");
  }
  if ((step4?.source_agreement_score ?? 1) < 0.4) {
    score += 1;
    reasons.push("low_agreement");
  }
  return { score, reasons };
}

const [step2Raw, step4Raw, step5Raw] = await Promise.all([
  readFile(STEP2_PATH, "utf8"),
  readFile(STEP4_PATH, "utf8"),
  readFile(STEP5_PATH, "utf8"),
]);

const step2 = parseJsonl(step2Raw).sort((a, b) => String(a.source_record_id).localeCompare(String(b.source_record_id)));
const step4 = parseJsonl(step4Raw).sort((a, b) => String(a.canonical_id).localeCompare(String(b.canonical_id)));
const step5 = parseJsonl(step5Raw).sort((a, b) => String(a.canonical_id).localeCompare(String(b.canonical_id)));

const sampledStep2 = step2.slice(0, SAMPLE_SIZE);
const sampledStep4 = step4.slice(0, SAMPLE_SIZE);
const sampledStep5 = step5.slice(0, SAMPLE_SIZE);

const step4ByCanonical = new Map(sampledStep4.map((x) => [x.canonical_id, x]));
const step2BySourceId = new Map(sampledStep2.map((x) => [x.source_record_id, x]));

const suspicious = [];
for (const row of sampledStep5) {
  const sourceRecordId = row.source_records?.[0]?.source_record_id;
  const match = sourceRecordId ? step2BySourceId.get(sourceRecordId) : undefined;
  const cls = step4ByCanonical.get(row.canonical_id);
  const result = scoreSuspicious(match ?? {}, cls ?? row);
  if (result.score >= 4) {
    suspicious.push({
      canonical_id: row.canonical_id,
      source_record_id: sourceRecordId ?? null,
      scientific_name: row.scientific_name ?? null,
      common_name: row.common_name ?? null,
      catalog_status: row.catalog_status ?? cls?.catalog_status ?? null,
      relevance_class: row.relevance_class ?? cls?.relevance_class ?? null,
      match_type: match?.match_type ?? null,
      match_score: match?.match_score ?? null,
      source_confidence: row.source_confidence ?? cls?.source_confidence ?? null,
      source_agreement_score: row.source_agreement_score ?? cls?.source_agreement_score ?? null,
      suspicious_score: result.score,
      reasons: result.reasons,
    });
  }
}

const metrics = {
  generated_at: new Date().toISOString(),
  sample_size: sampledStep5.length,
  source_paths: {
    step2: path.relative(ROOT, STEP2_PATH),
    step4: path.relative(ROOT, STEP4_PATH),
    step5: path.relative(ROOT, STEP5_PATH),
  },
  distributions: {
    match_type: countBy(sampledStep2, (r) => r.match_type),
    relevance_class: countBy(sampledStep4, (r) => r.relevance_class),
    catalog_status: countBy(sampledStep5, (r) => r.catalog_status),
  },
  queue_counts: {
    promoted: sampledStep5.filter((r) => r.catalog_status === "promoted").length,
    needs_review: sampledStep5.filter((r) => r.catalog_status === "needs_review").length,
    excluded: sampledStep5.filter((r) => r.catalog_status === "excluded").length,
  },
  suspicious: {
    count: suspicious.length,
    threshold_score: 4,
    output: path.relative(ROOT, OUT_SUSPICIOUS),
  },
  thresholds: THRESHOLDS,
};

const total = metrics.sample_size;
const fuzzyPct = pct(metrics.distributions.match_type.fuzzy ?? 0, total);
const promotedPct = pct(metrics.queue_counts.promoted, total);
const needsReviewPct = pct(metrics.queue_counts.needs_review, total);
const suspiciousPct = pct(metrics.suspicious.count, total);

metrics.threshold_checks = {
  promoted_pct: { actual: promotedPct, pass: promotedPct >= metrics.thresholds.min_promoted_pct },
  needs_review_pct: { actual: needsReviewPct, pass: needsReviewPct <= metrics.thresholds.max_needs_review_pct },
  suspicious_pct: { actual: suspiciousPct, pass: suspiciousPct <= metrics.thresholds.max_suspicious_pct },
  fuzzy_match_pct: { actual: fuzzyPct, pass: fuzzyPct <= metrics.thresholds.max_fuzzy_match_pct },
};
metrics.pass = Object.values(metrics.threshold_checks).every((x) => x.pass);
const failingChecks = Object.entries(metrics.threshold_checks)
  .filter(([, check]) => !check.pass)
  .map(([name, check]) => ({ name, actual: check.actual }));

let baseline = null;
if (BASELINE_PATH) {
  try {
    baseline = JSON.parse(await readFile(BASELINE_PATH, "utf8"));
  } catch {
    baseline = null;
  }
}

const deltas = baseline
  ? {
      promoted_pct_delta: safeNumber((promotedPct - Number(baseline?.threshold_checks?.promoted_pct?.actual ?? 0)).toFixed(2)),
      needs_review_pct_delta: safeNumber((needsReviewPct - Number(baseline?.threshold_checks?.needs_review_pct?.actual ?? 0)).toFixed(2)),
      suspicious_pct_delta: safeNumber((suspiciousPct - Number(baseline?.threshold_checks?.suspicious_pct?.actual ?? 0)).toFixed(2)),
      fuzzy_match_pct_delta: safeNumber((fuzzyPct - Number(baseline?.threshold_checks?.fuzzy_match_pct?.actual ?? 0)).toFixed(2)),
    }
  : null;

metrics.baseline = baseline ? {
  path: path.relative(ROOT, BASELINE_PATH),
  generated_at: baseline.generated_at ?? null,
  deltas,
} : null;

const md = `# Catalog 400-sample benchmark\n\n- Generated: ${metrics.generated_at}\n- Sample size: ${metrics.sample_size}\n- Overall: **${metrics.pass ? "PASS" : "FAIL"}**\n\n## Failure summary\n${failingChecks.length === 0 ? "- none" : failingChecks.map((f) => `- ${f.name}: ${f.actual}%`).join("\\n")}\n\n## Baseline delta\n${metrics.baseline?.deltas
  ? Object.entries(metrics.baseline.deltas).map(([k, v]) => `- ${k}: ${v > 0 ? "+" : ""}${v}%`).join("\\n")
  : "- none (set BENCHMARK_BASELINE_JSON to compare)"}\n\n## Distributions\n\n### Match type\n${Object.entries(metrics.distributions.match_type)
  .map(([k, v]) => `- ${k}: ${v} (${pct(v, total)}%)`)
  .join("\n")}\n\n### Relevance class\n${Object.entries(metrics.distributions.relevance_class)
  .map(([k, v]) => `- ${k}: ${v} (${pct(v, total)}%)`)
  .join("\n")}\n\n### Catalog status\n${Object.entries(metrics.distributions.catalog_status)
  .map(([k, v]) => `- ${k}: ${v} (${pct(v, total)}%)`)
  .join("\n")}\n\n## Queue counts\n- promoted: ${metrics.queue_counts.promoted} (${promotedPct}%)\n- needs_review: ${metrics.queue_counts.needs_review} (${needsReviewPct}%)\n- excluded: ${metrics.queue_counts.excluded} (${pct(metrics.queue_counts.excluded, total)}%)\n\n## Suspicious sample queue\n- flagged: ${metrics.suspicious.count} (${suspiciousPct}%)\n- file: ${path.relative(ROOT, OUT_SUSPICIOUS)}\n\n## Threshold checks\n${Object.entries(metrics.threshold_checks)
  .map(([k, v]) => `- ${k}: ${v.actual}% -> ${v.pass ? "PASS" : "FAIL"}`)
  .join("\n")}\n`;

await mkdir(DATA_DIR, { recursive: true });
await writeFile(OUT_JSON, `${JSON.stringify(metrics, null, 2)}\n`, "utf8");
await writeFile(OUT_MD, md, "utf8");
await writeFile(OUT_SUSPICIOUS, suspicious.map((x) => JSON.stringify(x)).join("\n") + (suspicious.length ? "\n" : ""), "utf8");

console.log(`Wrote ${path.relative(ROOT, OUT_JSON)}`);
console.log(`Wrote ${path.relative(ROOT, OUT_MD)}`);
console.log(`Wrote ${path.relative(ROOT, OUT_SUSPICIOUS)}`);
console.log(`Benchmark result: ${metrics.pass ? "PASS" : "FAIL"}`);
