import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runStep1 } from '../step1_canonical_identity.mjs';

const usdaPath = path.resolve(process.cwd(), 'lib', 'usda-plants.txt');

test('step1 fails clearly when USDA file missing', async () => {
  if (fs.existsSync(usdaPath)) {
    assert.ok(true);
    return;
  }

  await assert.rejects(() => runStep1({ dryRun: true }), /Missing USDA file/);
});
