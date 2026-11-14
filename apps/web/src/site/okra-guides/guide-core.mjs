// Shared, dependency-free logic for okra growing guides.
//
// This module is imported from two places and must stay runnable in both:
//   - the React app (via Vite), for rendering and runtime JSON-LD
//   - Node build scripts (prerender, sitemap, drift check, validation)
// so it must not touch the filesystem, the DOM, or import.meta.env.
// Types live in guide-core.d.mts.
//
// Guide content lives in ./content/<slug>.json. See ./README.md.

export const OKRA_HUB_PATH = '/okra';
export const OKRA_HUB_TITLE = 'The Okra Project';
export const GUIDE_PATH_PREFIX = '/okra/';
export const ORGANIZATION_NAME = "Olivia's Garden Foundation";
export const TITLE_SUFFIX = ` | ${ORGANIZATION_NAME}`;

// Slugs that collide with existing /okra/* app routes.
export const RESERVED_GUIDE_SLUGS = ['submissions'];

export function guidePath(slug) {
  return `${GUIDE_PATH_PREFIX}${slug}`;
}

/**
 * Splits text with minimal inline markup into tokens.
 * Supported: [label](href) links and **bold**. Everything else is literal.
 */
export function parseInline(text) {
  const tokens = [];
  const pattern = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*/g;
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', text: text.slice(lastIndex, match.index) });
    }
    if (match[1] !== undefined) {
      tokens.push({ type: 'link', text: match[1], href: match[2] });
    } else {
      tokens.push({ type: 'strong', text: match[3] });
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    tokens.push({ type: 'text', text: text.slice(lastIndex) });
  }

  return tokens;
}

/** Plain text with inline markup removed (for JSON-LD and meta). */
export function stripInline(text) {
  return parseInline(text).map((token) => token.text).join('');
}

export function isInternalHref(href) {
  return href.startsWith('/') && !href.startsWith('//');
}

/** Every string in a guide that supports inline markup, in document order. */
export function collectGuideTexts(guide) {
  return [
    guide.summary,
    ...guide.intro,
    ...guide.sections.flatMap((section) => (section.blocks ?? []).flatMap(blockTexts)),
    ...(guide.faq ?? []).map((item) => item.answer),
  ].filter((text) => typeof text === 'string' && text.length > 0);
}

/** Every href used in a guide's inline text, in document order. */
export function collectGuideLinks(guide) {
  return collectGuideTexts(guide)
    .flatMap((text) => parseInline(text))
    .filter((token) => token.type === 'link')
    .map((token) => token.href);
}

function blockTexts(block) {
  switch (block.type) {
    case 'paragraph':
      return [block.text];
    case 'list':
      return block.items;
    case 'tip':
      return [block.title ?? '', block.text];
    case 'table':
      return [...block.headers, ...block.rows.flat()];
    case 'image':
      return [block.caption ?? ''];
    default:
      return [];
  }
}

function absoluteUrl(siteUrl, path) {
  return path.startsWith('http://') || path.startsWith('https://') ? path : `${siteUrl}${path}`;
}

export function guidePageTitle(guide) {
  return `${guide.seoTitle ?? guide.title}${TITLE_SUFFIX}`;
}

/** Route metadata shared by routes.ts (runtime) and seo-data.mjs (build). */
export function guideRouteMeta(guide) {
  return {
    path: guidePath(guide.slug),
    label: guide.title,
    title: guide.seoTitle ?? guide.title,
    description: guide.description,
    seoImage: guide.socialImage?.src,
    seoImageAlt: guide.socialImage?.alt,
    ogType: 'article',
    // Drafts can be previewed (dev server or VITE_INCLUDE_DRAFT_GUIDES) but
    // must never be indexed.
    allowIndex: guide.status === 'published',
    prerender: true,
  };
}

/** The slim, bundle-friendly summary used for routing and guide lists. */
export function guideSummary(guide) {
  return {
    slug: guide.slug,
    status: guide.status,
    title: guide.title,
    seoTitle: guide.seoTitle,
    description: guide.description,
    summary: guide.summary,
    heroImage: guide.heroImage,
    socialImage: guide.socialImage,
    datePublished: guide.datePublished,
    dateModified: guide.dateModified,
    order: guide.order ?? 100,
    seedCallToAction: guide.seedCallToAction ?? 'callout',
  };
}

export function sortGuides(guides) {
  return [...guides].sort((left, right) => (left.order ?? 100) - (right.order ?? 100) || left.title.localeCompare(right.title));
}

// --- Structured data -------------------------------------------------------

export function buildGuideArticleJsonLd(guide, siteUrl) {
  const url = absoluteUrl(siteUrl, guidePath(guide.slug));
  const images = [guide.heroImage?.src, guide.socialImage?.src]
    .filter(Boolean)
    .map((src) => absoluteUrl(siteUrl, src));
  const organizationRef = { '@id': `${siteUrl}/#organization` };

  const article = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    '@id': `${url}#article`,
    headline: guide.seoTitle ?? guide.title,
    description: guide.description,
    url,
    mainEntityOfPage: url,
    inLanguage: 'en-US',
    datePublished: guide.datePublished,
    dateModified: guide.dateModified ?? guide.datePublished,
    author: { '@type': 'Organization', name: ORGANIZATION_NAME, url: siteUrl, ...organizationRef },
    publisher: { '@type': 'Organization', name: ORGANIZATION_NAME, url: siteUrl, ...organizationRef },
    about: { '@type': 'Thing', name: 'Okra', sameAs: 'https://en.wikipedia.org/wiki/Okra' },
    isPartOf: { '@type': 'CollectionPage', name: OKRA_HUB_TITLE, url: absoluteUrl(siteUrl, OKRA_HUB_PATH) },
  };

  if (images.length > 0) {
    article.image = images;
  }

  return article;
}

