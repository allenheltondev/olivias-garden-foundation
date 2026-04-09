import fs from 'node:fs/promises';
import { PATHS, PROGRESS_PATHS } from './lib/config.mjs';
import { runStep1 } from './step1_canonical_identity.mjs';
import { runStep2 } from './step2_match_sources.mjs';
import { runStep3 } from './step3_normalize.mjs';
import { runStep4 } from './step4_classify.mjs';
import { runStep5 } from './step5_derive_fields.mjs';
import { runStep6 } from './step6_llm_augment.mjs';
import { runPromote } from './promote.mjs';

const STEPS = {
  1: { name: 'canonical_identity', run: runStep1, output: PATHS.step1 },
  2: { name: 'match_sources', run: runStep2, output: PATHS.step2, input: PATHS.step1 },
  3: { name: 'normalize', run: runStep3, output: PATHS.step3, input: PATHS.step2 },
  4: { name: 'classify', run: runStep4, output: PATHS.step4, input: PATHS.step3 },
  5: { name: 'derive_fields', run: runStep5, output: PATHS.step5, input: PATHS.step4 },
  6: { name: 'llm_augment', run: runStep6, output: PATHS.step6, input: PATHS.step5 },
  7: { name: 'promote', run: runPromote, output: PATHS.promoted, input: PATHS.step6 },
};

function parseArgs(argv) {
  const args = { step: null, reset: false, dryRun: false, limit: null, profile: null, skipLlm: false };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--reset') args.reset = true;
    else if (token === '--dry-run') args.dryRun = true;
    else if (token === '--skip-llm') args.skipLlm = true;
    else if (token === '--step') args.step = Number(argv[++i]);
    else if (token === '--limit') args.limit = Number(argv[++i]);
    else if (token === '--profile') args.profile = argv[++i];
  }
  return args;
}

async function exists(path) {
  try { await fs.access(path); return true; } catch { return false; }
}

async function cleanStep(step) {
  const targets = [PROGRESS_PATHS[step], STEPS[step].output].filter(Boolean);
  for (const target of targets) {
    try { await fs.unlink(target); } catch {}
  }
}

function elapsed(startMs) {
  const s = (Date.now() - startMs) / 1000;
  return s < 60 ? `${s.toFixed(1)}s` : `${(s / 60).toFixed(1)}m`;
}

async function fileLines(path) {
  try {
    const txt = await fs.readFile(path, 'utf8');
    return txt.trim().split('\n').length;
  } catch { return 0; }
}

async function runOne(stepNumber, options) {
  const step = STEPS[stepNumber];
  if (!step) throw new Error(`Unknown step: ${stepNumber}`);
  if (step.input && !(await exists(step.input))) {
    throw new Error(`Missing prerequisite input for step ${stepNumber}: ${step.input}`);
  }
  if (options.reset) await cleanStep(stepNumber);

  const label = `Step ${stepNumber} (${step.name})`;
  process.stdout.write(`▶ ${label} ...`);
  const t0 = Date.now();
  const startedAt = new Date().toISOString();
  const result = await step.run(options);
  const finishedAt = new Date().toISOString();

  const outputLines = step.output ? await fileLines(step.output) : 0;
  const processed = result?.processedThisRun ?? result?.promotedCount ?? '?';
  const extra = result?.cacheHits != null ? ` (cache: ${result.cacheHits} hits, ${result.cacheMisses} misses)` : '';
  const promoted = result?.promotedCount != null ? ` → ${result.promotedCount} promoted` : '';
  console.log(`\r✔ ${label}  ${elapsed(t0)}  |  ${processed} processed  |  ${outputLines} output rows${extra}${promoted}`);

  return { step: stepNumber, name: step.name, startedAt, finishedAt, result };
}

export async function runPipeline(options = {}) {
  const { step, skipLlm, ...rest } = options;
  if (step) return [await runOne(step, rest)];

  const steps = skipLlm ? [1, 2, 3, 4, 5, 7] : [1, 2, 3, 4, 5, 6, 7];

  // When running the full pipeline with --reset, clean ALL steps upfront
  // so downstream steps don't see stale output files from previous runs.
  if (rest.reset) {
    console.log('--reset: cleaning all output and progress files before running');
    for (const n of [1, 2, 3, 4, 5, 6, 7]) await cleanStep(n);
    // Also clean promote-specific review files
    for (const key of ['reviewNeedsReview', 'reviewUnresolved', 'reviewExcluded', 'reviewSummary']) {
      if (PATHS[key]) try { await fs.unlink(PATHS[key]); } catch {}
    }
  }

  if (skipLlm) {
    console.log('--skip-llm: will copy step5 output to step6 path (bypassing LLM augmentation)');
  }

  const summaries = [];
  for (const n of steps) {
    if (skipLlm && n === 7) {
      // Copy step5 → step6 before promote runs
      await fs.copyFile(PATHS.step5, PATHS.step6);
      console.log(`Copied ${PATHS.step5} → ${PATHS.step6}`);
    }
    // limit only controls initial input (steps 1-2); downstream steps process all records
    // Don't pass reset to individual steps — we already cleaned everything upfront
    const stepOpts = n <= 2 ? { ...rest, reset: false } : { ...rest, reset: false, limit: null };
    summaries.push(await runOne(n, stepOpts));
  }
  return summaries;
}

import { pathToFileURL } from 'node:url';

const isMain = import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = parseArgs(process.argv);
  const pipelineStart = Date.now();
  runPipeline(args)
    .then((summaries) => {
      const total = elapsed(pipelineStart);
      console.log('');
      console.log(`Pipeline complete in ${total}  (${summaries.length} steps)`);
      // Show promoted count if promote ran
      const promoteStep = summaries.find(s => s.name === 'promote');
      if (promoteStep?.result?.promotedCount != null) {
        const r = promoteStep.result;
        const seedNote = r.seedInjectedCount ? ` (${r.seedInjectedCount} from seed list)` : '';
        console.log(`  Promoted: ${r.promotedCount}${seedNote}  |  Review: ${r.reviewNeedsReviewCount ?? 0}  |  Excluded: ${r.reviewExcludedCount ?? 0}`);
      }
    })
    .catch((error) => {
      console.error('');
      if (error.code === 'RATE_LIMITED_ABORT') {
        console.error(`⚠ ${error.message}`);
        console.error('  Re-run without --reset to resume from where it left off.');
      } else {
        console.error(`✖ ${error.message}`);
      }
      process.exit(1);
    });
}
