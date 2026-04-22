import { createCanvas, loadImage } from '@napi-rs/canvas';
import exifr from 'exifr';

/**
 * Read the EXIF Orientation tag if present. Returns a value in 1..8 or 1
 * as a safe default for formats without EXIF (PNG, WebP) or on parse error.
 */
async function readOrientation(bytes) {
  try {
    const tags = await exifr.parse(bytes, { pick: ['Orientation'] });
    const orientation = tags?.Orientation;
    return typeof orientation === 'number' && orientation >= 1 && orientation <= 8 ? orientation : 1;
  } catch {
    return 1;
  }
}

function orientationSwapsAxes(orientation) {
  return orientation >= 5 && orientation <= 8;
}

/**
 * Apply a canvas transform that, combined with a subsequent
 * `drawImage(img, 0, 0, w, h)` where (w, h) are the *source* image's own
 * dimensions, lands the pixels upright on a canvas sized to the oriented
 * output. See https://sylvana.net/jpegcrop/exif_orientation.html for the
 * transform-matrix breakdown.
 */
function applyOrientationTransform(ctx, orientation, sourceWidth, sourceHeight) {
  switch (orientation) {
    case 2: ctx.transform(-1, 0, 0, 1, sourceWidth, 0); break;
    case 3: ctx.transform(-1, 0, 0, -1, sourceWidth, sourceHeight); break;
    case 4: ctx.transform(1, 0, 0, -1, 0, sourceHeight); break;
    case 5: ctx.transform(0, 1, 1, 0, 0, 0); break;
    case 6: ctx.transform(0, 1, -1, 0, sourceHeight, 0); break;
    case 7: ctx.transform(0, -1, -1, 0, sourceHeight, sourceWidth); break;
    case 8: ctx.transform(0, -1, 1, 0, 0, sourceWidth); break;
    default: break;
  }
}

function fitWithinBox(width, height, maxSize) {
  const longest = Math.max(width, height);
  if (longest <= maxSize) {
    return { width, height };
  }
  const scale = maxSize / longest;
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

/**
 * Read the image's intrinsic dimensions (post-EXIF-orientation — i.e.
 * what a correct viewer would show) plus the raw Orientation tag.
 */
export async function getImageMetadata(bytes) {
  const [image, orientation] = await Promise.all([
    loadImage(bytes),
    readOrientation(bytes),
  ]);
  const swap = orientationSwapsAxes(orientation);
  return {
    width: swap ? image.height : image.width,
    height: swap ? image.width : image.height,
    orientation,
  };
}

/**
 * Resize to fit within `width` x `height` (aspect ratio preserved, longest
 * side becomes max(width, height)) and re-encode as WebP at the given
 * quality (0..100). Honors EXIF orientation unless `rotate: false`.
 *
 * Returns a Buffer.
 */
export async function transformToWebp(bytes, { width, height, quality = 82, rotate = true }) {
  const [image, orientation] = await Promise.all([
    loadImage(bytes),
    rotate ? readOrientation(bytes) : Promise.resolve(1),
  ]);

  const swap = orientationSwapsAxes(orientation);
  const effectiveWidth = swap ? image.height : image.width;
  const effectiveHeight = swap ? image.width : image.height;

  const boxSize = Math.max(width, height);
  const target = fitWithinBox(effectiveWidth, effectiveHeight, boxSize);

  const canvas = createCanvas(target.width, target.height);
  const ctx = canvas.getContext('2d');

  // Uniform scale (aspect ratio already preserved in target dims).
  const scale = target.width / effectiveWidth;
  const scaledSourceWidth = image.width * scale;
  const scaledSourceHeight = image.height * scale;

  applyOrientationTransform(ctx, orientation, scaledSourceWidth, scaledSourceHeight);
  ctx.drawImage(image, 0, 0, scaledSourceWidth, scaledSourceHeight);

  return canvas.toBuffer('image/webp', { quality });
}

/**
 * Process one source image into a normalized copy + a thumbnail in a
 * single pass. The canonical shape our S3-backed media flows want —
 * submissions, avatars, product photos, etc.
 *
 * Sizes are passed as square bounds; longest side gets clamped to that.
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
