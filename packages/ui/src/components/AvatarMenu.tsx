import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface AvatarMenuAppLink {
  id: string;
  label: string;
  href: string;
  onSelect?: () => void;
}

export interface AvatarMenuProps {
  initials: string;
  label: string;
  avatarUrl?: string | null;
  /** Personal links rendered right under the Profile entry, with no section header. */
  personalLinks?: AvatarMenuAppLink[];
  appLinks?: AvatarMenuAppLink[];
  onProfile?: () => void;
  onLogout?: () => void;
  profileLabel?: string;
  logoutLabel?: string;
  appsSectionLabel?: string;
  extraItems?: ReactNode;
}

export function AvatarMenu({
  initials,
  label,
  avatarUrl,
  personalLinks = [],
  appLinks = [],
  onProfile,
  onLogout,
  profileLabel = 'Profile',
  logoutLabel = 'Log out',
  appsSectionLabel = 'Apps',
  extraItems,
}: AvatarMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (event: Event) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const select = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <div className="og-auth-menu" ref={containerRef}>
      <button
        type="button"
        className={`og-auth-utility__avatar${avatarUrl ? ' og-auth-utility__avatar--image' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen((prev) => !prev)}
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="og-auth-utility__avatar-img" />
        ) : (
          initials
        )}
      </button>
      {open ? (
        <div className="og-auth-menu__popover" role="menu">
          {onProfile ? (
            <button
              type="button"
              className="og-auth-menu__item"
              role="menuitem"
              onClick={() => select(onProfile)}
            >
              {profileLabel}
            </button>
          ) : null}
          {personalLinks.map((link) => (
            <a
              key={link.id}
              className="og-auth-menu__item og-auth-menu__item--link"
              role="menuitem"
              href={link.href}
              onClick={() => {
                setOpen(false);
                link.onSelect?.();
              }}
            >
              {link.label}
            </a>
          ))}
          {personalLinks.length > 0 && (appLinks.length > 0 || extraItems || onLogout) ? (
            <div className="og-auth-menu__divider" role="separator" />
          ) : null}
          {appLinks.length > 0 ? (
            <>
              <div className="og-auth-menu__section-label" role="presentation">{appsSectionLabel}</div>
              {appLinks.map((link) => (
                <a
                  key={link.id}
                  className="og-auth-menu__item og-auth-menu__item--link"
                  role="menuitem"
                  href={link.href}
                  onClick={() => {
                    setOpen(false);
                    link.onSelect?.();
                  }}
                >
                  {link.label}
                </a>
              ))}
              <div className="og-auth-menu__divider" role="separator" />
            </>
          ) : null}
          {extraItems}
          {onLogout ? (
            <button
              type="button"
              className="og-auth-menu__item"
              role="menuitem"
              onClick={() => select(onLogout)}
            >
              {logoutLabel}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
