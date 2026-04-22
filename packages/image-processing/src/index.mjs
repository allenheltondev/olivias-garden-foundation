import { Transformer } from '@napi-rs/image';

/**
 * Read intrinsic width/height (and other metadata) from the source bytes.
 * Passes true for `withExif` so EXIF orientation is available if callers
 * need it outside of the transform (we already honor it via `rotate()`).
 */
export async function getImageMetadata(bytes) {
  return new Transformer(bytes).metadata(true);
}

/**
 * Resize the source bytes to fit within `width` x `height` (aspect ratio
 * preserved) and re-encode as WebP at the given quality. Honors EXIF
 * orientation unless `rotate: false` is passed.
 *
 * Returns a Buffer of the encoded WebP.
 */
export async function transformToWebp(bytes, { width, height, quality = 82, rotate = true }) {
  const base = new Transformer(bytes);
  const oriented = rotate ? base.rotate() : base;
  return oriented.resize(width, height).webp(quality);
}

/**
 * Process one source image into a normalized copy + a thumbnail in a
 * single pass. This is the universal shape our S3-backed media flows
 * want — submissions, avatars, product photos, etc.
 *
 * Sizes are passed as square bounds (e.g. `mainSize: 1600`), matching
 * `@napi-rs/image`'s resize-to-fit behavior.
 */
export async function transformToWebpPair(bytes, {
  mainSize,
  mainQuality = 82,
  thumbnailSize,
  thumbnailQuality = 75,
}) {
  const [metadata, main, thumbnail] = await Promise.all([
    getImageMetadata(bytes),
    transformToWebp(bytes, { width: mainSize, height: mainSize, quality: mainQuality }),
    transformToWebp(bytes, { width: thumbnailSize, height: thumbnailSize, quality: thumbnailQuality }),
  ]);
  return { metadata, main, thumbnail };
}

export { Transformer } from '@napi-rs/image';