export function buildGuideBreadcrumbJsonLd(guide, siteUrl) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: absoluteUrl(siteUrl, '/') },
      { '@type': 'ListItem', position: 2, name: OKRA_HUB_TITLE, item: absoluteUrl(siteUrl, OKRA_HUB_PATH) },
      { '@type': 'ListItem', position: 3, name: guide.title, item: absoluteUrl(siteUrl, guidePath(guide.slug)) },
    ],
  };
}

export function buildGuideFaqJsonLd(guide) {
  if (!guide.faq || guide.faq.length === 0) {
    return null;
  }

  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: guide.faq.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: stripInline(item.answer) },
    })),
  };
}

/** All page-specific JSON-LD blocks, keyed by the data-seo-id they use. */
export function buildGuideJsonLdBlocks(guide, siteUrl) {
  const blocks = [
    { id: 'okra-guide-article', data: buildGuideArticleJsonLd(guide, siteUrl) },
    { id: 'okra-guide-breadcrumbs', data: buildGuideBreadcrumbJsonLd(guide, siteUrl) },
  ];
  const faq = buildGuideFaqJsonLd(guide);
  if (faq) {
    blocks.push({ id: 'okra-guide-faq', data: faq });
  }
  return blocks;
}

// --- Static HTML (noscript fallback for non-JS crawlers) -------------------

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function inlineToHtml(text) {
  return parseInline(text)
    .map((token) => {
      if (token.type === 'link') {
        return `<a href="${escapeHtml(token.href)}">${escapeHtml(token.text)}</a>`;
      }
      if (token.type === 'strong') {
        return `<strong>${escapeHtml(token.text)}</strong>`;
      }
      return escapeHtml(token.text);
    })
    .join('');
}

function blockToHtml(block) {
  switch (block.type) {
    case 'paragraph':
      return `<p>${inlineToHtml(block.text)}</p>`;
    case 'list': {
      const tag = block.ordered ? 'ol' : 'ul';
      return `<${tag}>${block.items.map((item) => `<li>${inlineToHtml(item)}</li>`).join('')}</${tag}>`;
    }
    case 'tip':
      return `<aside>${block.title ? `<strong>${escapeHtml(block.title)}</strong> ` : ''}${inlineToHtml(block.text)}</aside>`;
    case 'table':
      return [
        '<table>',
        block.caption ? `<caption>${escapeHtml(block.caption)}</caption>` : '',
        `<thead><tr>${block.headers.map((header) => `<th scope="col">${inlineToHtml(header)}</th>`).join('')}</tr></thead>`,
        `<tbody>${block.rows.map((row) => `<tr>${row.map((cell) => `<td>${inlineToHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody>`,
        '</table>',
      ].join('');
    case 'image':
      return `<figure><img src="${escapeHtml(block.src)}" alt="${escapeHtml(block.alt)}" />${block.caption ? `<figcaption>${inlineToHtml(block.caption)}</figcaption>` : ''}</figure>`;
    default:
      return '';
  }
}

/**
 * Full guide text as plain HTML. Injected into the prerendered page inside
 * <noscript> so crawlers that don't run JS still read the whole guide.
 */
export function renderGuideFallbackHtml(guide, relatedGuides = []) {
  const parts = [
    `<h1>${escapeHtml(guide.title)}</h1>`,
    `<p>${inlineToHtml(guide.summary)}</p>`,
    guide.heroImage ? `<img src="${escapeHtml(guide.heroImage.src)}" alt="${escapeHtml(guide.heroImage.alt)}" />` : '',
    ...guide.intro.map((paragraph) => `<p>${inlineToHtml(paragraph)}</p>`),
    ...guide.sections.flatMap((section) => [
      `<h2 id="${escapeHtml(section.id)}">${escapeHtml(section.title)}</h2>`,
      ...section.blocks.map(blockToHtml),
    ]),
  ];

  if (guide.faq && guide.faq.length > 0) {
    parts.push('<h2 id="faq">Common questions</h2>');
    for (const item of guide.faq) {
      parts.push(`<h3>${escapeHtml(item.question)}</h3>`, `<p>${inlineToHtml(item.answer)}</p>`);
    }
  }

  parts.push(
    '<h2>Get free okra seeds</h2>',
    `<p>Olivia's Garden Foundation mails free okra seeds from Olivia's own seed line. <a href="${OKRA_HUB_PATH}">Request seeds and see the Okra Project map</a>.</p>`,
  );

  if (relatedGuides.length > 0) {
    parts.push(
      '<h2>Related okra guides</h2>',
      `<ul>${relatedGuides.map((related) => `<li><a href="${escapeHtml(guidePath(related.slug))}">${escapeHtml(related.title)}</a></li>`).join('')}</ul>`,
    );
  }

  return parts.filter(Boolean).map((part) => `      ${part}`).join('\n');
}

/** Hub list (used in the /okra noscript fallback and llms.txt). */
export function renderGuideListHtml(guides) {
  if (guides.length === 0) {
    return '';
  }

  return [
    '      <h2>Okra growing guides</h2>',
    `      <ul>${guides.map((guide) => `<li><a href="${escapeHtml(guidePath(guide.slug))}">${escapeHtml(guide.title)}</a> &mdash; ${escapeHtml(guide.description)}</li>`).join('')}</ul>`,
  ].join('\n');
}

/** Human-readable date like "November 14, 2026" from YYYY-MM-DD. */
export function formatGuideDate(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate ?? '');
  if (!match) {
    return isoDate ?? '';
  }
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${months[Number(match[2]) - 1]} ${Number(match[3])}, ${match[1]}`;
}
