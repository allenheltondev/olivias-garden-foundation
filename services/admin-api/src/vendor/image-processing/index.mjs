import { createCanvas, loadImage } from '@napi-rs/canvas';
import exifr from 'exifr';

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

  const scale = target.width / effectiveWidth;
  const scaledSourceWidth = image.width * scale;
  const scaledSourceHeight = image.height * scale;

  applyOrientationTransform(ctx, orientation, scaledSourceWidth, scaledSourceHeight);
  ctx.drawImage(image, 0, 0, scaledSourceWidth, scaledSourceHeight);

  return canvas.toBuffer('image/webp', { quality });
}

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
