import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AvatarMenu, SiteFooter, SiteHeader } from '@olivias/ui';
import { brandConfig } from '../config/brand';
import { useAuth } from '../hooks/useAuth';
import type { UserProfile } from '../types/user';
import { createLogger } from '../utils/logging';
import {
  PRIMARY_NAVIGATION,
  MOBILE_NAVIGATION,
  isPrimaryDestinationActive,
  type PrimaryDestinationId,
} from './navigation';

const NAV_EXPANDED_STORAGE_KEY = 'og-grn-nav-expanded';
const navigationLogger = createLogger('navigation');

const foundationLogo = '/images/icons/logo.svg';

const foundationHomeUrl = import.meta.env.VITE_FOUNDATION_URL
  ? import.meta.env.VITE_FOUNDATION_URL.replace(/\/+$/, '')
  : 'https://oliviasgarden.org';

const adminUrl = (import.meta.env.VITE_ADMIN_URL as string | undefined)?.replace(/\/+$/, '')
  ?? 'https://admin.oliviasgarden.org';

const instagramUrl = 'https://instagram.com/oliviasgardentx';
const facebookUrl = 'https://www.facebook.com/profile.php?id=100087146659606#';

const navigationIcons: Record<PrimaryDestinationId, ReactNode> = {
  today: (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 3 3 10.5V21h6v-6h6v6h6V10.5L12 3Z" fill="currentColor" />
    </svg>
  ),
  garden: (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M12 3c-3.5 3-5 6-5 9a5 5 0 0 0 4 4.9V21a1 1 0 1 0 2 0v-4.1a5 5 0 0 0 4-4.9c0-3-1.5-6-5-9Zm0 12a3 3 0 0 1-3-3c0-1.7.8-3.6 3-5.7 2.2 2.1 3 4 3 5.7a3 3 0 0 1-3 3Z"
        fill="currentColor"
      />
    </svg>
  ),
  share: (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M18 16a3 3 0 0 0-2.4 1.2l-6.8-3.4a3.3 3.3 0 0 0 0-1.6l6.8-3.4A3 3 0 1 0 15 7a3.3 3.3 0 0 0 .1.8L8.4 11.2a3 3 0 1 0 0 3.6l6.7 3.4A3 3 0 1 0 18 16Z"
        fill="currentColor"
      />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm8.5-2a8.5 8.5 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a8.4 8.4 0 0 0-2.1-1.2L15.6 3H8.4l-.4 2.7a8.4 8.4 0 0 0-2.1 1.2l-2.3-1-2 3.4 2 1.5a8.6 8.6 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-1a8.4 8.4 0 0 0 2.1 1.2l.4 2.7h7.2l.4-2.7a8.4 8.4 0 0 0 2.1-1.2l2.3 1 2-3.4-2-1.5c.06-.4.1-.8.1-1.2Z"
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

function getInitials(displayName?: string | null, email?: string | null): string {
  const tokens = displayName?.split(/\s+/).filter(Boolean) ?? [];
  if (tokens.length >= 2) {
    return `${tokens[0][0]}${tokens[tokens.length - 1][0]}`.toUpperCase();
  }
  if (tokens.length === 1) {
    return tokens[0].slice(0, 2).toUpperCase();
  }
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
  user: UserProfile | null;
  children: ReactNode;
}

export function AppShell({ user, children }: AppShellProps) {
  const { signOut } = useAuth();
  const [expanded, setExpanded] = useState<boolean>(() => readStoredExpanded());
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    try {
      window.localStorage.setItem(NAV_EXPANDED_STORAGE_KEY, String(expanded));
    } catch {
      // Ignore storage errors; the rail remains usable for this session.
    }
  }, [expanded]);

  const handleLogout = async () => {
    try {
      await signOut();
    } catch {
      // The foundation login navigation clears any remaining local session.
    }
    window.location.assign(`${foundationHomeUrl}/login`);
  };

  const logDestination = (
    destination: PrimaryDestinationId,
    source: 'desktop_rail' | 'mobile_bottom_nav'
  ) => {
    navigationLogger.info('Primary navigation selected', { destination, source });
  };

  const initials = getInitials(user?.displayName, user?.email);
  const displayName = user?.displayName?.trim() || user?.email || 'Member';

  return (
    <div className="og-app-shell grn-app-shell">
      <SiteHeader
        brandLogoSrc={foundationLogo}
        brandLogoAlt=""
        brandEyebrow="Olivia's Garden Foundation"
        brandTitle={brandConfig.name.full}
        brandHref={`${foundationHomeUrl}/`}
        navItems={foundationHeaderNav}
        utility={(
          <div className="og-auth-utility">
            <AvatarMenu
              initials={initials}
              label={displayName}
              onProfile={() => navigate('/settings#profile')}
              profileLabel="Profile"
              personalLinks={[
                { id: 'membership', label: 'Membership', href: '/settings#membership' },
                { id: 'settings', label: 'Settings', href: '/settings' },
                { id: 'api-keys', label: 'API keys', href: '/settings/api-keys' },
              ]}
              appLinks={[
                { id: 'foundation', label: 'Foundation home', href: foundationHomeUrl },
                { id: 'admin', label: 'Admin console', href: adminUrl },
              ]}
              onLogout={handleLogout}
            />
          </div>
        )}
      />

      <div className={`grn-shell-body ${expanded ? 'is-expanded' : 'is-collapsed'}`}>
        <nav
          className={`grn-vertical-nav ${expanded ? 'is-expanded' : 'is-collapsed'}`}
          aria-label="Primary navigation"
        >
          <ul className="grn-vertical-nav__list" role="list">
            {PRIMARY_NAVIGATION.map((item) => {
              const isActive = isPrimaryDestinationActive(item.id, location.pathname);
              return (
                <li key={item.id}>
                  <Link
                    to={item.path}
                    className={`grn-vertical-nav__link ${isActive ? 'is-active' : ''}`.trim()}
                    aria-current={isActive ? 'page' : undefined}
                    title={expanded ? undefined : item.label}
                    onClick={() => logDestination(item.id, 'desktop_rail')}
                  >
                    <span className="grn-vertical-nav__icon" aria-hidden="true">
                      {navigationIcons[item.id]}
                    </span>
                    <span className="grn-vertical-nav__label">{item.label}</span>
                  </Link>
                </li>
              );
            })}
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
        </nav>

        <main className="grn-shell-main">
          <div className="grn-shell-main__inner">{children}</div>
        </main>
      </div>

      <nav className="grn-bottom-nav" aria-label="Primary navigation">
        {MOBILE_NAVIGATION.map((item) => {
          const isActive = isPrimaryDestinationActive(item.id, location.pathname);
          return (
            <Link
              key={item.id}
              to={item.path}
              className={`grn-bottom-nav__link ${isActive ? 'is-active' : ''}`.trim()}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => logDestination(item.id, 'mobile_bottom_nav')}
            >
              <span className="grn-bottom-nav__icon" aria-hidden="true">
                {navigationIcons[item.id]}
              </span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

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
