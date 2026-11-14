// Checks that okra guides flow into the build-time SEO route list (prerender,
// sitemap, JSON-LD). Uses the fixture guides via OKRA_GUIDES_CONTENT_DIR, set
// before seo-data.mjs is imported because it loads guides at import time.

import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
process.env.OKRA_GUIDES_CONTENT_DIR = join(__dirname, '__fixtures__', 'okra-guides');
delete process.env.VITE_INCLUDE_DRAFT_GUIDES;

const { seoRoutes, prerenderRoutes, okraGuides } = await import('./seo-data.mjs');

test('published guides become prerendered, indexable article routes', () => {
  assert.deepEqual(okraGuides.map((guide) => guide.slug), ['example-okra-guide', 'example-related-guide']);

  const route = seoRoutes.find((candidate) => candidate.path === '/okra/example-okra-guide');
  assert.ok(route, 'guide route missing from seoRoutes');
  assert.ok(prerenderRoutes.includes(route));
  assert.equal(route.allowIndex, true);
  assert.equal(route.ogType, 'article');
  assert.equal(route.seoImage, '/images/social/okra-guides/example-okra-guide.jpg');
  assert.ok(route.seoImageAlt);
  assert.deepEqual(route.sitemap, { changefreq: 'monthly', priority: 0.7, lastmod: '2026-11-15' });
  assert.deepEqual(route.extraJsonLd.map((block) => block.id), ['okra-guide-article', 'okra-guide-breadcrumbs', 'okra-guide-faq']);
  assert.match(route.bodyFallback, /<h2 id="images">Images<\/h2>/);
  assert.match(route.bodyFallback, /Example related guide/);
});

test('the /okra hub fallback links to every guide', () => {
  const hub = seoRoutes.find((candidate) => candidate.path === '/okra');
  assert.match(hub.bodyFallback, /<h2>Okra growing guides<\/h2>/);
  assert.match(hub.bodyFallback, /href="\/okra\/example-okra-guide"/);
  assert.match(hub.bodyFallback, /href="\/okra\/example-related-guide"/);
});
