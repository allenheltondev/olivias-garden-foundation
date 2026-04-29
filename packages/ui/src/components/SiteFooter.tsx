export interface SiteFooterLink {
  id: string;
  label: string;
  href?: string;
  onSelect?: () => void;
  active?: boolean;
}

export interface SiteFooterSocialLink {
  id: string;
  href: string;
  label: string;
  icon: 'instagram' | 'facebook';
}

export interface SiteFooterProps {
  meta: string;
  links?: SiteFooterLink[];
  legalLinks?: SiteFooterLink[];
  socialLinks?: SiteFooterSocialLink[];
}

function renderLinkGroup(
  label: string,
  navLabel: string,
  linkClassName: string,
  variant: 'pages' | 'legal',
  links: SiteFooterLink[],
) {
  return (
    <nav
      className={`og-site-footer__links-block og-site-footer__links-block--${variant}`}
      aria-label={navLabel}
    >
      <p className="og-site-footer__label">{label}</p>
      <ul className={`og-site-footer__links og-site-footer__links--${variant}`}>
        {links.map((link) => (
          <li key={link.id} className="og-site-footer__link-item">
            {link.href ? (
              <a
                href={link.href}
                className={`${linkClassName} ${link.active ? 'is-active' : ''}`.trim()}
                aria-current={link.active ? 'page' : undefined}
                onClick={(event) => {
                  if (link.onSelect) {
                    event.preventDefault();
                    link.onSelect();
                  }
                }}
              >
                {link.label}
              </a>
            ) : (
              <button
                type="button"
                className={`${linkClassName} ${link.active ? 'is-active' : ''}`.trim()}
                onClick={link.onSelect}
              >
                {link.label}
              </button>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function SiteFooter({
  meta,
  links = [],
  legalLinks = [],
  socialLinks = [],
}: SiteFooterProps) {
  return (
    <footer className="og-site-footer">
      <div className="og-site-footer__inner">
        {links.length > 0
          ? renderLinkGroup('Pages', 'Footer', 'og-site-footer__link', 'pages', links)
          : null}

        {socialLinks.length > 0 ? (
          <div className="og-site-footer__social-block">
            <div className="og-site-footer__social-row">
              <p className="og-site-footer__label">Follow</p>
              <div className="og-site-footer__social-icons">
                {socialLinks.map((link) => (
                  <a
                    key={link.id}
                    className="og-site-footer__social-link"
                    href={link.href}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={link.label}
                    title={link.label}
                  >
                    <span className="og-site-footer__icon" aria-hidden="true">
                      {link.icon === 'instagram' ? (
                        <svg viewBox="0 0 24 24" focusable="false">
                          <path d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Zm0 2A3 3 0 0 0 4 7v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3H7Zm5 3.5A4.5 4.5 0 1 1 7.5 12 4.5 4.5 0 0 1 12 7.5Zm0 2A2.5 2.5 0 1 0 14.5 12 2.5 2.5 0 0 0 12 9.5Zm5.25-3.25a1.25 1.25 0 1 1-1.25 1.25 1.25 1.25 0 0 1 1.25-1.25Z" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" focusable="false">
                          <path d="M13 22v-8h3l1-4h-4V7.6c0-1.2.4-2 2.1-2H17V2.2c-.3 0-1.4-.2-2.8-.2-2.8 0-4.7 1.7-4.7 4.9V10H6v4h3.5v8H13Z" />
                        </svg>
                      )}
                    </span>
                  </a>
                ))}
              </div>
            </div>
          </div>
        ) : null}
        {legalLinks.length > 0
          ? renderLinkGroup('Legal', 'Legal', 'og-site-footer__link og-site-footer__link--legal', 'legal', legalLinks)
          : null}

        <p className="og-site-footer__meta">{meta}</p>
      </div>
    </footer>
  );
}
