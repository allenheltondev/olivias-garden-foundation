import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface SiteHeaderNavItem {
  id: string;
  label: string;
  href?: string;
  onSelect?: () => void;
  active?: boolean;
  accent?: boolean;
  mobileOnly?: boolean;
}

export interface SiteHeaderProps {
  brandLogoSrc?: string;
  brandLogoAlt?: string;
  brandEyebrow?: string;
  brandTitle: string;
  brandHref?: string;
  onBrandClick?: () => void;
  brandAriaLabel?: string;
  navItems?: SiteHeaderNavItem[];
  utility?: ReactNode;
}

export function SiteHeader({
  brandLogoSrc,
  brandLogoAlt = '',
  brandEyebrow,
  brandTitle,
  brandHref,
  onBrandClick,
  brandAriaLabel = 'Go to home',
  navItems = [],
  utility,
}: SiteHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMenuOpen(false);
  }, [navItems.length]);

  useEffect(() => {
    if (!menuOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      const node = actionsRef.current;
      if (node && !node.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [menuOpen]);

  const handleBrandClick = () => {
    setMenuOpen(false);
    onBrandClick?.();
  };

  return (
    <header className="og-site-header">
      <div className="og-site-header__inner">
        {brandHref ? (
          <a
            className="og-site-header__brand"
            href={brandHref}
            onClick={(event) => {
              if (onBrandClick) {
                event.preventDefault();
                handleBrandClick();
              }
            }}
            aria-label={brandAriaLabel}
          >
            {brandLogoSrc ? (
              <img className="og-site-header__logo" src={brandLogoSrc} alt={brandLogoAlt} />
            ) : null}
            <span className="og-site-header__brand-copy">
              {brandEyebrow ? <span className="og-site-header__eyebrow">{brandEyebrow}</span> : null}
              <span className="og-site-header__title">{brandTitle}</span>
            </span>
          </a>
        ) : (
          <button type="button" className="og-site-header__brand" onClick={handleBrandClick} aria-label={brandAriaLabel}>
            {brandLogoSrc ? (
              <img className="og-site-header__logo" src={brandLogoSrc} alt={brandLogoAlt} />
            ) : null}
            <span className="og-site-header__brand-copy">
              {brandEyebrow ? <span className="og-site-header__eyebrow">{brandEyebrow}</span> : null}
              <span className="og-site-header__title">{brandTitle}</span>
            </span>
          </button>
        )}

        <div ref={actionsRef} className={`og-site-header__actions ${menuOpen ? 'is-open' : ''}`.trim()}>
          <div className="og-site-header__controls">
            {utility ? <div className="og-site-header__utility">{utility}</div> : null}
            {navItems.length > 0 ? (
              <button
                type="button"
                className="og-site-header__menu-toggle"
                aria-expanded={menuOpen}
                aria-controls="og-site-header-nav"
                aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
                onClick={() => setMenuOpen((current) => !current)}
              >
                <span className="og-site-header__menu-icon" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
              </button>
            ) : null}
          </div>

          {navItems.length > 0 ? (
            <nav
              id="og-site-header-nav"
              className={`og-site-header__nav ${menuOpen ? 'is-open' : ''}`.trim()}
              aria-label="Primary"
            >
              {navItems.map((item) => (
                item.href ? (
                  <a
                    key={item.id}
                    href={item.href}
                    className={`og-site-header__link ${item.active ? 'is-active' : ''} ${item.accent ? 'og-site-header__link--accent' : ''} ${item.mobileOnly ? 'og-site-header__link--mobile-only' : ''}`.trim()}
                    onClick={(event) => {
                      setMenuOpen(false);
                      if (item.onSelect) {
                        event.preventDefault();
                        item.onSelect();
                      }
                    }}
                  >
                    {item.label}
                  </a>
                ) : (
                  <button
                    key={item.id}
                    type="button"
                    className={`og-site-header__link ${item.active ? 'is-active' : ''} ${item.accent ? 'og-site-header__link--accent' : ''} ${item.mobileOnly ? 'og-site-header__link--mobile-only' : ''}`.trim()}
                    onClick={() => {
                      setMenuOpen(false);
                      item.onSelect?.();
                    }}
                  >
                    {item.label}
                  </button>
                )
              ))}
            </nav>
          ) : null}
        </div>
      </div>
    </header>
  );
}
