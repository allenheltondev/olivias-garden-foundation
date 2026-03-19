import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';

import {
  readCache,
  writeCache,
  searchPlant,
  getCacheStats,
} from '../lib/permapeople.mjs';

function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'pp-cache-'));
}

test('cache round-trip', async () => {
  const dir = await tmpDir();
  const manifestPath = path.join(dir, 'manifest.json');
  const result = { hits: [{ id: 'a1', scientific_name: 'Solanum lycopersicum' }] };

  await writeCache('Solanum lycopersicum', result, { cacheDir: dir, manifestPath });
  const cached = await readCache('Solanum lycopersicum', { cacheDir: dir });

  assert.ok(cached);
  assert.deepEqual(cached.result, result);
});

test('cache-first search avoids second fetch', async () => {
  const dir = await tmpDir();
  const manifestPath = path.join(dir, 'manifest.json');
  let calls = 0;

  const originalFetch = global.fetch;
  global.fetch = async () => {
    calls += 1;
    return {
      status: 200,
      async json() {
        return { hits: [{ id: 'x1' }] };
      },
    };
  };

  try {
    const a = await searchPlant('Ocimum basilicum', { cacheDir: dir, manifestPath, requestDelayMs: 0, retries: 1 });
    const b = await searchPlant('Ocimum basilicum', { cacheDir: dir, manifestPath, requestDelayMs: 0, retries: 1 });

    assert.equal(calls, 1);
    assert.equal(a.hits.length, 1);
    assert.equal(b.hits.length, 1);

    const stats = getCacheStats();
    assert.ok(stats.hits >= 1);
    assert.ok(stats.misses >= 1);
  } finally {
    global.fetch = originalFetch;
  }
});
