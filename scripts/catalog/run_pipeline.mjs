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
  const args = { step: null, reset: false, dryRun: false, limit: null };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--reset') args.reset = true;
    else if (token === '--dry-run') args.dryRun = true;
    else if (token === '--step') args.step = Number(argv[++i]);
    else if (token === '--limit') args.limit = Number(argv[++i]);
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

async function runOne(stepNumber, options) {
  const step = STEPS[stepNumber];
  if (!step) throw new Error(`Unknown step: ${stepNumber}`);
  if (step.input && !(await exists(step.input))) {
    throw new Error(`Missing prerequisite input for step ${stepNumber}: ${step.input}`);
  }
  if (options.reset) await cleanStep(stepNumber);
  const startedAt = new Date().toISOString();
  const result = await step.run(options);
  return { step: stepNumber, name: step.name, startedAt, finishedAt: new Date().toISOString(), result };
}

export async function runPipeline(options = {}) {
  const { step, ...rest } = options;
  if (step) return [await runOne(step, rest)];

  const summaries = [];
  for (const n of [1, 2, 3, 4, 5, 6, 7]) {
    summaries.push(await runOne(n, rest));
  }
  return summaries;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv);
  runPipeline(args)
    .then((summaries) => console.log(JSON.stringify({ summaries }, null, 2)))
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
