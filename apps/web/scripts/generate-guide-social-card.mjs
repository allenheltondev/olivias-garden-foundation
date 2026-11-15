// Generates a page-specific 1200x630 social card for an okra guide.
//
//   npm run social:guide -- <slug> [--headline="Short headline"] [--photo=/images/...jpg]
//
// Layout follows the social card brief in issue #412: a cream text panel with a
// serif headline and the foundation wordmark on the left, the guide's photo on
// the right, with text kept inside the central ~1000x520 safe zone.
//
// - Photo: --photo, else the guide's heroImage.src.
// - Headline: --headline, else the guide's title. Aim for 3-7 words.
// - Output: the guide's socialImage.src, else
//   /images/social/okra-guides/<slug>.jpg (and the JSON to add is printed).
//
// The card is a solid starting point; a designer can replace the file at the
// same path at any time. Commit the generated file.

import { existsSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { guidesContentDir, publicDir, SOCIAL_IMAGE_HEIGHT, SOCIAL_IMAGE_WIDTH } from './okra-guides.mjs';

const WIDTH = SOCIAL_IMAGE_WIDTH;
const HEIGHT = SOCIAL_IMAGE_HEIGHT;
const PANEL_WIDTH = 700;
const TEXT_LEFT = 100;
const TEXT_MAX_WIDTH = PANEL_WIDTH - TEXT_LEFT - 40;
const COLORS = {
  cream: '#fbf5ea',
  green: '#336431',
  soil: '#4c3426',
};
const SERIF = "Georgia, 'DejaVu Serif', 'Liberation Serif', serif";

function readArg(name) {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return raw ? raw.slice(name.length + 3) : undefined;
}

function escapeXml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Greedy word wrap using an average glyph width estimate for serif text. */
export function wrapHeadline(text, fontSize, maxWidth) {
  const maxChars = Math.max(8, Math.floor(maxWidth / (fontSize * 0.52)));
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) {
    lines.push(line);
  }
  return lines;
}

export const MAX_HEADLINE_LINES = 3;

/**
 * Largest font size (64 down to 44) that fits the headline in at most three
 * lines. Throws instead of truncating when even 44px needs more lines, so a
 * too-long headline is shortened by a person rather than silently cut off.
 */
export function layoutHeadline(text) {
  for (let fontSize = 64; fontSize >= 44; fontSize -= 4) {
    const lines = wrapHeadline(text, fontSize, TEXT_MAX_WIDTH);
    if (lines.length <= MAX_HEADLINE_LINES) {
      return { fontSize, lines };
    }
  }
  throw new Error(`Headline "${text}" needs more than ${MAX_HEADLINE_LINES} lines; shorten it (aim for 3-7 words) with --headline.`);
}

export function buildPanelSvg(headline) {
  const { fontSize, lines } = layoutHeadline(headline);
  const lineHeight = Math.round(fontSize * 1.12);
  const blockHeight = lines.length * lineHeight;
  const firstBaseline = Math.round((HEIGHT - blockHeight) / 2 + fontSize * 0.85) - 10;

  const headlineTspans = lines
    .map((line, index) => `<tspan x="${TEXT_LEFT}" y="${firstBaseline + index * lineHeight}">${escapeXml(line)}</tspan>`)
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
  <rect x="0" y="0" width="${PANEL_WIDTH}" height="${HEIGHT}" fill="${COLORS.cream}"/>
  <rect x="${TEXT_LEFT}" y="70" width="56" height="6" rx="3" fill="${COLORS.green}"/>
  <text font-family="${SERIF}" font-size="${fontSize}" font-weight="700" fill="${COLORS.soil}">${headlineTspans}</text>
  <text x="${TEXT_LEFT}" y="${HEIGHT - 70}" font-family="${SERIF}" font-size="28" font-weight="700" fill="${COLORS.green}">Olivia&apos;s Garden Foundation</text>
</svg>`;
}

// --- "page" style ----------------------------------------------------------
// Matches the main-site cards from #428 (docs/design/social-share-cards.md):
// cream #f6f2e7, garden-green #305526 serif headline, a thin divider, and the
// heart logo with the wordmark, with a real photo on the right.

const PAGE = {
  panelWidth: 576,
  textLeft: 78,
  textMaxWidth: 576 - 78 - 46,
  cream: '#f6f2e7',
  green: '#305526',
  dividerY: 372,
};

/**
 * Page headline layout: the fewest lines (at most three) at any size from 72px
 * down to 52px, then the largest size for that line count. Avoids orphaned
 * first words like "Help / Olivia's / okra spread".
 */
export function layoutPageHeadline(text) {
  let best = null;
  for (let fontSize = 72; fontSize >= 52; fontSize -= 4) {
    const maxChars = Math.max(6, Math.floor(PAGE.textMaxWidth / (fontSize * 0.58)));
    const lines = [];
    let line = '';
    for (const word of text.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (candidate.length > maxChars && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
    const fits = lines.length <= MAX_HEADLINE_LINES && lines.every((entry) => entry.length <= maxChars + 1);
    if (fits && (!best || lines.length < best.lines.length)) {
      best = { fontSize, lines };
    }
  }
  if (!best) {
    throw new Error(`Headline "${text}" needs more than ${MAX_HEADLINE_LINES} lines; shorten it with --headline.`);
  }
  return best;
}

function logoDataUri() {
  const svg = readFileSync(join(publicDir, 'images', 'icons', 'logo.svg'), 'utf8').replace(/#4d7a13/gi, PAGE.green);
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

export function buildPagePanelSvg(headline) {
  const { fontSize, lines } = layoutPageHeadline(headline);
  const lineHeight = Math.round(fontSize * 1.1);
  // Bottom-align the headline just above the divider.
  const lastBaseline = PAGE.dividerY - 36;
  const firstBaseline = lastBaseline - (lines.length - 1) * lineHeight;
  const tspans = lines
    .map((line, index) => `<tspan x="${PAGE.textLeft}" y="${firstBaseline + index * lineHeight}">${escapeXml(line)}</tspan>`)
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${WIDTH}" height="${HEIGHT}">
  <rect x="0" y="0" width="${PAGE.panelWidth}" height="${HEIGHT}" fill="${PAGE.cream}"/>
  <text font-family="${SERIF}" font-size="${fontSize}" font-weight="700" fill="${PAGE.green}">${tspans}</text>
  <rect x="${PAGE.textLeft}" y="${PAGE.dividerY}" width="420" height="1.5" fill="${PAGE.green}" opacity="0.45"/>
  <image x="${PAGE.textLeft}" y="${PAGE.dividerY + 24}" width="114" height="117" href="${logoDataUri()}" xlink:href="${logoDataUri()}"/>
  <text font-family="${SERIF}" font-size="34" font-weight="700" fill="${PAGE.green}">
    <tspan x="${PAGE.textLeft + 136}" y="${PAGE.dividerY + 76}">Olivia&apos;s Garden</tspan>
    <tspan x="${PAGE.textLeft + 136}" y="${PAGE.dividerY + 116}">Foundation</tspan>
  </text>
</svg>`;
}

