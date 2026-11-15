import { useState } from 'react';
import { GardenIcon } from '@olivias/ui';

/** Keep missing or failed photography honest, without an empty image frame. */
export function ProductImage({ src, alt, className, loading }: {
  src?: string | null;
  alt: string;
  className?: string;
  loading?: 'lazy' | 'eager';
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (src && src !== failedSrc) {
    return <img src={src} alt={alt} className={className} loading={loading} onError={() => setFailedSrc(src)} />;
  }
  return (
    <div className="store-product-card__placeholder" role={alt ? 'img' : undefined} aria-label={alt ? `Photo unavailable: ${alt}` : undefined} aria-hidden={alt ? undefined : true}>
      <GardenIcon name="basket" />
      <span>Photo coming soon</span>
    </div>
  );
}
