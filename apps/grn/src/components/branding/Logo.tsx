import { useState } from 'react';
import { brandConfig } from '../../config/brand';

export interface LogoProps {
  variant?: 'full' | 'horizontal' | 'icon';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const sizeMap = {
  sm: 'h-8',  // 32px
  md: 'h-12', // 48px
  lg: 'h-16', // 64px
  xl: 'h-24', // 96px
};

export const Logo: React.FC<LogoProps> = ({
  variant = 'full',
  size = 'md',
  className = ''
}) => {
  const [imageError, setImageError] = useState(false);

  const getLogoPath = () => {
    switch (variant) {
      case 'horizontal':
        return brandConfig.assets.logo.horizontal;
      case 'icon':
        return brandConfig.assets.logo.icon;
      case 'full':
      default:
        return brandConfig.assets.logo.full;
    }
  };

  if (imageError) {
    return (
      <div
        className={`logo-fallback flex items-center justify-center ${sizeMap[size]} ${className}`}
        role="img"
        aria-label="Good Roots Network logo"
      >
        <span className="text-primary-600 font-bold text-2xl">GRN</span>
      </div>
    );
  }

  return (
    <img
      src={getLogoPath()}
      alt="Good Roots Network logo"
      className={`${sizeMap[size]} w-auto object-contain ${className}`}
      onError={() => {
        console.warn(`Failed to load logo variant: ${variant}`);
        setImageError(true);
      }}
    />
  );
};
