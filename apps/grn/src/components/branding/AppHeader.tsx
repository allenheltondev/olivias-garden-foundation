import { SiteHeader } from '@olivias/ui';
import { brandConfig } from '../../config/brand';

export interface AppHeaderProps {
  showMenu?: boolean;
  onMenuClick?: () => void;
  onLogoClick?: () => void;
  className?: string;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  showMenu = false,
  onMenuClick,
  onLogoClick,
  className = ''
}) => {
  const handleLogoClick = () => {
    if (onLogoClick) {
      onLogoClick();
    } else {
      // Default behavior: navigate to home
      window.location.href = '/';
    }
  };

  return (
    <div className={className}>
      <SiteHeader
        brandEyebrow="Olivia's Garden Foundation"
        brandTitle={brandConfig.name.full}
        onBrandClick={handleLogoClick}
        utility={showMenu ? (
          <button
            type="button"
            onClick={onMenuClick}
            className="og-auth-utility__avatar"
            aria-label="Open menu"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        ) : (
          <div className="og-auth-utility__avatar" aria-hidden="true">
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
            </svg>
          </div>
        )}
      />
    </div>
  );
};
