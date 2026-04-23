# image-processing (shared, vendored)

Source-of-truth for the shared image resize/encode helper used by the
okra and web APIs. This directory is **not** an npm workspace — it is
staged into each consuming service at build time, because AWS SAM's
esbuild builder cannot resolve `file:` deps that point outside its
CodeUri.

To edit: change `src/index.mjs` here, then run
`node scripts/stage-image-processing.mjs` from the repo root. Commit
the updated `services/*/src/vendor/image-processing/` alongside your
source change — the vendored copies are checked in so SAM can bundle
them without any workspace resolution.

The `prebuild` npm hook in each service regenerates the vendor copy
automatically when you run `npm run build` locally; CI calls `sam
build` directly, so the checked-in copy is what actually ships.
