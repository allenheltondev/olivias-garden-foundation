import type { ImgHTMLAttributes } from 'react';
import responsiveManifest from '../../public/images/responsive/manifest.json';

type ResponsiveVariant = {
  width: number;
  path: string;
  bytes: number;
};

type ResponsiveManifest = {
  images: Record<string, {
    original: string;
    width: number | null;
    height: number | null;
    variants?: {
      avif?: ResponsiveVariant[];
    };
  }>;
};

const manifest = responsiveManifest as ResponsiveManifest;

function normalizeImagePath(path: string) {
  return path.startsWith('/') ? path : `/${path}`;
}

function parseImagePath(imagePath: string) {
  const normalizedPath = normalizeImagePath(imagePath);
  const match = normalizedPath.match(/^(.*\/)?([^/.]+)\.(jpg|jpeg|png|webp|avif)$/i);

  if (!match) {
    throw new Error(`Unsupported image path for responsive assets: ${imagePath}`);
  }

  return {
    normalizedPath,
    relativePath: normalizedPath.replace(/^\/images\//, ''),
    directory: match[1] ?? '/',
    baseName: match[2],
    extension: match[3].toLowerCase(),
  };
}

function getAvifVariants(imagePath: string) {
  const { relativePath } = parseImagePath(imagePath);
  return manifest.images[relativePath]?.variants?.avif ?? [];
}

function originalMimeTypeFor(imagePath: string) {
  const { extension } = parseImagePath(imagePath);

  switch (extension) {
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'avif':
      return 'image/avif';
    default:
      return 'image/jpeg';
  }
}

export function buildResponsiveImagePath(
  imagePath: string,
  width: number,
  format: 'avif',
) {
  const parsed = parseImagePath(imagePath);

  return `${parsed.directory}responsive${parsed.directory === '/' ? '' : '/'}${parsed.baseName}-${width}.${format}`.replace('//', '/');
}

export function buildResponsiveSrcSet(imagePath: string) {
  const variants = getAvifVariants(imagePath);
  if (variants.length === 0) {
    return '';
  }

  return variants
    .map((variant) => `/${variant.path} ${variant.width}w`)
    .join(', ');
}

export function buildResponsiveBackgroundImage(imagePath: string, width = 1600) {
  const variants = getAvifVariants(imagePath);
  const selectedVariant = variants.find((variant) => variant.width >= width) ?? variants[variants.length - 1];

  if (!selectedVariant) {
    return `url("${normalizeImagePath(imagePath)}")`;
  }

  return `image-set(url("/${selectedVariant.path}") type("image/avif"), url("${normalizeImagePath(imagePath)}") type("${originalMimeTypeFor(imagePath)}"))`;
}

type ResponsiveImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'srcSet'> & {
  src: string;
  sizes: string;
};

export function ResponsiveImage({
  src,
  alt,
  sizes,
  loading = 'lazy',
  decoding = 'async',
  ...imgProps
}: ResponsiveImageProps) {
  const avifSrcSet = buildResponsiveSrcSet(src);

  return (
    <picture>
      {avifSrcSet ? (
        <source
          type="image/avif"
          srcSet={avifSrcSet}
          sizes={sizes}
        />
      ) : null}
      <img
        {...imgProps}
        src={normalizeImagePath(src)}
        alt={alt ?? ''}
        loading={loading}
        decoding={decoding}
      />
    </picture>
  );
}
