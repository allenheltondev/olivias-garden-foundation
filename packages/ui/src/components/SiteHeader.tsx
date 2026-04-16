import type { ReactNode } from 'react';

export interface SiteHeaderNavItem {
  id: string;
  label: string;
  onSelect: () => void;
  active?: boolean;
  accent?: boolean;
}

export interface SiteHeaderProps {
  brandEyebrow?: string;
  brandTitle: string;
  onBrandClick?: () => void;
  brandAriaLabel?: string;
  navItems?: SiteHeaderNavItem[];
  utility?: ReactNode;
}

export function SiteHeader({
  brandEyebrow,
  brandTitle,
  onBrandClick,
  brandAriaLabel = 'Go to home',
  navItems = [],
  utility,
}: SiteHeaderProps) {
  return (
    <header className="og-site-header">
      <div className="og-site-header__inner">
        <button type="button" className="og-site-header__brand" onClick={onBrandClick} aria-label={brandAriaLabel}>
          {brandEyebrow ? <span className="og-site-header__eyebrow">{brandEyebrow}</span> : null}
          <span className="og-site-header__title">{brandTitle}</span>
        </button>

        <div className="og-site-header__actions">
          {navItems.length > 0 ? (
            <nav className="og-site-header__nav" aria-label="Primary">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`og-site-header__link ${item.active ? 'is-active' : ''} ${item.accent ? 'og-site-header__link--accent' : ''}`.trim()}
                  onClick={item.onSelect}
                >
                  {item.label}
                </button>
              ))}
            </nav>
          ) : null}
          {utility ? <div className="og-site-header__utility">{utility}</div> : null}
        </div>
      </div>
    </header>
  );
}
