import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { AvatarMenu, SiteFooter, SiteHeader } from '@olivias/ui';
import { signOut } from 'aws-amplify/auth';
import type { AdminSession } from '../auth/session';

const foundationLogo = '/images/icons/logo.svg';

const foundationHomeUrl = import.meta.env.VITE_FOUNDATION_URL
  ? import.meta.env.VITE_FOUNDATION_URL.replace(/\/+$/, '')
  : 'https://oliviasgarden.org';

const grnUrl = (import.meta.env.VITE_GRN_URL as string | undefined)?.replace(/\/+$/, '')
  ?? 'https://grn.oliviasgarden.org';

const instagramUrl = 'https://instagram.com/oliviasgardentx';
const facebookUrl = 'https://www.facebook.com/profile.php?id=100087146659606#';

const NAV_EXPANDED_STORAGE_KEY = 'og-admin-nav-expanded';

type AdminNavItem = {
  id: string;
  path: string;
  label: string;
  icon: ReactNode;
};

const navItems: AdminNavItem[] = [
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
  {
    id: 'finance',
    path: '/finance',
    label: 'Finance',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          d="M5 21V10h3v11H5Zm5 0V4h3v17h-3Zm5 0v-7h3v7h-3Z"
          fill="currentColor"
        />
      </svg>
    ),
  },
  {
    id: 'seed-requests',
    path: '/seed-requests',
    label: 'Seed requests',
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
    id: 'okra-queue',
    path: '/okra-queue',
    label: 'Okra',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          d="M5 4h11l3 3v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm0 2v14h13V8h-3V6H5Zm3 5h7v2H8v-2Zm0 4h7v2H8v-2Z"
          fill="currentColor"
        />
      </svg>
    ),
  },
  {
    id: 'store-catalog',
    path: '/store',
    label: 'Catalog',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          d="M4 7h16l-1.2 11.1a2 2 0 0 1-2 1.9H7.2a2 2 0 0 1-2-1.9L4 7Zm4 0V5a4 4 0 0 1 8 0v2h-2V5a2 2 0 0 0-4 0v2H8Z"
          fill="currentColor"
        />
      </svg>
    ),
  },
  {
    id: 'store-orders',
    path: '/store/orders',
    label: 'Orders',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          d="M3 5h13l3 4v9a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm0 2v12h15v-9.3l-2.4-2.7H3Zm2 4h11v2H5v-2Zm0 4h7v2H5v-2Z"
          fill="currentColor"
        />
      </svg>
    ),
  },
  {
    id: 'workshops',
    path: '/workshops',
    label: 'Workshops',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          d="M4 4h16v3H4V4Zm0 5h16v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9Zm3 3v2h4v-2H7Zm0 4v2h10v-2H7Z"
          fill="currentColor"
        />
      </svg>
    ),
  },
];

const footerLinks = [
  { id: 'home', label: 'Foundation home', href: `${foundationHomeUrl}/` },
  { id: 'okra', label: 'Okra Project', href: `${foundationHomeUrl}/okra` },
];

const foundationHeaderNav = [
  { id: 'foundation-home', label: 'Home', href: `${foundationHomeUrl}/` },
  { id: 'foundation-about', label: 'About', href: `${foundationHomeUrl}/about` },
  { id: 'foundation-okra', label: 'Okra Project', href: `${foundationHomeUrl}/okra` },
];

function getInitials(session: AdminSession): string {
  const source = session.displayName?.trim() || session.email?.trim() || '';
  if (!source) return 'A';
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
  session: AdminSession;
  children: ReactNode;
}

export function AppShell({ session, children }: AppShellProps) {
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
    setMobileNavOpen(false);
  }, [location.pathname]);

  // Escape key dismissal + lock background scroll while the drawer is open.
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
      // Ignore sign-out errors; local session is cleared on reload anyway.
    }
    window.location.assign(`${foundationHomeUrl}/login`);
  };

  const headerNavItems = foundationHeaderNav.map((item) => ({
    id: item.id,
    label: item.label,
    href: item.href,
  }));

  return (
    <div className="og-app-shell admin-app-shell">
      <SiteHeader
        brandLogoSrc={foundationLogo}
        brandLogoAlt=""
        brandEyebrow="Olivia's Garden Foundation"
        brandTitle="Administration console"
        brandHref={`${foundationHomeUrl}/`}
        navItems={headerNavItems}
        utility={(
          <div className="og-auth-utility">
            <AvatarMenu
              initials={getInitials(session)}
              label={session.displayName || session.email || 'Administrator'}
              appLinks={[
                { id: 'foundation', label: 'Foundation home', href: foundationHomeUrl },
                { id: 'grn', label: 'Good Roots Network', href: grnUrl },
              ]}
              onLogout={handleLogout}
            />
          </div>
        )}
      />
      <div
        className={`admin-shell-body ${expanded ? 'is-expanded' : 'is-collapsed'} ${mobileNavOpen ? 'is-mobile-nav-open' : ''}`.trim()}
      >
        <button
          type="button"
          className="admin-mobile-nav-trigger"
          aria-expanded={mobileNavOpen}
          aria-controls="admin-vertical-nav"
          aria-label="Open admin sections"
          onClick={() => setMobileNavOpen(true)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M4 7h16v2H4V7Zm0 4h16v2H4v-2Zm0 4h16v2H4v-2Z" fill="currentColor" />
          </svg>
          <span>Sections</span>
        </button>

        <button
          type="button"
          className="admin-mobile-nav-backdrop"
          aria-label="Close admin sections"
          tabIndex={mobileNavOpen ? 0 : -1}
          onClick={() => setMobileNavOpen(false)}
        />

        <aside
          id="admin-vertical-nav"
          className={`admin-vertical-nav ${expanded ? 'is-expanded' : 'is-collapsed'} ${mobileNavOpen ? 'is-mobile-open' : ''}`.trim()}
          aria-label="Admin sections"
        >
          <div className="admin-vertical-nav__mobile-header">
            <span className="admin-vertical-nav__mobile-title">Admin sections</span>
            <button
              type="button"
              className="admin-vertical-nav__mobile-close"
              aria-label="Close admin sections"
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

          <ul className="admin-vertical-nav__list" role="list">
            {navItems.map((item) => (
              <li key={item.id}>
                <NavLink
                  to={item.path}
                  end={item.path === '/'}
                  className={({ isActive }) =>
                    `admin-vertical-nav__link ${isActive ? 'is-active' : ''}`.trim()
                  }
                  title={expanded ? undefined : item.label}
                  onClick={() => setMobileNavOpen(false)}
                >
                  <span className="admin-vertical-nav__icon" aria-hidden="true">{item.icon}</span>
                  <span className="admin-vertical-nav__label">{item.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>

          <button
            type="button"
            className="admin-vertical-nav__toggle"
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

        <main className="admin-shell-main">
          <div className="admin-shell-main__inner">
            {children}
          </div>
        </main>
      </div>
      <SiteFooter
        meta={`${new Date().getFullYear()} Olivia's Garden Foundation. All rights reserved.`}
        links={footerLinks}
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
