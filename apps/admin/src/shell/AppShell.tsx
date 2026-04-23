import { type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { AvatarMenu, SiteFooter, SiteHeader } from '@olivias/ui';
import { signOut } from 'aws-amplify/auth';
import type { AdminSession } from '../auth/session';

const foundationLogo = '/images/icons/logo.svg';

const foundationHomeUrl = import.meta.env.VITE_FOUNDATION_URL
  ? import.meta.env.VITE_FOUNDATION_URL.replace(/\/+$/, '')
  : 'https://oliviasgarden.org';

const grnUrl = (import.meta.env.VITE_GRN_URL as string | undefined)?.replace(/\/+$/, '')
  ?? 'https://goodroots.network';

const instagramUrl = 'https://instagram.com/oliviasgardentx';
const facebookUrl = 'https://www.facebook.com/profile.php?id=100087146659606#';

const navItems = [
  { id: 'dashboard', path: '/', label: 'Dashboard' },
  { id: 'seed-requests', path: '/seed-requests', label: 'Seed requests' },
  { id: 'okra-queue', path: '/okra-queue', label: 'Okra queue' },
  { id: 'store-catalog', path: '/store', label: 'Store catalog' },
] as const;

const footerLinks = [
  { id: 'home', label: 'Foundation home', href: `${foundationHomeUrl}/` },
  { id: 'okra', label: 'Okra Project', href: `${foundationHomeUrl}/okra` },
  { id: 'grn', label: 'Good Roots Network', href: grnUrl },
];

function getInitials(session: AdminSession): string {
  const source = session.email?.trim() ?? '';
  if (!source) return 'A';
  const base = source.split('@')[0];
  const parts = base.split(/[._-]+/).filter(Boolean);
  if (parts.length === 0) return source.slice(0, 2).toUpperCase();
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || base.slice(0, 2).toUpperCase();
}

export interface AppShellProps {
  session: AdminSession;
  children: ReactNode;
}

export function AppShell({ session, children }: AppShellProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    try {
      await signOut();
    } catch {
      // Ignore sign-out errors; local session is cleared on reload anyway.
    }
    window.location.assign(`${foundationHomeUrl}/login`);
  };

  const headerNavItems = navItems.map((item) => ({
    id: item.id,
    label: item.label,
    href: item.path,
    active: location.pathname === item.path,
    mobileOnly: true,
    onSelect: () => navigate(item.path),
  }));

  return (
    <div className="og-app-shell admin-app-shell">
      <SiteHeader
        brandLogoSrc={foundationLogo}
        brandLogoAlt=""
        brandEyebrow="Olivia's Garden Foundation"
        brandTitle="Admin console"
        brandHref="/"
        onBrandClick={() => navigate('/')}
        navItems={headerNavItems}
        utility={(
          <div className="og-auth-utility">
            <AvatarMenu
              initials={getInitials(session)}
              label={session.email || 'Administrator'}
              appLinks={[
                { id: 'foundation', label: 'Foundation home', href: foundationHomeUrl },
                { id: 'grn', label: 'Good Roots Network', href: grnUrl },
              ]}
              onLogout={handleLogout}
            />
          </div>
        )}
      />
      <main className="og-app-main admin-app-main">
        <div className="admin-layout">
          <aside className="admin-layout__sidebar" aria-label="Admin sections">
            <nav className="og-side-nav admin-side-nav" aria-label="Admin sections">
              <p className="og-side-nav__eyebrow">Admin</p>
              <h2 className="og-side-nav__title">Olivia&apos;s Garden</h2>
              <div className="og-side-nav__list">
                {navItems.map((item) => (
                  <NavLink
                    key={item.id}
                    to={item.path}
                    end={item.path === '/'}
                    className={({ isActive }) =>
                      `og-side-nav__link ${isActive ? 'is-active' : ''}`.trim()
                    }
                  >
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </nav>
          </aside>
          <div className="admin-layout__content">{children}</div>
        </div>
      </main>
      <SiteFooter
        tagline="Growing food, sharing seeds, and helping more people feel at home on the land."
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
