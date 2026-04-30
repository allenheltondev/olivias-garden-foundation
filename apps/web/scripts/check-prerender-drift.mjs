// Drift guard: routes.ts (runtime route table) and seo-data.mjs (build-time
// SEO/prerender source) must agree on which routes are prerendered and
// indexable. Without this check, drift goes silent: a route can have
// `prerender: true` in routes.ts but be missing from seo-data.mjs, and the
// build succeeds without writing its prerendered HTML or sitemap entry.
// The drift in #278 (donate prerender missing, seeds prerender stale) is
// what motivated this guard.

import { readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seoRoutes } from './seo-data.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..', '..');
const routesTsPath = join(__dirname, '..', 'src', 'site', 'routes.ts');
const seoDataPath = join(__dirname, 'seo-data.mjs');

function parseRoutesTs(content) {
  const arrayMatch = content.match(/export const routes:\s*AppRoute\[\]\s*=\s*\[([\s\S]*?)\n\];/);
  if (!arrayMatch) {
    throw new Error('Could not find `export const routes: AppRoute[] = [...]` block in routes.ts');
  }
  const arrayBody = arrayMatch[1];

  // Split into top-level objects by tracking brace depth. Avoids brittle
  // line-based parsing if a route ever spans formatting edge cases.
  const objects = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < arrayBody.length; i++) {
    const ch = arrayBody[i];
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        objects.push(arrayBody.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return objects.map((body) => {
    const pathMatch = body.match(/\bpath:\s*['"`]([^'"`]+)['"`]/);
    if (!pathMatch) {
      throw new Error(`Could not extract path from route object: ${body.slice(0, 120)}...`);
    }
    return {
      path: pathMatch[1],
      prerender: /\bprerender:\s*true\b/.test(body),
      allowIndex: /\ballowIndex:\s*false\b/.test(body) ? false : true,
    };
  });
}

function diffSets(expected, actual) {
  const missing = [...expected].filter((p) => !actual.has(p)).sort();
  const extra = [...actual].filter((p) => !expected.has(p)).sort();
  return { missing, extra };
}

async function main() {
  const content = await readFile(routesTsPath, 'utf8');
  const tsRoutes = parseRoutesTs(content);

  const tsPrerender = new Set(tsRoutes.filter((r) => r.prerender).map((r) => r.path));
  const seoPrerender = new Set(seoRoutes.filter((r) => r.prerender).map((r) => r.path));

  // Sitemap-eligible: prerendered AND indexable (and, on the seo side, not an alias).
  const tsSitemap = new Set(
    tsRoutes.filter((r) => r.prerender && r.allowIndex !== false).map((r) => r.path),
  );
  const seoSitemap = new Set(
    seoRoutes
      .filter((r) => r.prerender && r.allowIndex !== false && !r.canonicalPath)
      .map((r) => r.path),
  );

  const prerenderDiff = diffSets(tsPrerender, seoPrerender);
  const sitemapDiff = diffSets(tsSitemap, seoSitemap);

  // Per-route allowIndex agreement for routes present on both sides.
  const seoByPath = new Map(seoRoutes.map((r) => [r.path, r]));
  const allowIndexMismatches = [];
  for (const r of tsRoutes) {
    const seo = seoByPath.get(r.path);
    if (!seo) continue;
    const seoAllow = seo.allowIndex !== false;
    const tsAllow = r.allowIndex !== false;
    if (seoAllow !== tsAllow) {
      allowIndexMismatches.push({ path: r.path, routesTs: tsAllow, seoData: seoAllow });
    }
  }

  const hasDrift =
    prerenderDiff.missing.length ||
    prerenderDiff.extra.length ||
    sitemapDiff.missing.length ||
    sitemapDiff.extra.length ||
    allowIndexMismatches.length;

  if (!hasDrift) {
    console.log(
      `check-prerender-drift: routes.ts and seo-data.mjs agree (${tsPrerender.size} prerendered, ${tsSitemap.size} sitemap-eligible).`,
    );
    return;
  }

  const tsRel = relative(repoRoot, routesTsPath).replace(/\\/g, '/');
  const seoRel = relative(repoRoot, seoDataPath).replace(/\\/g, '/');

  console.error(`check-prerender-drift: drift detected between ${tsRel} and ${seoRel}`);
  console.error('');

  if (prerenderDiff.missing.length) {
    console.error(`  Routes with \`prerender: true\` in ${tsRel} but missing from ${seoRel}:`);
    for (const p of prerenderDiff.missing) console.error(`    - ${p}`);
  }
  if (prerenderDiff.extra.length) {
    console.error(`  Routes with \`prerender: true\` in ${seoRel} but missing from ${tsRel}:`);
    for (const p of prerenderDiff.extra) console.error(`    - ${p}`);
  }
  if (sitemapDiff.missing.length) {
    console.error(`  Sitemap-eligible routes (prerender + allowIndex !== false) in ${tsRel} missing from ${seoRel}:`);
    for (const p of sitemapDiff.missing) console.error(`    - ${p}`);
  }
  if (sitemapDiff.extra.length) {
    console.error(`  Sitemap-eligible routes in ${seoRel} missing from ${tsRel}:`);
    for (const p of sitemapDiff.extra) console.error(`    - ${p}`);
  }
  if (allowIndexMismatches.length) {
    console.error(`  allowIndex disagreement between ${tsRel} and ${seoRel}:`);
    for (const m of allowIndexMismatches) {
      console.error(`    - ${m.path}: routes.ts allowIndex=${m.routesTs}, seo-data.mjs allowIndex=${m.seoData}`);
    }
  }

  console.error('');
  console.error(`Resolve by updating ${seoRel} (or ${tsRel}) so the two sources agree, then re-run \`npm --workspace @olivias/web run build\`.`);
  process.exit(1);
}

main().catch((error) => {
  console.error('check-prerender-drift failed:', error);
  process.exit(1);
});
