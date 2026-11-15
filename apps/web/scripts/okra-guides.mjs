// Node-side loader and validator for okra growing guides.
//
// Guide content: src/site/okra-guides/content/<slug>.json (format in
// src/site/okra-guides/README.md). This file reads those JSON files for the
// build scripts (prerender, sitemap, llms.txt, drift check) and for the Vite
// plugin that exposes guide metadata to the app.
//
// Drafts are excluded unless VITE_INCLUDE_DRAFT_GUIDES=true (or the Vite dev
// server is running). Included drafts are always noindex and never listed
// in the sitemap.
//
// OKRA_GUIDES_CONTENT_DIR overrides the content directory (used by tests).

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectGuideLinks,
  collectGuideTexts,
  parseInline,
  guidePath,
  isInternalHref,
  RESERVED_GUIDE_SLUGS,
  sortGuides,
} from '../src/site/okra-guides/guide-core.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const appRoot = resolve(__dirname, '..');
export const publicDir = join(appRoot, 'public');
export const defaultGuidesContentDir = join(appRoot, 'src', 'site', 'okra-guides', 'content');

export const SOCIAL_IMAGE_WIDTH = 1200;
export const SOCIAL_IMAGE_HEIGHT = 630;
const SOCIAL_IMAGE_SOFT_MAX_BYTES = 1024 * 1024;
const SOCIAL_IMAGE_HARD_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_SOCIAL_IMAGE = '/images/home/og-image.png';

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const BLOCK_TYPES = new Set(['paragraph', 'list', 'tip', 'table', 'image', 'zoneLookup']);
const HARDINESS_ZONES = Array.from({ length: 13 }, (_, index) => index + 1);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const SOCIAL_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png']);
// Camera/phone defaults and other filenames that say nothing about the image.
const GENERIC_FILENAME_PATTERN = /^(img|dsc|dscn|pxl|photo|image|screenshot|untitled|final|copy)[-_]?\d*|^\d+$/i;

export function guidesContentDir() {
  return process.env.OKRA_GUIDES_CONTENT_DIR
    ? resolve(process.env.OKRA_GUIDES_CONTENT_DIR)
    : defaultGuidesContentDir;
}

export function shouldIncludeDrafts() {
  return process.env.VITE_INCLUDE_DRAFT_GUIDES === 'true';
}

/** Reads every guide JSON file. Throws on unreadable or malformed JSON. */
export function readGuideFiles(dir = guidesContentDir()) {
  if (!existsSync(dir)) {
    return [];
  }

  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const file = join(dir, name);
      try {
        return { file, guide: JSON.parse(readFileSync(file, 'utf8')) };
      } catch (error) {
        throw new Error(`Okra guide ${name} is not valid JSON: ${error.message}`);
      }
    });
}

export function loadOkraGuides({ dir = guidesContentDir(), includeDrafts = shouldIncludeDrafts() } = {}) {
  const guides = readGuideFiles(dir)
    .map(({ guide }) => guide)
    .filter((guide) => includeDrafts || guide.status === 'published');
  return sortGuides(guides);
}

// --- Validation ------------------------------------------------------------

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function publicFilePath(src, root) {
  return join(root, src.replace(/^\/+/, ''));
}

function checkDescriptiveFilename(src, report, label) {
  const name = basename(src, extname(src));
  if (GENERIC_FILENAME_PATTERN.test(name) || !/[a-z]+-[a-z]+/.test(name)) {
    report(`${label} filename "${basename(src)}" should describe the image in kebab-case words (e.g. okra-pods-ready-to-harvest.jpg).`);
  }
}

function checkAltText(image, report, label) {
  if (!isNonEmptyString(image.alt)) {
    report(`${label} needs alt text that describes what is in the image.`);
    return;
  }
  const alt = image.alt.trim();
  if (alt.length < 20) {
    report(`${label} alt text is too short to be useful (${alt.length} characters): "${alt}".`);
  }
  if (alt.length > 180) {
    report(`${label} alt text is over 180 characters; keep it to a sentence.`);
  }
  if (/\.(jpe?g|png|webp|avif)$/i.test(alt) || /^(image|photo|picture) of\b/i.test(alt)) {
    report(`${label} alt text should describe the scene, not the file ("${alt}").`);
  }
}

/**
 * Validates every guide file. Returns { errors, warnings } as arrays of
 * strings prefixed with the guide's filename.
 *
 * Structural problems are always errors. Content-quality and publishing
 * requirements (images, review, dates, links) are errors for published
 * guides and warnings for drafts, so drafts can be worked on incrementally.
 */
