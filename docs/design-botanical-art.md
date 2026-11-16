# Good Roots botanical artwork

A modern botanical field-journal direction: clear silhouettes, fine dark olive line work, sage and moss greens, terracotta reds, warm ochre, and cream. Crop artwork is editable SVG; scenes use lightly textured gouache. No lettering is embedded in the art.

## Assets and usage

`apps/grn/public/images/botanical/crops/` contains twelve original vector illustrations: basil, broccoli, carrot, cucumber, kale, lettuce, onion, pea, pepper, radish, strawberry, and tomato. Each is an 80 by 80 transparent SVG, under 1 KB. They are used in plant records, seasonal suggestions, harvest timelines, and saved-harvest feedback. Unsupported crops and failed image loads use the existing silhouette system. Canvas markers and small utility icons retain their current graphics for legibility and performance.

`first-garden.webp` is an inviting raised bed with three seedlings, a terracotta pot, and a trowel. It appears in the empty Plants view and the getting-started checklist (the checklist omits it on small screens to keep the action close).

`neighbor-harvest.webp` shows two neighbors' hands offering and receiving a basket of produce. It appears beside the Share introduction. Neither scene is a photograph or user garden record.

Both scenes are 640 by 427 WebP with alpha, about 100 KB and 83 KB respectively. Explicit dimensions reserve space; assets load lazily. Scenes are decorative and removed if loading fails. Visible labels and actions work without images. Saved-harvest artwork has a single 240 ms entrance that is disabled with reduced motion.

## Generation and prompt set

The two scenes were generated using the built-in ImageGen tool, then resized and encoded as WebP with Sharp, preserving transparency. Original generated PNGs remain in the tool's generated-images folder. Project assets live under `apps/grn/public/images/botanical/`. The twelve SVGs were drawn directly as editable vector source, extending the app's existing graphic system.

Shared scene prompt: One production illustration for Good Roots Network, a warm professional gardening app. Modern botanical field-journal style: clean confident silhouettes, delicate ink detail, lightly textured gouache fills. Restrained moss and sage greens, terracotta, warm ochre, dark brown outlines. Mature editorial illustration, charming but not childish. No faces, mascot, lettering, logo, border, photography, or UI. Broad horizontal composition around 3:2, isolated vignette, organic edges, generous transparent padding, true transparent background. Legible around 260 pixels wide on cream. One cohesive scene, not a sprite sheet.

First garden subject prompt: An inviting small raised garden bed in gentle three-quarter perspective, rich brown soil, just three tiny seedlings and one modest terracotta pot with a young leafy plant beside it, a hand trowel leaning quietly against the bed. Tactile natural materials.

Neighbor harvest subject prompt: A modest woven basket holding two ripe red tomatoes, leafy kale, carrots with greens, and one pale yellow squash. A natural human hand and partial forearm from the left offers the basket; another hand and partial forearm from the right receives it. Only two hands, no full people. Neighborly generosity, believable anatomy, practical basket grip, recognizable vegetables. Natural warm medium and deep skin tones.

## Review

The crop contact sheet and generated scenes were visually inspected as image assets. Browser/phone layout review remains a separate verification step; the prior session did not have approved browser access. No stock photography or third-party illustration libraries were added.
