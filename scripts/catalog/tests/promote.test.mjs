import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runPromote } from '../promote.mjs';

const dataDir = path.resolve(process.cwd(), 'data/catalog');

test('promote partitions records exhaustively and sets import fields', async () => {
  await fs.mkdir(dataDir, { recursive: true });

  const paths = [
    'step6_augmented_catalog.jsonl',
    'promoted_crops.jsonl',
    'review_queue_needs_review.jsonl',
    'review_queue_unresolved.jsonl',
    'review_queue_excluded.jsonl',
    'promote_progress.json',
  ].map((name) => path.join(dataDir, name));
  await Promise.all(paths.map((p) => fs.rm(p, { force: true })));

  const step6 = [
    { canonical_id: '1', scientific_name: 'A', common_name: 'A', catalog_status: 'core', review_status: 'auto_approved' },
    { canonical_id: '2', scientific_name: 'B', common_name: 'B', catalog_status: 'extended', review_status: 'needs_review' },
    { canonical_id: '3', scientific_name: null, common_name: 'C', catalog_status: 'core', review_status: 'auto_approved' },
    { canonical_id: '4', scientific_name: 'D', common_name: 'D', catalog_status: 'excluded', review_status: 'rejected' },
  ];
  await fs.writeFile(path.join(dataDir, 'step6_augmented_catalog.jsonl'), `${step6.map((x) => JSON.stringify(x)).join('\n')}\n`);

  const summary = await runPromote();
  assert.equal(summary.processedThisRun, 4);
  assert.match(summary.import_batch_id, /^catalog_\d{8}_\d{6}$/);

  const promoted = (await fs.readFile(path.join(dataDir, 'promoted_crops.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(promoted.length, 1);
  assert.equal(promoted[0].last_verified_at, null);

  const needsReview = (await fs.readFile(path.join(dataDir, 'review_queue_needs_review.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  const unresolved = (await fs.readFile(path.join(dataDir, 'review_queue_unresolved.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  const excluded = (await fs.readFile(path.join(dataDir, 'review_queue_excluded.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);

  assert.equal(needsReview.length, 1);
  assert.equal(unresolved.length, 1);
  assert.equal(excluded.length, 1);
});
