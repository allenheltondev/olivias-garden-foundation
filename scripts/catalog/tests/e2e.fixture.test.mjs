import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runPromote } from '../promote.mjs';

const root = process.cwd();
const dataDir = path.join(root, 'data/catalog');
const fixturePath = path.join(root, 'tests/fixtures/step6_happy_path.jsonl');

async function readJsonl(filePath) {
  const txt = await fs.readFile(filePath, 'utf8');
  return txt.trim().split('\n').filter(Boolean).map(JSON.parse);
}

test('fixture E2E promotion preserves partition invariants', async () => {
  await fs.mkdir(dataDir, { recursive: true });
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
});
