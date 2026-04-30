// Per-route prerender. Walks the SEO route list and writes a static
// dist/<path>/index.html for each entry with route-specific <head> tags
// (title, description, canonical, OG/Twitter, JSON-LD) and a <noscript>
// body fallback containing the page's key copy.
//
// The <noscript> block is the important new piece: the site is a React
// SPA, so the body served on first byte is just <div id="root"></div>.
// Crawlers that don't execute JS (LLM training pipelines, basic indexers,
// curl/WebFetch-style retrievals, simple unfurl bots) used to see nothing
// on the page. They now read the noscript content as plain text in the
// document.
//
// JS-enabled clients (browsers, Googlebot's renderer, Claude/GPT renderers)
// never display the noscript content; they hydrate React on top of #root
// the same as before.
//
// Output layout:
//   dist/index.html           -> home page
//   dist/about/index.html     -> About page
//   dist/get-involved/index.html
//   ...
//
// CloudFront / static-host routing must rewrite `/about` -> `/about/index.html`
// for these per-route files to be served. See infra/foundation-web/template.yaml.
//
// Route data (head + body fallback + sitemap weights) is the single source of
// truth in scripts/seo-data.mjs. Both this script and generate-sitemap.mjs
// import from it.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  defaultImage,
  defaultImageAlt,
  organizationJsonLd,
  prerenderRoutes,
  siteUrl,
} from './seo-data.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, '..', 'dist');

function buildPageTitle(route) {
  return route.path === '/'
    ? `${route.title} | Grow Food, Learn Skills, Build Community`
    : `${route.title} | Olivia's Garden Foundation`;
}

function absoluteUrl(path) {
  return path.startsWith('http://') || path.startsWith('https://') ? path : `${siteUrl}${path}`;
}

function escapeAttr(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildHeadFragment(route) {
  const pageTitle = buildPageTitle(route);
  const pageUrl = absoluteUrl(route.path === '/' ? '/' : route.path);
  const canonicalUrl = route.canonicalPath ? absoluteUrl(route.canonicalPath) : pageUrl;
  const pageImage = absoluteUrl(route.seoImage ?? defaultImage);
  const robots = route.allowIndex === false
    ? 'noindex, nofollow, noarchive'
    : 'index, follow, max-image-preview:large';

  const jsonLdOrg = JSON.stringify(organizationJsonLd);

  const jsonLdPage = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: pageTitle,
    description: route.description,
    url: pageUrl,
    isPartOf: {
      '@type': 'WebSite',
      name: "Olivia's Garden Foundation",
      url: siteUrl,
    },
    about: { '@id': `${siteUrl}/#organization` },
  });

  return {
    pageTitle,
    pageUrl,
    canonicalUrl,
    pageImage,
    robots,
    jsonLdOrg,
    jsonLdPage,
  };
}

function applyHead(templateHtml, route) {
  const { pageTitle, pageUrl, canonicalUrl, pageImage, robots, jsonLdOrg, jsonLdPage } = buildHeadFragment(route);
  const desc = route.description;
  const title = escapeAttr(pageTitle);

  let html = templateHtml;

  // <title>
  html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${title}</title>`);

  // Simple meta replacers (by attribute); each one is present in the base
  // index.html so we're rewriting values, not inserting new tags.
  const replaceMeta = (matcher, content) => {
    const regex = new RegExp(`(<meta\\s+${matcher}[^>]*\\scontent=")[^"]*(")`, 'i');
    if (regex.test(html)) {
      html = html.replace(regex, `$1${escapeAttr(content)}$2`);
    } else {
      // Fall back: inject before </head>
      html = html.replace('</head>', `    <meta ${matcher} content="${escapeAttr(content)}" />\n  </head>`);
    }
  };

  replaceMeta('name="description"', desc);
  replaceMeta('name="robots"', robots);
  replaceMeta('property="og:title"', pageTitle);
  replaceMeta('property="og:description"', desc);
  replaceMeta('property="og:image"', pageImage);
  replaceMeta('property="og:image:alt"', defaultImageAlt);
  replaceMeta('name="twitter:title"', pageTitle);
  replaceMeta('name="twitter:description"', desc);
  replaceMeta('name="twitter:image"', pageImage);
  replaceMeta('name="twitter:image:alt"', defaultImageAlt);

  // og:url is not in the base template; inject it.
  if (/property="og:url"/i.test(html)) {
    html = html.replace(/(<meta\s+property="og:url"[^>]*\scontent=")[^"]*(")/i, `$1${escapeAttr(pageUrl)}$2`);
  } else {
    html = html.replace('<meta property="og:type"', `<meta property="og:url" content="${escapeAttr(pageUrl)}" />\n    <meta property="og:type"`);
  }

  // Canonical link - may point at a different URL for alias routes (e.g. /seeds -> /okra).
  html = html.replace(/<link\s+rel="canonical"[^>]*\/?>/i, `<link rel="canonical" href="${escapeAttr(canonicalUrl)}" />`);

  // JSON-LD blocks (inject once, before </head>)
  const jsonLdScripts =
    `    <script type="application/ld+json" data-seo-id="organization">${jsonLdOrg}</script>\n` +
    `    <script type="application/ld+json" data-seo-id="webpage">${jsonLdPage}</script>\n  `;

  // Remove any previous prerender JSON-LD so reruns are idempotent.
  html = html.replace(/\s*<script type="application\/ld\+json" data-seo-id="(organization|webpage)">[\s\S]*?<\/script>/g, '');
  html = html.replace('</head>', `${jsonLdScripts}</head>`);

  return html;
}

function applyBody(html, route) {
  if (!route.bodyFallback) {
    return html;
  }

  // Trim leading/trailing whitespace from the literal but keep internal
  // formatting so the rendered HTML stays readable in dev tools.
  const fallback = route.bodyFallback.trim();
  const noscriptBlock = `    <noscript data-seo-fallback="true">\n${fallback}\n    </noscript>\n`;

  // Idempotent: strip any prior prerender noscript block first.
  html = html.replace(
    /\s*<noscript\s+data-seo-fallback="true">[\s\S]*?<\/noscript>\s*/i,
    '\n',
  );

  // Inject the noscript right after the opening of the React mount point so it
  // sits inside <body> at a predictable spot. We don't put it *inside* #root
  // because React.createRoot().render() would replace it on hydration; placing
  // it as a sibling lets browsers ignore it entirely once JS runs.
  if (/<div id="root"><\/div>/i.test(html)) {
    html = html.replace(/<div id="root"><\/div>/i, `<div id="root"></div>\n${noscriptBlock}`);
  } else {
    html = html.replace('</body>', `${noscriptBlock}  </body>`);
  }

  return html;
}

async function writeRoute(templateHtml, route) {
  const headApplied = applyHead(templateHtml, route);
  const html = applyBody(headApplied, route);
  const outPath = route.path === '/'
    ? join(distDir, 'index.html')
    : join(distDir, route.path.replace(/^\//, ''), 'index.html');

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, html, 'utf8');
  return outPath;
}

async function main() {
  const templatePath = join(distDir, 'index.html');
  const templateHtml = await readFile(templatePath, 'utf8');

  const written = [];
  for (const route of prerenderRoutes) {
    const out = await writeRoute(templateHtml, route);
    written.push(out);
  }

  console.log(`prerender-head: wrote ${written.length} files`);
  for (const file of written) {
    console.log(`  - ${file.replace(distDir + '\\', '').replace(distDir + '/', '')}`);
  }
}

main().catch((error) => {
  console.error('prerender-head failed:', error);
  process.exit(1);
});
