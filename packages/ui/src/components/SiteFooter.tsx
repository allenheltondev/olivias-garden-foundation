export interface SiteFooterLink {
  id: string;
  label: string;
  onSelect: () => void;
  active?: boolean;
}

export interface SiteFooterProps {
  tagline: string;
  meta: string;
  links?: SiteFooterLink[];
  socialLabel?: string;
  socialHref?: string;
  socialHandle?: string;
}

export function SiteFooter({
  tagline,
  meta,
  links = [],
  socialLabel,
  socialHref,
  socialHandle,
}: SiteFooterProps) {
  return (
    <footer className="og-site-footer">
      <div className="og-site-footer__inner">
        <div>
          <p className="og-site-footer__tagline">{tagline}</p>
          <p className="og-site-footer__meta">{meta}</p>
        </div>

        {links.length > 0 ? (
          <div className="og-site-footer__links">
            {links.map((link) => (
              <button
                key={link.id}
                type="button"
                className={`og-site-footer__link ${link.active ? 'is-active' : ''}`.trim()}
                onClick={link.onSelect}
              >
                {link.label}
              </button>
            ))}
          </div>
        ) : null}

        {socialHref && socialHandle ? (
          <div className="og-site-footer__social">
            <span className="og-site-footer__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Zm0 2A3 3 0 0 0 4 7v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3H7Zm5 3.5A4.5 4.5 0 1 1 7.5 12 4.5 4.5 0 0 1 12 7.5Zm0 2A2.5 2.5 0 1 0 14.5 12 2.5 2.5 0 0 0 12 9.5Zm5.25-3.25a1.25 1.25 0 1 1-1.25 1.25 1.25 1.25 0 0 1 1.25-1.25Z" />
              </svg>
            </span>
            <a href={socialHref} target="_blank" rel="noreferrer" aria-label={socialLabel ?? socialHandle}>
              {socialHandle}
            </a>
          </div>
        ) : null}
      </div>
    </footer>
  );
}
