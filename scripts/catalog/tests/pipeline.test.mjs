import test from 'node:test';
import assert from 'node:assert/strict';
import { runPipeline } from '../run_pipeline.mjs';

test('pipeline rejects unknown step', async () => {
  await assert.rejects(
    runPipeline({ step: 99, dryRun: true }),
    /Unknown step/,
  );
});
