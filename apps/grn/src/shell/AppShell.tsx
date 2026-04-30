import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { AvatarMenu, SiteFooter, SiteHeader } from '@olivias/ui';
import { brandConfig } from '../config/brand';
import { useAuth } from '../hooks/useAuth';
import { useUser } from '../hooks/useUser';

const NAV_EXPANDED_STORAGE_KEY = 'og-grn-nav-expanded';

const foundationHomeUrl = import.meta.env.VITE_FOUNDATION_URL
  ? import.meta.env.VITE_FOUNDATION_URL.replace(/\/+$/, '')
  : 'https://oliviasgarden.org';

const adminUrl = (import.meta.env.VITE_ADMIN_URL as string | undefined)?.replace(/\/+$/, '')
  ?? 'https://admin.oliviasgarden.org';

const instagramUrl = 'https://instagram.com/oliviasgardentx';
const facebookUrl = 'https://www.facebook.com/profile.php?id=100087146659606#';

type NavItem = {
  id: string;
  path: string;
  label: string;
  icon: ReactNode;
};

const baseNavItems: NavItem[] = [
  {
    id: 'dashboard',
    path: '/',
    label: 'Dashboard',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M3 13h8V3H3v10Zm0 8h8v-6H3v6Zm10 0h8V11h-8v10Zm0-18v6h8V3h-8Z" fill="currentColor" />
      </svg>
    ),
  },
];

const growerNavItems: NavItem[] = [
  {
    id: 'crops',
    path: '/crops',
    label: 'Crop library',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          d="M12 3c-3.5 3-5 6-5 9a5 5 0 0 0 4 4.9V21a1 1 0 1 0 2 0v-4.1a5 5 0 0 0 4-4.9c0-3-1.5-6-5-9Zm0 12a3 3 0 0 1-3-3c0-1.7.8-3.6 3-5.7 2.2 2.1 3 4 3 5.7a3 3 0 0 1-3 3Z"
          fill="currentColor"
        />
      </svg>
    ),
  },
  {
    id: 'listings',
    path: '/listings',
    label: 'Listings',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          d="M4 5h16v3H4V5Zm0 5h16v3H4v-3Zm0 5h10v3H4v-3Z"
          fill="currentColor"
        />
      </svg>
    ),
  },
];

const gathererNavItems: NavItem[] = [
  {
    id: 'requests',
    path: '/requests',
    label: 'Requests',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          d="M11 3a8 8 0 1 0 5.3 14L21 21.7l1.4-1.4-4.7-4.7A8 8 0 0 0 11 3Zm0 2a6 6 0 1 1 0 12 6 6 0 0 1 0-12Z"
          fill="currentColor"
        />
      </svg>
    ),
  },
];

const remindersNavItem: NavItem = {
  id: 'reminders',
  path: '/reminders',
  label: 'Reminders',
  icon: (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M12 2a7 7 0 0 0-7 7v3.6L3 16h18l-2-3.4V9a7 7 0 0 0-7-7Zm0 19a3 3 0 0 0 3-3H9a3 3 0 0 0 3 3Z"
        fill="currentColor"
      />
    </svg>
  ),
};

const footerLinks = [
  { id: 'home', label: 'Foundation home', href: `${foundationHomeUrl}/` },
  { id: 'about', label: 'About', href: `${foundationHomeUrl}/about` },
  { id: 'okra', label: 'Okra Project', href: `${foundationHomeUrl}/okra` },
];

const foundationHeaderNav = [
  { id: 'foundation-home', label: 'Home', href: `${foundationHomeUrl}/` },
  { id: 'foundation-about', label: 'About', href: `${foundationHomeUrl}/about` },
  { id: 'foundation-okra', label: 'Okra Project', href: `${foundationHomeUrl}/okra` },
];

function getInitials(firstName?: string, lastName?: string, email?: string): string {
  const first = firstName?.trim().charAt(0) ?? '';
  const last = lastName?.trim().charAt(0) ?? '';
  const combined = `${first}${last}`.trim();
  if (combined) return combined.toUpperCase();

  const source = email?.trim() ?? '';
  if (!source) return 'G';
  const parts = source
    .replace(/@.*/, '')
    .split(/[\s._-]+/)
    .filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || source.slice(0, 2).toUpperCase();
}

function readStoredExpanded(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const stored = window.localStorage.getItem(NAV_EXPANDED_STORAGE_KEY);
    if (stored === null) return true;
    return stored === 'true';
  } catch {
    return true;
  }
}

export interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const { signOut } = useAuth();
  const { user } = useUser();
  const [expanded, setExpanded] = useState<boolean>(() => readStoredExpanded());
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    try {
      window.localStorage.setItem(NAV_EXPANDED_STORAGE_KEY, String(expanded));
    } catch {
      // ignore storage errors
    }
  }, [expanded]);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMobileNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileNavOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileNavOpen]);

  const handleLogout = async () => {
    try {
      await signOut();
    } catch {
      // ignore — page reload clears local session
    }
    window.location.assign(`${foundationHomeUrl}/login`);
  };

  const navItems: NavItem[] = [
    ...baseNavItems,
    ...(user?.userType === 'grower' ? growerNavItems : []),
    ...(user?.userType === 'gatherer' ? gathererNavItems : []),
    remindersNavItem,
  ];

  const headerNavItems = foundationHeaderNav.map((item) => ({
    id: item.id,
    label: item.label,
    href: item.href,
  }));

  const initials = getInitials(user?.firstName, user?.lastName, user?.email);
  const displayName = user
    ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email || 'Member'
    : 'Member';

  return (
    <div className="og-app-shell grn-app-shell">
      <SiteHeader
        brandEyebrow="Olivia's Garden Foundation"
        brandTitle={brandConfig.name.full}
        brandHref={`${foundationHomeUrl}/`}
        navItems={headerNavItems}
        utility={(
          <div className="og-auth-utility">
            <AvatarMenu
              initials={initials}
              label={displayName}
              appLinks={[
                { id: 'foundation', label: 'Foundation home', href: foundationHomeUrl },
                { id: 'admin', label: 'Admin console', href: adminUrl },
              ]}
              onLogout={handleLogout}
            />
          </div>
        )}
      />
      <div
        className={`grn-shell-body ${expanded ? 'is-expanded' : 'is-collapsed'} ${mobileNavOpen ? 'is-mobile-nav-open' : ''}`.trim()}
      >
        <button
          type="button"
          className="grn-mobile-nav-trigger"
          aria-expanded={mobileNavOpen}
          aria-controls="grn-vertical-nav"
          aria-label="Open sections"
          onClick={() => setMobileNavOpen(true)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M4 7h16v2H4V7Zm0 4h16v2H4v-2Zm0 4h16v2H4v-2Z" fill="currentColor" />
          </svg>
          <span>Sections</span>
        </button>

        <button
          type="button"
          className="grn-mobile-nav-backdrop"
          aria-label="Close sections"
          tabIndex={mobileNavOpen ? 0 : -1}
          onClick={() => setMobileNavOpen(false)}
        />

        <aside
          id="grn-vertical-nav"
          className={`grn-vertical-nav ${expanded ? 'is-expanded' : 'is-collapsed'} ${mobileNavOpen ? 'is-mobile-open' : ''}`.trim()}
          aria-label="Good Roots Network sections"
        >
          <div className="grn-vertical-nav__mobile-header">
            <span className="grn-vertical-nav__mobile-title">Sections</span>
            <button
              type="button"
              className="grn-vertical-nav__mobile-close"
              aria-label="Close sections"
              onClick={() => setMobileNavOpen(false)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path
                  d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4L13.4 12 19 6.4 17.6 5 12 10.6 6.4 5Z"
                  fill="currentColor"
                />
              </svg>
            </button>
          </div>

          <ul className="grn-vertical-nav__list" role="list">
            {navItems.map((item) => (
              <li key={item.id}>
                <NavLink
                  to={item.path}
                  end={item.path === '/'}
                  className={({ isActive }) =>
                    `grn-vertical-nav__link ${isActive ? 'is-active' : ''}`.trim()
                  }
                  title={expanded ? undefined : item.label}
                  onClick={() => setMobileNavOpen(false)}
                >
                  <span className="grn-vertical-nav__icon" aria-hidden="true">{item.icon}</span>
                  <span className="grn-vertical-nav__label">{item.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>

          <button
            type="button"
            className="grn-vertical-nav__toggle"
            aria-expanded={expanded}
            aria-label={expanded ? 'Collapse navigation' : 'Expand navigation'}
            title={expanded ? 'Collapse navigation' : 'Expand navigation'}
            onClick={() => setExpanded((current) => !current)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path
                d={expanded
                  ? 'M15.4 6.4 14 5l-7 7 7 7 1.4-1.4L9.8 12Z'
                  : 'M8.6 6.4 10 5l7 7-7 7-1.4-1.4L14.2 12Z'}
                fill="currentColor"
              />
            </svg>
          </button>
        </aside>

        <main className="grn-shell-main">
          <div className="grn-shell-main__inner">
            {children}
          </div>
        </main>
      </div>
      <SiteFooter
        meta={`${new Date().getFullYear()} Olivia's Garden Foundation. All rights reserved.`}
        links={footerLinks.map((link) => ({
          id: link.id,
          label: link.label,
          onSelect: () => window.location.assign(link.href),
        }))}
        socialLinks={[
          {
            id: 'instagram',
            href: instagramUrl,
            label: "Follow Olivia's Garden Foundation on Instagram",
            icon: 'instagram',
          },
          {
            id: 'facebook',
            href: facebookUrl,
            label: "Follow Olivia's Garden Foundation on Facebook",
            icon: 'facebook',
          },
        ]}
      />
    </div>
  );
}
