# Social share cards

Seven page-specific cards for issue #412 live in `apps/web/public/images/social/`.
Home, workshops, contact, transparency, and legal pages retain the default logo card.
Both `src/site/routes.ts` and `scripts/seo-data.mjs` select the page images, page-specific summaries, and artwork descriptions. Standard, Open Graph, and Twitter description tags use the page summary; both image alt tags describe the actual card artwork.

## Asset specifications

- PNG, 1200 × 630 pixels; each is under 1 MB.
- Cream background, garden-green serif headlines, and a small foundation wordmark.
- Created with the built-in image generation tool using existing brand, photo, icon, and app screenshot references. The okra card uses pods and a seed packet rather than a portrait.
- Output resized and PNG-optimized with Sharp; originals retained outside the repository.
- The donate card uses the current bee marker and should be reviewed when the annual marker changes.

## Validation

Run `npm --workspace @olivias/web test` for asset size, dimensions, format, and route parity checks.
Run the production build and `tests/seo.spec.ts` against a server that serves prerendered route HTML (Vite preview's SPA fallback does not emulate CloudFront's route rewrites).

After production deployment, submit `/okra`, `/donate`, `/about`, `/faq`, `/good-roots`, `/get-involved`, and `/impact` to Facebook Sharing Debugger or LinkedIn Post Inspector. Confirm the page-specific image and request a fresh scrape if an old logo card is cached. This external cache check is pending deployment; local HTML checks do not replace it.

## Generation prompts

Each prompt used the current `images/home/og-image.png` as the first reference. Additional references follow the issue brief, including `images/good-roots/app-garden-map.jpg` and the sunset photo for Good Roots.

### okra.png

```text
Use case: ads-marketing. Create one finished landscape social sharing card, aspect ratio 1200:630. Reference image 1 is the existing brand card for palette and serif typography only; remaining images are content references. Cream #f6f2e7 background, dark garden green #305526 large elegant bold serif headline at least 68px equivalent. Consistent editorial split composition: headline on cream left panel, subject image on right panel, generous breathing space. Keep all text inside central 1000 by 520px safe zone. Exact headline, line breaks flexible: "Free okra seeds
from Olivia's garden". Small wordmark below headline: "Olivia's Garden Foundation". No body copy or additional text. Create a botanical photograph of fresh green okra pods and a kraft seed packet on cream linen. Use only pods as reference from photo; do not include the child or any people. Finished polished restrained nonprofit brand design. Do not copy headline from brand reference.
```

### donate.png

```text
Use case: ads-marketing. Create one finished landscape social sharing card, aspect ratio 1200:630. Reference image 1 is the existing brand card for palette and serif typography only; remaining images are content references. Cream #f6f2e7 background, dark garden green #305526 large elegant bold serif headline at least 68px equivalent. Consistent editorial split composition: headline on cream left panel, subject image on right panel, generous breathing space. Keep all text inside central 1000 by 520px safe zone. Exact headline, line breaks flexible: "Plant something
permanent". Small wordmark below headline: "Olivia's Garden Foundation". No body copy or additional text. Use the actual orange bee garden marker in the reference photo on garden grass, retaining its real design and lettering. Finished polished restrained nonprofit brand design. Do not copy headline from brand reference.
```

### about.png

```text
Use case: ads-marketing. Create one finished landscape social sharing card, aspect ratio 1200:630. Reference image 1 is the existing brand card for palette and serif typography only; remaining images are content references. Cream #f6f2e7 background, dark garden green #305526 large elegant bold serif headline at least 68px equivalent. Consistent editorial split composition: headline on cream left panel, subject image on right panel, generous breathing space. Keep all text inside central 1000 by 520px safe zone. Exact headline, line breaks flexible: "Olivia's Garden:
the story". Small wordmark below headline: "Olivia's Garden Foundation". No body copy or additional text. Use the real sunset garden photograph unchanged in spirit, warm quiet memorial mood. Finished polished restrained nonprofit brand design. Do not copy headline from brand reference.
```

### faq.png

```text
Use case: ads-marketing. Create one finished landscape social sharing card, aspect ratio 1200:630. Reference image 1 is the existing brand card for palette and serif typography only; remaining images are content references. Cream #f6f2e7 background, dark garden green #305526 large elegant bold serif headline at least 68px equivalent. Consistent editorial split composition: headline on cream left panel, subject image on right panel, generous breathing space. Keep all text inside central 1000 by 520px safe zone. Exact headline, line breaks flexible: "Questions?
We've got answers.". Small wordmark below headline: "Olivia's Garden Foundation". No body copy or additional text. Simple typographic card with the reference seedling illustration on the right, cream background, no photographic scenery. Finished polished restrained nonprofit brand design. Do not copy headline from brand reference.
```

### good-roots.png

```text
Use case: ads-marketing. Create one finished landscape social sharing card, aspect ratio 1200:630. Reference image 1 is the existing brand card for palette and serif typography only; remaining images are content references. Cream #f6f2e7 background, dark garden green #305526 large elegant bold serif headline at least 68px equivalent. Consistent editorial split composition: headline on cream left panel, subject image on right panel, generous breathing space. Keep all text inside central 1000 by 520px safe zone. Exact headline, line breaks flexible: "Plan a garden you
can keep up with". Small wordmark below headline: "Olivia's Garden Foundation". No body copy or additional text. Show the supplied real app garden-map screenshot in a clean browser frame, next to a small portion of the real garden photo. Preserve the screenshot faithfully; do not invent app UI. Finished polished restrained nonprofit brand design. Do not copy headline from brand reference.
```

### get-involved.png

```text
Use case: ads-marketing. Create one finished landscape social sharing card, aspect ratio 1200:630. Reference image 1 is the existing brand card for palette and serif typography only; remaining images are content references. Cream #f6f2e7 background, dark garden green #305526 large elegant bold serif headline at least 68px equivalent. Consistent editorial split composition: headline on cream left panel, subject image on right panel, generous breathing space. Keep all text inside central 1000 by 520px safe zone. Exact headline, line breaks flexible: "Start where
you are". Small wordmark below headline: "Olivia's Garden Foundation". No body copy or additional text. Use the actual reference photograph of tending seedlings in a raised bed, focus on seedlings and hands. Finished polished restrained nonprofit brand design. Do not copy headline from brand reference.
```

### impact.png

```text
Use case: ads-marketing. Create one finished landscape social sharing card, aspect ratio 1200:630. Reference image 1 is the existing brand card for palette and serif typography only; remaining images are content references. Cream #f6f2e7 background, dark garden green #305526 large elegant bold serif headline at least 68px equivalent. Consistent editorial split composition: headline on cream left panel, subject image on right panel, generous breathing space. Keep all text inside central 1000 by 520px safe zone. Exact headline, line breaks flexible: "What we're
growing". Small wordmark below headline: "Olivia's Garden Foundation". No body copy or additional text. Use the real produce basket photograph, abundant garden vegetables, keep actual produce. Finished polished restrained nonprofit brand design. Do not copy headline from brand reference.
```

