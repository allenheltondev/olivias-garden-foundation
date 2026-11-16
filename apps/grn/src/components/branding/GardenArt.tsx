import { useState, type CSSProperties } from 'react';
import { CropIcon } from '../CropPlanner/cropIcons';
import type { CropIconKey } from '../CropPlanner/cropIconPaths';
import './GardenArt.css';

const illustratedCrops = new Set<CropIconKey>([
  'basil', 'broccoli', 'carrot', 'cucumber', 'kale', 'lettuce',
  'okra', 'onion', 'pea', 'pepper', 'radish', 'strawberry', 'tomato',
]);

interface CropArtworkProps {
  iconKey: CropIconKey;
  size?: number | string;
  color?: string;
  title?: string;
  className?: string;
  style?: CSSProperties;
}

/** Rich art for crop browsing; canvas and tiny utility icons retain silhouettes. */
export function CropArtwork({ iconKey, size = 40, color, title, className, style }: CropArtworkProps) {
  const [failedCrop, setFailedCrop] = useState<CropIconKey | null>(null);
  if (!illustratedCrops.has(iconKey) || failedCrop === iconKey) {
    return <CropIcon {...{ iconKey, size, color, title, className, style }} />;
  }
  return (
    <img
      src={`/images/botanical/crops/${iconKey}.svg`}
      alt={title ?? ''}
      aria-hidden={title ? undefined : true}
      width={typeof size === 'number' ? size : 80}
      height={typeof size === 'number' ? size : 80}
      loading="lazy"
      decoding="async"
      className={className}
      style={{ width: size, height: size, objectFit: 'contain', verticalAlign: 'middle', ...style }}
      onError={() => setFailedCrop(iconKey)}
    />
  );
}

/** Decorative scenes always accompany real text and never carry instructions. */
export function GardenScene({ name, className }: {
  name: 'first-garden' | 'neighbor-harvest';
  className?: string;
}) {
  const [failedScene, setFailedScene] = useState<string | null>(null);
  if (failedScene === name) return null;
  return (
    <img
      src={`/images/botanical/${name}.webp`}
      alt=""
      aria-hidden="true"
      width={640}
      height={427}
      loading="lazy"
      decoding="async"
      className={className}
      style={{ maxWidth: '100%', height: 'auto' }}
      onError={() => setFailedScene(name)}
    />
  );
}
