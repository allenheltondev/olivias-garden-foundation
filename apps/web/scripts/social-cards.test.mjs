import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { defaultImage, seoRoutes } from './seo-data.mjs';

// Load the actual client route configuration, with Vite's optional env values unset.
const source = await readFile(new URL('../src/site/routes.ts', import.meta.url), 'utf8');
const clientModule = stripTypeScriptTypes(source.replaceAll('import.meta.env', '({})'));
const { routes, socialShareImage } = await import(`data:text/javascript;base64,${Buffer.from(clientModule).toString('base64')}`);

const cards = ['okra', 'donate', 'about', 'faq', 'good-roots', 'get-involved', 'impact'];

for (const name of cards) {
  test(`${name} uses the same optimized social card for the client and crawlers`, async () => {
    const image = `/images/social/${name}.png`;
    assert.equal(routes.find((route) => route.path === `/${name}`)?.seoImage, image);
    assert.equal(seoRoutes.find((route) => route.path === `/${name}`)?.seoImage, image);
    const file = new URL(`../public${image}`, import.meta.url);
    const metadata = await sharp(fileURLToPath(file)).metadata();
    assert.equal(metadata.format, 'png');
    assert.equal(metadata.width, 1200);
    assert.equal(metadata.height, 630);
    assert.ok((await stat(file)).size < 1_000_000, 'Social card should be under 1 MB');
  });
}

test('home and secondary pages keep the default logo card', () => {
  assert.equal(socialShareImage, '/images/home/og-image.png');
  assert.equal(defaultImage, socialShareImage);
  for (const path of ['/', '/workshops', '/contact', '/transparency', '/privacy', '/terms', '/refunds', '/data']) {
    assert.equal(routes.find((route) => route.path === path)?.seoImage ?? socialShareImage, socialShareImage);
    assert.equal(seoRoutes.find((route) => route.path === path)?.seoImage ?? defaultImage, defaultImage);
  }
});
