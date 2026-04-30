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
//   reasonable defaults are applied otherwise.

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

function buildEntry(route) {
  const loc = `${siteUrl}${route.path === '/' ? '/' : route.path}`;
  const changefreq = route.sitemap?.changefreq ?? 'monthly';
  const priority = (route.sitemap?.priority ?? 0.5).toFixed(1);

  return [
    '  <url>',
    `    <loc>${escapeXml(loc)}</loc>`,
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority}</priority>`,
    '  </url>',
  ].join('\n');
}

async function main() {
  const indexable = seoRoutes.filter(
    (route) => route.allowIndex !== false && !route.canonicalPath,
  );

  const body = indexable.map(buildEntry).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;

  const outPath = join(distDir, 'sitemap.xml');
  await writeFile(outPath, xml, 'utf8');
  console.log(`generate-sitemap: wrote ${indexable.length} URLs to ${outPath}`);
}

main().catch((error) => {
  console.error('generate-sitemap failed:', error);
  process.exit(1);
});
