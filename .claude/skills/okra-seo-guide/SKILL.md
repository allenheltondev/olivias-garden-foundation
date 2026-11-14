---
name: okra-seo-guide
description: Write, update, or publish an okra growing guide page (/okra/<slug>) for the Okra SEO epic (#413) — e.g. "how to grow okra", "when to plant okra", "free okra seeds", harvesting, seed saving, pests. Covers search intent, the guide JSON format, the required page-specific hero photo and 1200x630 social card, the human-review gate, validation, and publishing. Use whenever creating or changing anything in apps/web/src/site/okra-guides/content.
---

# Okra SEO guide

Guides are JSON files in `apps/web/src/site/okra-guides/content/<slug>.json`.
Read `apps/web/src/site/okra-guides/README.md` for the full format. Routing,
prerender, structured data, sitemap, `llms.txt`, and the `/okra` hub list are
all automatic. Start from the guide's sub-issue under epic #413: it lists the
target searches, an outline, and the done-when checklist.

The goal of every guide is to be **the most useful answer to a specific search**,
and to turn that reader into someone who requests seeds, grows okra and adds a
pin to the map.

## What to focus on

### 1. Answer the search immediately
- Pick the primary query from the issue and put it in `targetQueries`, with a few close variants.
- `title` is the plain answer to the query ("How to grow okra"). `seoTitle` can add a specific hook ("How to Grow Okra: A Hot-Summer Guide"). Keep it at 60 characters or fewer.
- `summary`, the line under the h1, answers the question in 1–2 sentences. A reader who stops there should still leave with the answer.
- `description` (70–160 characters) is the search-result snippet. Make it concrete and specific to this page, not generic.
- Section titles should match how people phrase the sub-questions ("When to pick okra", not "Harvest considerations").
- FAQ questions should be real searches, phrased the way people type them. Answer each in 1–3 sentences.

### 2. Every page gets its own images (required)
The build fails for a published guide without these, but get them right, not just passing:
- **Hero photo**, `heroImage`: a real photo that shows this guide's subject (pods at picking size for harvest, a seedling for planting). Prefer the foundation's own garden photos.
  - Put it at `public/images/okra/guides/<slug>/<what-it-shows>.jpg`, then run `npm --workspace @olivias/web run images:generate`.
  - Alt text describes the scene in one sentence ("Okra pods about three inches long, ready to pick"), not "image of okra".
  - **If no suitable photo exists, stop and ask the user for one.** Don't reuse another guide's photo, the Okra page's photo of Olivia, stock photos, or AI-generated images presented as the garden.
- **Social card**, `socialImage`: unique to this page and exactly 1200×630.
  - Generate it: `npm --workspace @olivias/web run social:guide -- <slug> --headline="3-7 words"`.
  - **Open the generated image and look at it.** Check the headline is short and reads at phone size, the photo crop shows the subject, and nothing important is cut off. Adjust `--headline` or `--photo` and regenerate if needed.
  - Never point it at `/images/home/og-image.png` or at another guide's card.
  - Its alt text describes the card ("How to grow okra card with a photo of okra in bloom").
- In-body `image` blocks follow the same filename and alt rules. Use them where a picture answers the question better than text (pod size, pest damage).

### 3. First-hand, accurate, and reviewed
- Refer to Olivia by her first name only. Never use her surname, anywhere on the site.
- Ground advice in the foundation's real experience growing okra in McKinney, North Texas, and say so where it helps. Never invent anecdotes, quotes, harvest numbers, or family stories. If the issue calls for one, ask the user.
- Check facts that vary by region or carry risk (planting dates, soil temperatures, canning and food safety, pest treatments) against extension sources, such as Texas A&M AgriLife or the National Center for Home Food Preservation. Link the source where it helps the reader.
- Seed program facts must match the live service: one packet of **10 Clemson Spineless** seeds, mailed within the **US and Canada**, with in-person pickup near McKinney. Check `apps/web/src/site/faq-content.json` if unsure.
- **Leave `"status": "draft"` and don't fill in `review` yourself.** A person must review growing advice before it ships. When the draft is ready, tell the user it needs review, and set `review`, `status: "published"` and the dates only once they confirm who reviewed it and when.

### 4. Link the cluster together
- Link to sibling guides inline where the topic comes up, for example `[when to plant](/okra/when-to-plant-okra)`, and list the closest 2–3 in `related`.
- When publishing, also add this guide to the `related` list of the guides it relates to, so links go both ways.
- Published guides can't link to drafts; the build fails if they do. Link only to guides that are already published.
- Don't hand-write a seed request call to action; the template adds one at the top and bottom. A natural inline mention linking to `/okra` is fine.

### 5. Write for people
- Plain, warm, specific language. Short paragraphs, lists for steps, and a `table` for anything regional or comparative.
- No keyword stuffing, filler intros ("Okra is a popular vegetable..."), or "In conclusion" endings.
- Follow `AGENTS.md`: no eyebrow labels, restrained headings, and human language over jargon.
- Sensible length: as long as it takes to answer fully. Usually 800–1,800 words for a main guide, and less for a narrow one.

## Workflow checklist

1. Read the sub-issue and `apps/web/src/site/okra-guides/README.md`.
2. Draft `content/<slug>.json` with `"status": "draft"`.
3. Add the hero photo (or ask for one), run `images:generate`, generate the social card, and look at it.
4. Run `npm --workspace @olivias/web run validate:guides`. Fix every warning for this guide, not just errors.
5. Preview with `npm --workspace @olivias/web run dev` at `/okra/<slug>`: desktop and a 390px-wide phone. Check that the seed button opens the form.
6. Run `npm --workspace @olivias/web test` and `npm --workspace @olivias/web run build`.
7. Ask the user for review. After they confirm, publish (status, review, dates), update reciprocal `related` links, and rebuild.
8. Commit the JSON, hero photo, responsive variants and social card together. Note in the PR which searches the guide targets.
9. After deploy, remind the user to request indexing for the new URL in Search Console (#415) and to check the card in a share debugger.

## Updating an existing guide
Bump `dateModified` (it drives the sitemap's `lastmod`) only for meaningful content changes, not typo fixes. Re-run the social card generator only if the title or photo changed. Substantive changes to advice need review again: update `review.reviewedOn` once the user confirms.
