// Generates dist/sitemap.xml from the canonical seo-data list.
//
// Why this is generated and not static: keeping a hand-edited
// public/sitemap.xml in lockstep with the prerender route list and the
// runtime route table is easy to forget. Driving it off the same source
// as the prerender script means new public pages show up in the sitemap
// the moment they're added to seo-data.mjs.
//
// Rules:
// - Only routes with `allowIndex !== false` are listed. Pages we don't want
//   indexed (admin-style or beta routes) stay out of the sitemap entirely.
// - Routes with a `canonicalPath` (alias/redirect routes like /seeds) are
//   skipped so we never list a non-canonical URL.
// - `changefreq` and `priority` come from each route's `sitemap` block;
//   reasonable defaults are applied otherwise. `lastmod` is emitted when the
//   route provides one (okra guides use their dateModified).

import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seoRoutes, siteUrl } from './seo-data.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, '..', 'dist');

function escapeXml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function absoluteImageUrl(src) {
  return src.startsWith('http://') || src.startsWith('https://') ? src : `${siteUrl}${src}`;
}

export function buildEntry(route) {
  const loc = `${siteUrl}${route.path === '/' ? '/' : route.path}`;
  const changefreq = route.sitemap?.changefreq ?? 'monthly';
  const priority = (route.sitemap?.priority ?? 0.5).toFixed(1);

  return [
    '  <url>',
    `    <loc>${escapeXml(loc)}</loc>`,
    ...(route.sitemap?.lastmod ? [`    <lastmod>${escapeXml(route.sitemap.lastmod)}</lastmod>`] : []),
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority}</priority>`,
    // Google image sitemap extension: lets the page's photos be found in image search.
    ...(route.sitemap?.images ?? []).map((src) => `    <image:image><image:loc>${escapeXml(absoluteImageUrl(src))}</image:loc></image:image>`),
    '  </url>',
  ].join('\n');
}

export function buildSitemapXml(routes) {
  const body = routes.map(buildEntry).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${body}\n</urlset>\n`;
}

async function main() {
  const indexable = seoRoutes.filter(
    (route) => route.allowIndex !== false && !route.canonicalPath,
  );

  const xml = buildSitemapXml(indexable);

  const outPath = join(distDir, 'sitemap.xml');
  await writeFile(outPath, xml, 'utf8');
  console.log(`generate-sitemap: wrote ${indexable.length} URLs to ${outPath}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error('generate-sitemap failed:', error);
    process.exit(1);
  });
}
