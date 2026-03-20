import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { runPromote } from '../promote.mjs';
import { PATHS, PROGRESS_PATHS } from '../lib/config.mjs';

const root = process.cwd();
const fixturePath = path.join(root, 'tests/fixtures/step6_happy_path.jsonl');

async function withTempCatalogPaths(fn) {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'catalog-e2e-test-'));
  const dataDir = path.join(tmpRoot, 'data', 'catalog');
  await fs.mkdir(dataDir, { recursive: true });

  const oldPaths = { ...PATHS };
  const oldProgress = { ...PROGRESS_PATHS };

  PATHS.step6 = path.join(dataDir, 'step6_augmented_catalog.jsonl');
  PATHS.promoted = path.join(dataDir, 'promoted_crops.jsonl');
  PATHS.reviewNeedsReview = path.join(dataDir, 'review_queue_needs_review.jsonl');
  PATHS.reviewUnresolved = path.join(dataDir, 'review_queue_unresolved.jsonl');
  PATHS.reviewExcluded = path.join(dataDir, 'review_queue_excluded.jsonl');
  PATHS.reviewSummary = path.join(dataDir, 'review_summary.json');
  PROGRESS_PATHS[7] = path.join(dataDir, 'promote_progress.json');

  try {
    await fn(dataDir);
  } finally {
    Object.assign(PATHS, oldPaths);
    Object.assign(PROGRESS_PATHS, oldProgress);
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
}

async function readJsonl(filePath) {
  const txt = await fs.readFile(filePath, 'utf8');
  return txt.trim().split('\n').filter(Boolean).map(JSON.parse);
}

test('fixture E2E promotion preserves partition invariants', async () => withTempCatalogPaths(async (dataDir) => {
  const outputs = [
    'step6_augmented_catalog.jsonl',
    'promoted_crops.jsonl',
    'review_queue_needs_review.jsonl',
    'review_queue_unresolved.jsonl',
    'review_queue_excluded.jsonl',
    'promote_progress.json',
  ];
  await Promise.all(outputs.map((name) => fs.rm(path.join(dataDir, name), { force: true })));

  await fs.copyFile(fixturePath, path.join(dataDir, 'step6_augmented_catalog.jsonl'));
  const summary = await runPromote();

  const promoted = await readJsonl(path.join(dataDir, 'promoted_crops.jsonl'));
  const needsReview = await readJsonl(path.join(dataDir, 'review_queue_needs_review.jsonl'));
  const unresolvedTxt = await fs.readFile(path.join(dataDir, 'review_queue_unresolved.jsonl'), 'utf8').catch(() => '');
  const unresolved = unresolvedTxt.trim() ? unresolvedTxt.trim().split('\n').map(JSON.parse) : [];
  const excluded = await readJsonl(path.join(dataDir, 'review_queue_excluded.jsonl'));

  assert.equal(promoted.length, 1);
  assert.equal(needsReview.length, 1);
  assert.equal(unresolved.length, 0);
  assert.equal(excluded.length, 1);
  assert.equal(promoted.length + needsReview.length + unresolved.length + excluded.length, 3);
  assert.equal(summary.processedThisRun, 3);
}));
