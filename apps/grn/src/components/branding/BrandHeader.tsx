import { Logo } from './Logo';
import { brandConfig } from '../../config/brand';

export interface BrandHeaderProps {
  showTagline?: boolean;
  logoSize?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

export const BrandHeader: React.FC<BrandHeaderProps> = ({
  showTagline = true,
  logoSize = 'lg',
  className = ''
}) => {
  return (
    <div className={`flex flex-col items-center text-center space-y-4 ${className}`}>
      <Logo variant="full" size={logoSize} />

      <div className="space-y-2">
        <h1 className="text-2xl font-semibold text-neutral-900">
          {brandConfig.name.full}
        </h1>

        {showTagline && (
          <p className="text-base text-neutral-600 leading-relaxed">
            {brandConfig.tagline}
          </p>
        )}
      </div>
    </div>
  );
};