/**
 * style "guide" (default): the okra guide card. style "page": the main-site
 * card style from #428.
 */
export async function renderSocialCard({ photoPath, headline, outPath, style = 'guide' }) {
  const panelWidth = style === 'page' ? PAGE.panelWidth : PANEL_WIDTH;
  const background = style === 'page' ? PAGE.cream : COLORS.cream;
  const panelSvg = style === 'page' ? buildPagePanelSvg(headline) : buildPanelSvg(headline);
  const photo = await sharp(photoPath)
    .resize(WIDTH - panelWidth, HEIGHT, { fit: 'cover', position: 'attention' })
    .toBuffer();

  const card = sharp({
    create: { width: WIDTH, height: HEIGHT, channels: 3, background },
  }).composite([
    { input: photo, left: panelWidth, top: 0 },
    { input: Buffer.from(panelSvg), left: 0, top: 0 },
  ]);

  await mkdir(dirname(outPath), { recursive: true });
  const extension = extname(outPath).toLowerCase();
  if (extension === '.png') {
    // Palette PNG keeps photo cards well under 1 MB without visible banding.
    await card.png({ compressionLevel: 9, palette: true, quality: 90, effort: 10 }).toFile(outPath);
  } else {
    await card.jpeg({ quality: 86, mozjpeg: true }).toFile(outPath);
  }
}

async function renderPageCard() {
  const photoSrc = readArg('photo');
  const headline = readArg('headline');
  const outSrc = readArg('out');
  if (!photoSrc || !headline || !outSrc) {
    console.error('Usage: npm run social:page -- --photo=/images/... --headline="..." --out=/images/social/<page>.png');
    process.exit(1);
  }
  const photoPath = join(publicDir, photoSrc.replace(/^\/+/, ''));
  if (!existsSync(photoPath)) {
    console.error(`Photo not found: ${photoPath}`);
    process.exit(1);
  }
  const outPath = join(publicDir, outSrc.replace(/^\/+/, ''));
  await renderSocialCard({ photoPath, headline, outPath, style: 'page' });
  console.log(`generate-guide-social-card: wrote ${outPath}`);
  console.log('\nSet seoImage and seoImageAlt for the page in src/site/routes.ts and scripts/seo-data.mjs, then open the image and check it reads at small sizes.');
}

async function main() {
  if (readArg('style') === 'page') {
    await renderPageCard();
    return;
  }

  const slug = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
  if (!slug) {
    console.error('Usage: npm run social:guide -- <slug> [--headline="..."] [--photo=/images/...]');
    process.exit(1);
  }

  const guideFile = join(guidesContentDir(), `${slug}.json`);
  if (!existsSync(guideFile)) {
    console.error(`No guide found at ${guideFile}`);
    process.exit(1);
  }
  const guide = JSON.parse(readFileSync(guideFile, 'utf8'));

  const photoSrc = readArg('photo') ?? guide.heroImage?.src;
  if (!photoSrc) {
    console.error('The guide has no heroImage.src; add its photo first or pass --photo=/images/...');
    process.exit(1);
  }
  const photoPath = join(publicDir, photoSrc.replace(/^\/+/, ''));
  if (!existsSync(photoPath)) {
    console.error(`Photo not found: ${photoPath}`);
    process.exit(1);
  }

  const headline = readArg('headline') ?? guide.title;
  const outSrc = guide.socialImage?.src ?? `/images/social/okra-guides/${slug}.jpg`;
  const outPath = join(publicDir, outSrc.replace(/^\/+/, ''));

  await renderSocialCard({ photoPath, headline, outPath });
  console.log(`generate-guide-social-card: wrote ${outPath}`);

  if (!guide.socialImage?.src) {
    console.log('\nAdd this to the guide JSON:');
    console.log(JSON.stringify({ socialImage: { src: outSrc, alt: `${headline}: a guide from Olivia's Garden Foundation, with a photo of ...` } }, null, 2));
  }
  console.log('\nOpen the image and check it reads at a glance at small sizes before committing.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error('generate-guide-social-card failed:', error);
    process.exit(1);
  });
}
