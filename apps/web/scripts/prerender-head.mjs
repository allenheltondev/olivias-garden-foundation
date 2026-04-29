// Head-only prerender: walks a list of public routes, clones dist/index.html,
// and rewrites the <head> tags so that crawlers and unfurl bots see per-route
// titles, descriptions, OG images, canonical URLs, and JSON-LD metadata.
//
// This does NOT pre-render the React tree — modern text crawlers (Google, Bing,
// Claude, ChatGPT) run JS and see the hydrated body; unfurl scrapers
// (Facebook, Twitter, Slack, LinkedIn, Discord) only read <head>, which is
// what this script populates.
//
// Output layout:
//   dist/index.html           -> home page head tags
//   dist/about/index.html     -> About page head tags
//   dist/get-involved/index.html
//   ...
//
// For this to actually serve per-route files on CloudFront, the distribution
// needs a viewer-request function (or equivalent) that rewrites `/about` to
// `/about/index.html`. See infra/foundation-web/template.yaml.
//
// ⚠ Route metadata below is duplicated from src/site/routes.ts. If you add a
//    route with `prerender: true` there, mirror it here.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, '..', 'dist');
const siteUrl = (process.env.VITE_SITE_URL ?? 'https://oliviasgarden.org').replace(/\/+$/, '');
const instagramUrl = 'https://instagram.com/oliviasgardentx';
const facebookUrl = 'https://www.facebook.com/profile.php?id=100087146659606#';
const defaultImage = '/images/home/og-image.png';
const defaultImageAlt = "Olivia's Garden Foundation social sharing image.";
const logoImage = '/images/icons/logo.svg';

/** @typedef {{ path: string, title: string, description: string, seoImage?: string, allowIndex?: boolean }} PrerenderRoute */
/** @type {PrerenderRoute[]} */
const prerenderRoutes = [
  {
    path: '/',
    title: "Olivia's Garden Foundation",
    description: "Olivia's Garden Foundation is a Texas nonprofit teaching families to grow food, care for animals, preserve harvests, and build practical self-sufficiency.",
    seoImage: defaultImage,
  },
  {
    path: '/about',
    title: "About Olivia's Garden",
    description: "Read Olivia's story, the foundation's mission, and the family-led work behind practical food-growing education in McKinney, Texas.",
    seoImage: defaultImage,
  },
  {
    path: '/get-involved',
    title: 'Get involved',
    description: "Find ways to support Olivia's Garden Foundation through volunteering, seed sharing, workshops, and community participation.",
    seoImage: defaultImage,
  },
  {
    path: '/seeds',
    title: 'Request free okra seeds',
    description: "Request free okra seeds from Olivia's Garden Foundation and join a growing food project rooted in Olivia's seed line.",
    seoImage: defaultImage,
  },
  {
    path: '/impact',
    title: "What we're building",
    description: "See what Olivia's Garden Foundation is growing now, from garden beds and animals to the next phase of community programs.",
    seoImage: defaultImage,
  },
  {
    path: '/contact',
    title: 'Get in touch',
    description: "Contact Olivia's Garden Foundation for volunteering, seeds, donations, partnerships, and general questions.",
    seoImage: defaultImage,
  },
  {
    path: '/good-roots',
    title: 'Good Roots Network',
    description: 'A community platform that connects home growers with neighbors and organizations who need fresh food. Plan your garden, see local food gaps, and share what you have extra.',
    seoImage: defaultImage,
  },
  {
    path: '/privacy',
    title: 'Privacy Policy',
    description: "Read how Olivia's Garden Foundation collects, uses, stores, and protects information across the foundation website, donations, and account features.",
    seoImage: defaultImage,
  },
  {
    path: '/terms',
    title: 'Terms of Service',
    description: "Review the terms that govern use of Olivia's Garden Foundation websites, accounts, donations, community tools, and submitted content.",
    seoImage: defaultImage,
  },
  {
    path: '/data',
    title: 'Data and account deletion',
    description: "How to delete your Olivia's Garden Foundation account and the personal data associated with it, including data from Facebook or Google sign-in.",
    seoImage: defaultImage,
  },
];

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
  const pageImage = absoluteUrl(route.seoImage ?? defaultImage);
  const robots = route.allowIndex === false
    ? 'noindex, nofollow, noarchive'
    : 'index, follow, max-image-preview:large';

  const jsonLdOrg = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'NonprofitOrganization',
    name: "Olivia's Garden Foundation",
    url: siteUrl,
    logo: absoluteUrl(logoImage),
    sameAs: [instagramUrl, facebookUrl],
  });

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
  });

  return {
    pageTitle,
    pageUrl,
    pageImage,
    robots,
    jsonLdOrg,
    jsonLdPage,
  };
}

function applyHead(templateHtml, route) {
  const { pageTitle, pageUrl, pageImage, robots, jsonLdOrg, jsonLdPage } = buildHeadFragment(route);
  const desc = escapeAttr(route.description);
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

  replaceMeta('name="description"', route.description);
  replaceMeta('name="robots"', robots);
  replaceMeta('property="og:title"', pageTitle);
  replaceMeta('property="og:description"', route.description);
  replaceMeta('property="og:image"', pageImage);
  replaceMeta('property="og:image:alt"', defaultImageAlt);
  replaceMeta('name="twitter:title"', pageTitle);
  replaceMeta('name="twitter:description"', route.description);
  replaceMeta('name="twitter:image"', pageImage);
  replaceMeta('name="twitter:image:alt"', defaultImageAlt);

  // og:url is not in the base template; inject it.
  if (/property="og:url"/i.test(html)) {
    html = html.replace(/(<meta\s+property="og:url"[^>]*\scontent=")[^"]*(")/i, `$1${escapeAttr(pageUrl)}$2`);
  } else {
    html = html.replace('<meta property="og:type"', `<meta property="og:url" content="${escapeAttr(pageUrl)}" />\n    <meta property="og:type"`);
  }

  // Canonical link
  html = html.replace(/<link\s+rel="canonical"[^>]*\/?>/i, `<link rel="canonical" href="${escapeAttr(pageUrl)}" />`);

  // JSON-LD blocks (inject once, before </head>)
  const jsonLdScripts =
    `    <script type="application/ld+json" data-seo-id="organization">${jsonLdOrg}</script>\n` +
    `    <script type="application/ld+json" data-seo-id="webpage">${jsonLdPage}</script>\n  `;

  // Remove any previous prerender JSON-LD so reruns are idempotent.
  html = html.replace(/\s*<script type="application\/ld\+json" data-seo-id="(organization|webpage)">[\s\S]*?<\/script>/g, '');
  html = html.replace('</head>', `${jsonLdScripts}</head>`);

  return html;
}

async function writeRoute(templateHtml, route) {
  const html = applyHead(templateHtml, route);
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