export async function validateOkraGuides(entries, { root = publicDir, knownPaths = [], sharp } = {}) {
  const errors = [];
  const warnings = [];
  const sharpLib = sharp ?? (await import('sharp')).default;

  const slugs = new Map();
  for (const { file, guide } of entries) {
    if (guide && typeof guide.slug === 'string') {
      slugs.set(guide.slug, guide);
    }
  }

  const socialImageOwners = new Map();
  const knownPathSet = new Set([...knownPaths, ...[...slugs.keys()].map(guidePath)]);

  for (const { file, guide } of entries) {
    const name = basename(file);
    const structural = (message) => errors.push(`${name}: ${message}`);
    const isPublished = guide?.status === 'published';
    const publishing = (message) => (isPublished ? errors : warnings).push(`${name}: ${message}`);
    const advisory = (message) => warnings.push(`${name}: ${message}`);

    if (!guide || typeof guide !== 'object' || Array.isArray(guide)) {
      structural('must contain a JSON object.');
      continue;
    }

    // Identity
    if (!isNonEmptyString(guide.slug) || !SLUG_PATTERN.test(guide.slug)) {
      structural('slug must be lowercase kebab-case (e.g. "how-to-grow-okra").');
    } else {
      if (basename(file, '.json') !== guide.slug) {
        structural(`filename must match slug ("${guide.slug}.json").`);
      }
      if (RESERVED_GUIDE_SLUGS.includes(guide.slug)) {
        structural(`slug "${guide.slug}" collides with an existing /okra route.`);
      }
    }
    if (guide.status !== 'draft' && guide.status !== 'published') {
      structural('status must be "draft" or "published".');
    }

    // Copy
    if (!isNonEmptyString(guide.title)) {
      structural('title is required (it is the page h1).');
    }
    const headline = guide.seoTitle ?? guide.title ?? '';
    if (headline.length > 60) {
      advisory(`seoTitle/title is ${headline.length} characters; search results usually cut off around 60.`);
    }
    if (!isNonEmptyString(guide.description)) {
      structural('description is required (it is the meta description).');
    } else if (guide.description.length < 70 || guide.description.length > 160) {
      publishing(`description is ${guide.description.length} characters; keep it between 70 and 160.`);
    }
    if (guide.showInFooter !== undefined && typeof guide.showInFooter !== 'boolean') {
      structural('showInFooter must be true or false.');
    }
    if (guide.seedCallToAction !== undefined && !['callout', 'hero'].includes(guide.seedCallToAction)) {
      structural('seedCallToAction must be "callout" or "hero".');
    }
    if (!isNonEmptyString(guide.summary)) {
      structural('summary is required (it is the short paragraph under the h1).');
    }
    if (!Array.isArray(guide.intro) || guide.intro.length === 0 || !guide.intro.every(isNonEmptyString)) {
      structural('intro must be a non-empty array of paragraphs.');
    }
    if (isPublished && (!Array.isArray(guide.targetQueries) || guide.targetQueries.length === 0)) {
      advisory('targetQueries is empty; list the searches this guide is meant to answer.');
    }

    // Sections and blocks
    if (!Array.isArray(guide.sections) || guide.sections.length === 0) {
      structural('sections must be a non-empty array.');
    } else {
      const sectionIds = new Set();
      guide.sections.forEach((section, index) => {
        const where = `sections[${index}]`;
        if (!isNonEmptyString(section?.id) || !SLUG_PATTERN.test(section.id)) {
          structural(`${where}.id must be kebab-case (it becomes the #anchor).`);
        } else if (sectionIds.has(section.id) || section.id === 'faq') {
          structural(`${where}.id "${section.id}" is duplicated or reserved.`);
        } else {
          sectionIds.add(section.id);
        }
        if (!isNonEmptyString(section?.title)) {
          structural(`${where}.title is required.`);
        }
        if (section?.placement !== undefined && !['main', 'aside'].includes(section.placement)) {
          structural(`${where}.placement must be "main" or "aside".`);
        }
        if (!Array.isArray(section?.blocks) || section.blocks.length === 0) {
          structural(`${where}.blocks must be a non-empty array.`);
          return;
        }
        section.blocks.forEach((block, blockIndex) => {
          const blockWhere = `${where}.blocks[${blockIndex}]`;
          if (!BLOCK_TYPES.has(block?.type)) {
            structural(`${blockWhere}.type must be one of ${[...BLOCK_TYPES].join(', ')}.`);
            return;
          }
          if ((block.type === 'paragraph' || block.type === 'tip') && !isNonEmptyString(block.text)) {
            structural(`${blockWhere}.text is required.`);
          }
          if (block.type === 'list' && (!Array.isArray(block.items) || block.items.length === 0 || !block.items.every(isNonEmptyString))) {
            structural(`${blockWhere}.items must be a non-empty array of strings.`);
          }
          if (block.type === 'table') {
            const width = Array.isArray(block.headers) ? block.headers.length : 0;
            if (width === 0 || !Array.isArray(block.rows) || block.rows.length === 0 || !block.rows.every((row) => Array.isArray(row) && row.length === width)) {
              structural(`${blockWhere} needs headers and rows with the same number of cells.`);
            }
          }
          if (block.type === 'zoneLookup') {
            if (!Array.isArray(block.rows) || block.rows.length === 0) {
              structural(`${blockWhere}.rows must be a non-empty array.`);
            } else {
              const covered = new Map();
              block.rows.forEach((row, rowIndex) => {
                const rowWhere = `${blockWhere}.rows[${rowIndex}]`;
                if (!Array.isArray(row?.zones) || row.zones.length === 0 || !row.zones.every((zone) => HARDINESS_ZONES.includes(zone))) {
                  structural(`${rowWhere}.zones must be a non-empty array of whole zone numbers from 1 to 13.`);
                } else {
                  for (const zone of row.zones) covered.set(zone, (covered.get(zone) ?? 0) + 1);
                }
                if (!isNonEmptyString(row?.lastFrost) || !isNonEmptyString(row?.plant)) {
                  structural(`${rowWhere} needs lastFrost and plant text.`);
                }
              });
              // Every zone needs exactly one answer, or some ZIP codes would get none.
              const missing = HARDINESS_ZONES.filter((zone) => !covered.has(zone));
              const repeated = HARDINESS_ZONES.filter((zone) => (covered.get(zone) ?? 0) > 1);
              if (missing.length > 0) structural(`${blockWhere} has no row for zone ${missing.join(', ')}.`);
              if (repeated.length > 0) structural(`${blockWhere} covers zone ${repeated.join(', ')} more than once.`);
            }
          }
          if (block.type === 'image') {
            if (!isNonEmptyString(block.src)) {
              structural(`${blockWhere}.src is required.`);
            } else {
              if (!existsSync(publicFilePath(block.src, root))) {
                publishing(`${blockWhere}.src ${block.src} does not exist under public/.`);
              }
              checkDescriptiveFilename(block.src, publishing, `${blockWhere} image`);
            }
            checkAltText(block, publishing, `${blockWhere} image`);
          }
        });
      });
    }

    // FAQ
    if (guide.faq !== undefined) {
      if (!Array.isArray(guide.faq)) {
        structural('faq must be an array.');
      } else {
        guide.faq.forEach((item, index) => {
          if (!isNonEmptyString(item?.question) || !item.question.trim().endsWith('?')) {
            structural(`faq[${index}].question must be a question ending in "?".`);
          }
          if (!isNonEmptyString(item?.answer)) {
            structural(`faq[${index}].answer is required.`);
          }
        });
      }
    }

    // Dates and review
    if (!ISO_DATE_PATTERN.test(guide.datePublished ?? '')) {
      publishing('datePublished must be YYYY-MM-DD.');
    }
    if (guide.dateModified !== undefined) {
      if (!ISO_DATE_PATTERN.test(guide.dateModified)) {
        publishing('dateModified must be YYYY-MM-DD.');
      } else if (ISO_DATE_PATTERN.test(guide.datePublished ?? '') && guide.dateModified < guide.datePublished) {
        publishing('dateModified is earlier than datePublished.');
      }
    }
    if (!isNonEmptyString(guide.review?.reviewedBy) || !ISO_DATE_PATTERN.test(guide.review?.reviewedOn ?? '')) {
      publishing('review.reviewedBy and review.reviewedOn (YYYY-MM-DD) are required: a person must review growing advice before it is published.');
    }

    // Page-specific hero image
    if (!guide.heroImage || !isNonEmptyString(guide.heroImage.src)) {
      publishing('heroImage.src is required: every guide needs its own photo.');
    } else {
      const heroPath = publicFilePath(guide.heroImage.src, root);
      if (!IMAGE_EXTENSIONS.has(extname(guide.heroImage.src).toLowerCase())) {
        publishing(`heroImage must be a .jpg, .png, or .webp file (got ${guide.heroImage.src}).`);
      }
      if (!existsSync(heroPath)) {
        publishing(`heroImage ${guide.heroImage.src} does not exist under public/.`);
      }
      checkDescriptiveFilename(guide.heroImage.src, publishing, 'heroImage');
      checkAltText(guide.heroImage, publishing, 'heroImage');
    }

    // Page-specific social card (og:image / twitter:image)
    if (!guide.socialImage || !isNonEmptyString(guide.socialImage.src)) {
      publishing(`socialImage.src is required: create a ${SOCIAL_IMAGE_WIDTH}x${SOCIAL_IMAGE_HEIGHT} card for this guide (npm run social:guide -- ${guide.slug ?? '<slug>'}).`);
    } else {
      const src = guide.socialImage.src;
      const socialPath = publicFilePath(src, root);
      checkAltText(guide.socialImage, publishing, 'socialImage');
      if (src === DEFAULT_SOCIAL_IMAGE) {
        publishing('socialImage must be specific to this guide, not the site-wide default card.');
      }
      if (socialImageOwners.has(src)) {
        publishing(`socialImage ${src} is already used by ${socialImageOwners.get(src)}; each guide needs its own card.`);
      } else {
        socialImageOwners.set(src, name);
      }
      if (!SOCIAL_EXTENSIONS.has(extname(src).toLowerCase())) {
        publishing(`socialImage must be .png or .jpg (social platforms don't reliably show ${extname(src)}).`);
      }
      if (!existsSync(socialPath)) {
        publishing(`socialImage ${src} does not exist under public/. Generate it with: npm run social:guide -- ${guide.slug}`);
      } else {
        const bytes = statSync(socialPath).size;
        if (bytes > SOCIAL_IMAGE_HARD_MAX_BYTES) {
          publishing(`socialImage is ${(bytes / 1024 / 1024).toFixed(1)} MB; some platforms reject cards over 5 MB.`);
        } else if (bytes > SOCIAL_IMAGE_SOFT_MAX_BYTES) {
          advisory(`socialImage is ${(bytes / 1024 / 1024).toFixed(1)} MB; aim for under 1 MB.`);
        }
        try {
          const { width, height } = await sharpLib(socialPath).metadata();
          if (width !== SOCIAL_IMAGE_WIDTH || height !== SOCIAL_IMAGE_HEIGHT) {
            publishing(`socialImage is ${width}x${height}; it must be exactly ${SOCIAL_IMAGE_WIDTH}x${SOCIAL_IMAGE_HEIGHT}.`);
          }
        } catch (error) {
          publishing(`socialImage could not be read: ${error.message}`);
        }
      }
    }

    // Related guides
    if (guide.related !== undefined) {
      if (!Array.isArray(guide.related)) {
        structural('related must be an array of guide slugs.');
      } else {
        for (const slug of guide.related) {
          const target = slugs.get(slug);
          if (!target) {
            publishing(`related guide "${slug}" does not exist.`);
          } else if (slug === guide.slug) {
            structural('related must not include the guide itself.');
          } else if (isPublished && target.status !== 'published') {
            errors.push(`${name}: related guide "${slug}" is still a draft; it would be a broken link in production.`);
          }
        }
      }
    }

    // Inline links
    if (Array.isArray(guide.intro) && Array.isArray(guide.sections)) {
      // House style: no semicolons in prose, and no decorative bold.
      const styleTexts = [
        guide.title,
        guide.description,
        ...collectGuideTexts(guide),
        ...(Array.isArray(guide.faq) ? guide.faq.map((item) => item?.question ?? '') : []),
      ].filter((text) => typeof text === 'string');
      if (styleTexts.some((text) => text.includes(';'))) {
        advisory('uses a semicolon. House style is two sentences instead.');
      }
      if (styleTexts.some((text) => text.includes('**'))) {
        advisory('uses **bold**. House style avoids decorative bold.');
      }
      // Markup can't nest: a link inside **bold** renders as raw "[text](href)".
      for (const text of collectGuideTexts(guide)) {
        for (const token of parseInline(text)) {
          if (token.type === 'strong' && /\[[^\]]+\]\([^)]+\)/.test(token.text)) {
            structural(`link inside bold text won't render: "**${token.text}**". Put the link outside the ** markers.`);
          }
        }
      }
      let links = [];
      try {
        links = collectGuideLinks(guide);
      } catch {
        links = [];
      }
      for (const href of links) {
        if (isInternalHref(href)) {
          const path = href.split('#')[0].split('?')[0].replace(/\/+$/, '') || '/';
          if (!knownPathSet.has(path)) {
            publishing(`internal link ${href} does not match a known page.`);
          } else if (isPublished && path.startsWith('/okra/') && slugs.get(path.slice('/okra/'.length))?.status === 'draft') {
            errors.push(`${name}: link ${href} points at a draft guide.`);
          }
        } else if (!href.startsWith('#') && !/^https:\/\//.test(href) && !href.startsWith('mailto:')) {
          publishing(`link ${href} must be an internal path, #anchor, https:// URL, or mailto:.`);
        }
      }
    }
  }

  return { errors, warnings };
}
