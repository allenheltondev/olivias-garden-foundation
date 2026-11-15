// Guards the okra guides Vite plugin's dev-server contract.
//
// `this.addWatchFile()` is recorded as a module dependency on the dev server.
// Passing the content *folder* made Vite try to import a directory, so the
// virtual:okra-guides module returned a 500 in the browser and the whole app
// rendered blank on `npm run dev` (production builds were unaffected).

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(__dirname, '__fixtures__', 'okra-guides');

let okraGuidesPlugin;
let previousContentDir;

before(async () => {
  previousContentDir = process.env.OKRA_GUIDES_CONTENT_DIR;
  process.env.OKRA_GUIDES_CONTENT_DIR = fixtureDir;
  ({ okraGuidesPlugin } = await import('./vite-plugin-okra-guides.mjs'));
});

after(() => {
  if (previousContentDir === undefined) {
    delete process.env.OKRA_GUIDES_CONTENT_DIR;
  } else {
    process.env.OKRA_GUIDES_CONTENT_DIR = previousContentDir;
  }
});

/** Runs the plugin's load hook the way the dev server does, recording watched paths. */
function loadAsDevServer(id) {
  const plugin = okraGuidesPlugin();
  plugin.configResolved({ command: 'serve' });
  const watched = [];
  const resolved = plugin.resolveId(id);
  const code = plugin.load.call({ addWatchFile: (path) => watched.push(path) }, resolved);
  return { code, watched };
}

for (const id of ['virtual:okra-guides', 'virtual:okra-guide-content/example-okra-guide']) {
  test(`${id} never registers a directory as a watched file`, () => {
    const { watched } = loadAsDevServer(id);
    for (const path of watched) {
      assert.ok(statSync(path).isFile(), `addWatchFile() was given a directory: ${path}`);
    }
  });
}

test('the registry exposes summaries, routes, and a lazy loader per guide', () => {
  const { code } = loadAsDevServer('virtual:okra-guides');
  assert.match(code, /export const okraGuideSummaries = /);
  assert.match(code, /export const okraGuideRoutes = /);
  assert.match(code, /"example-okra-guide": \(\) => import\("virtual:okra-guide-content\/example-okra-guide"\)/);
  assert.match(code, /"example-related-guide": \(\) => import\("virtual:okra-guide-content\/example-related-guide"\)/);
});

test('each guide content module exports that guide', () => {
  const { code } = loadAsDevServer('virtual:okra-guide-content/example-okra-guide');
  assert.match(code, /^export default \{"slug":"example-okra-guide"/);
});

test('an empty content folder yields an empty registry and watches nothing', () => {
  const emptyDir = mkdtempSync(join(tmpdir(), 'okra-guides-empty-'));
  process.env.OKRA_GUIDES_CONTENT_DIR = emptyDir;
  try {
    const { code, watched } = loadAsDevServer('virtual:okra-guides');
    assert.deepEqual(watched, []);
    assert.match(code, /export const okraGuideSummaries = \[\];/);
    assert.match(code, /export const okraGuideRoutes = \[\];/);
    assert.match(code, /export const okraGuideLoaders = \{\n\n\};/);
  } finally {
    process.env.OKRA_GUIDES_CONTENT_DIR = fixtureDir;
    rmSync(emptyDir, { recursive: true, force: true });
  }
});
