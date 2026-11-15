import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { staleVariantFiles } from './generate-responsive-images.mjs';

const publicRoot = path.resolve('/site/public');
const generatedRoot = path.join(publicRoot, 'images', 'responsive');
const entry = (name) => ({
  variants: {
    avif: [480, 768].map((width) => ({ width, path: `images/responsive/okra/${name}-${width}.avif` })),
  },
});

test('only the selected entry\'s own variants are removed, not a sibling that shares its name prefix', () => {
  const manifest = { 'okra/okra.jpg': entry('okra'), 'okra/okra-flower.jpg': entry('okra-flower') };
  const files = staleVariantFiles(manifest, (key) => key === 'okra/okra.jpg', publicRoot, generatedRoot);
  assert.deepEqual(files, [
    path.join(generatedRoot, 'okra', 'okra-480.avif'),
    path.join(generatedRoot, 'okra', 'okra-768.avif'),
  ]);
});

test('variant paths outside the generated folder are never returned', () => {
  const manifest = {
    'okra/bad.jpg': { variants: { avif: [{ path: 'images/okra/bad.jpg' }, { path: '../../etc/passwd' }, { path: 'images/responsive/../okra/x.jpg' }] } },
  };
  assert.deepEqual(staleVariantFiles(manifest, () => true, publicRoot, generatedRoot), []);
});
