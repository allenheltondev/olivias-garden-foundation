# Okra growing guides

Guide pages live at `/okra/<slug>`. Each guide is one JSON file in
[`content/`](./content), named `<slug>.json`. Adding a file is all it takes:
routing, the prerendered HTML, structured data, the sitemap, `llms.txt`, and
the guide list on `/okra` all come from that file. You don't need to edit
`routes.ts` or `seo-data.mjs`.

Strategy and the list of planned guides: epic #413.

## Workflow

1. Create `content/<slug>.json` with `"status": "draft"` (format below).
2. Add the hero photo under `public/images/okra/guides/<slug>/` with a
   descriptive kebab-case filename (`okra-pods-ready-to-harvest.jpg`), then
   `npm run images:generate` to build its responsive variants.
3. Create the page's social card:
   `npm --workspace @olivias/web run social:guide -- <slug> --headline="3-7 words"`.
   This writes a 1200x630 card from the hero photo. Open it and check it reads
   at small sizes. A designer can replace the file at the same path later.
4. Preview with `npm --workspace @olivias/web run dev`. Drafts show up on the
   dev server, marked "Draft: not indexed".
5. Get the growing advice reviewed by a person, then set `review`,
   `"status": "published"`, and the dates.
6. Run `npm --workspace @olivias/web run build`. It validates every guide and
   fails on problems (see below).

## Format

```jsonc
{
  "slug": "how-to-grow-okra",            // kebab-case; must match the filename
  "status": "draft",                     // "draft" | "published"
  "title": "How to grow okra",           // the h1 and the guide's name in lists
  "seoTitle": "How to Grow Okra: ...",   // optional <title>; " | Olivia's Garden Foundation" is appended
  "description": "70-160 characters...", // meta description; also shown in guide lists
  "summary": "One or two sentences under the h1 that answer the search directly.",
  "heroImage": { "src": "/images/okra/guides/how-to-grow-okra/okra-plant-in-bloom.jpg", "alt": "...", "caption": "optional" },
  "socialImage": { "src": "/images/social/okra-guides/how-to-grow-okra.jpg", "alt": "..." },
  "datePublished": "2026-12-01",
  "dateModified": "2026-12-01",          // optional; drives sitemap <lastmod> and Article dateModified
  "review": { "reviewedBy": "Name", "reviewedOn": "2026-12-01" },  // internal record only; never shown on the page
  "targetQueries": ["how to grow okra", "okra growing tips"],  // not rendered; documents search intent
  "related": ["when-to-plant-okra"],     // other guide slugs, shown under "Keep going"
  "order": 10,                           // sort order in guide lists (lower first)
  "seedCallToAction": "callout",         // optional: "callout" (box under the header, the default) or
                                         // "hero" (button under the summary, for short pages like free-okra-seeds)
  "intro": ["Paragraph", "Paragraph"],
  "sections": [
    {
      "id": "soil-and-sun",              // becomes the #anchor
      "title": "Soil and sun",
      "blocks": [
        { "type": "paragraph", "text": "Text with a [link](/okra/when-to-plant-okra) and **bold**." },
        { "type": "list", "items": ["...", "..."] },
        { "type": "list", "ordered": true, "items": ["Step one", "Step two"] },
        { "type": "tip", "title": "From Olivia's garden", "text": "..." },
        { "type": "table", "caption": "...", "headers": ["Region", "Plant"], "rows": [["North Texas", "Late April"]] },
        { "type": "image", "src": "/images/okra/guides/<slug>/....jpg", "alt": "...", "caption": "..." }
      ]
    }
  ],
  "faq": [{ "question": "Does okra need full sun?", "answer": "..." }]
}
```

Inline text supports only `[label](href)` links and `**bold**`. They can't be nested: put a link outside the `**` markers, or the build fails. Hrefs must be
internal paths (`/okra`, `/faq#growing-okra`), `#anchors`, `https://` URLs,
or `mailto:`.

The template adds these automatically, so don't write them into the content:
the free seed call to action (it opens the seed request form in place), the
"See where Olivia's okra is growing" link, related guide cards, the table of
contents (3+ sections), and Article,
BreadcrumbList and FAQPage structured data.

## Validation

`npm run validate:guides` runs first in `npm run build`. For **published**
guides these fail the build; for drafts they're warnings:

- No `heroImage`, a missing file, a non-descriptive filename (`IMG_1234.jpg`),
  or weak alt text
- No page-specific `socialImage`. It must exist, be exactly 1200x630 (.jpg or
  .png), not be the site-wide default card, and not be shared with another
  guide.
- No `review` (a person must review growing advice before it ships)
- Description outside 70-160 characters, or invalid dates
- Links to pages that don't exist, or to draft guides

Structural problems (bad slug, a filename that doesn't match the slug,
unknown block types, malformed FAQ) always fail.

## Drafts

Drafts are left out of production builds entirely. They're included on the
dev server and when `VITE_INCLUDE_DRAFT_GUIDES=true` (for a staging preview),
and even then they're `noindex` and never in the sitemap.

## Where the code is

- `guide-core.mjs`: shared logic (inline markup, JSON-LD, fallback HTML, route
  metadata) used by both the app and the build scripts
- `index.ts`: typed registry for the app (`virtual:okra-guides`)
- `../pages/OkraGuidePage.tsx`: the page template
- `scripts/okra-guides.mjs`: loader and validator
- `scripts/vite-plugin-okra-guides.mjs`: exposes guide metadata to the app
  eagerly and each guide's content as its own lazy chunk
- `scripts/generate-guide-social-card.mjs`: the social card generator
- Tests: `npm --workspace @olivias/web test` (fixtures in
  `scripts/__fixtures__/okra-guides`) and `tests/okra-guides.spec.ts`
  (Playwright, runs against every published guide)
