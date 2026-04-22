# image-processing (shared, vendored)

Source-of-truth for the shared image resize/encode helper used by the
okra and web APIs. This directory is **not** an npm workspace — it is
staged into each consuming service at build time by
`scripts/stage-image-processing.mjs`, because AWS SAM's esbuild
builder cannot resolve `file:` deps that point outside its CodeUri.

To edit: change `src/index.mjs` here. Services pick up the change via
their `prebuild` hook (runs before `sam build`). The vendored copies
under `services/*/src/vendor/image-processing/` are git-ignored.
