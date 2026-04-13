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
    <header className={`w-full bg-primary-600 shadow-md ${className}`}>
      <div className="flex items-center justify-between h-14 px-4">
        {/* Left side - Logo icon and brand name */}
        <button
          onClick={handleLogoClick}
          className="flex items-center gap-3 hover:opacity-90 transition-opacity cursor-pointer focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-primary-600 rounded-md px-2 py-1"
          aria-label="Go to home"
        >
          <img
            src={brandConfig.assets.logo.iconWhite}
            alt=""
            className="h-8 w-8"
            aria-hidden="true"
          />
          <span className="text-white font-semibold text-lg hidden sm:inline">
            {brandConfig.name.full}
          </span>
        </button>

        {/* Right side - Menu button or user icon */}
        <div className="flex items-center">
          {showMenu ? (
            <button
              onClick={onMenuClick}
              className="p-2 rounded-md text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-primary-600"
              aria-label="Open menu"
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          ) : (
            <div className="w-8 h-8 rounded-full bg-primary-700 flex items-center justify-center text-white">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
              </svg>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
