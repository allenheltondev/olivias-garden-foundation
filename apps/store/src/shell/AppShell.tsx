import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AvatarMenu, Button, SiteFooter, SiteHeader } from '@olivias/ui';
import { signOut } from 'aws-amplify/auth';
import { useCart } from '../cart/CartContext';
import type { StoreSession } from '../auth/session';

const foundationLogo = '/images/icons/logo.svg';

const foundationHomeUrl = import.meta.env.VITE_FOUNDATION_URL
  ? import.meta.env.VITE_FOUNDATION_URL.replace(/\/+$/, '')
  : 'https://oliviasgarden.org';

const grnUrl = (import.meta.env.VITE_GRN_URL as string | undefined)?.replace(/\/+$/, '')
  ?? 'https://grn.oliviasgarden.org';

const adminUrl = (import.meta.env.VITE_ADMIN_URL as string | undefined)?.replace(/\/+$/, '')
  ?? 'https://admin.oliviasgarden.org';

const instagramUrl = 'https://instagram.com/oliviasgardentx';
const facebookUrl = 'https://www.facebook.com/profile.php?id=100087146659606#';

function getInitials(session: StoreSession): string {
  const source = session.displayName?.trim() || session.email?.trim() || '';
  if (!source) return 'A';
  const parts = source
    .replace(/@.*/, '')
    .split(/[\s._-]+/)
    .filter(Boolean);

  return (
    parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') ||
    source.slice(0, 2).toUpperCase()
  );
}

function CartIndicator() {
  const { itemCount } = useCart();
  return (
    <Link to="/cart" className="store-cart-indicator" aria-label={`Cart with ${itemCount} item${itemCount === 1 ? '' : 's'}`}>
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          d="M4 7h16l-1.2 11.1a2 2 0 0 1-2 1.9H7.2a2 2 0 0 1-2-1.9L4 7Zm4 0V5a4 4 0 0 1 8 0v2h-2V5a2 2 0 0 0-4 0v2H8Z"
          fill="currentColor"
        />
      </svg>
      <span className="store-cart-indicator__label">Cart</span>
      {itemCount > 0 ? <span className="store-cart-indicator__badge">{itemCount}</span> : null}
    </Link>
  );
}

const footerLinks = [
  { id: 'home', label: 'Foundation home', href: `${foundationHomeUrl}/` },
  { id: 'okra', label: 'Okra Project', href: `${foundationHomeUrl}/okra` },
];

const foundationHeaderNav = [
  { id: 'foundation-home', label: 'Home', href: `${foundationHomeUrl}/` },
  { id: 'foundation-about', label: 'About', href: `${foundationHomeUrl}/about` },
  { id: 'foundation-okra', label: 'Okra Project', href: `${foundationHomeUrl}/okra` },
];

export interface AppShellProps {
  session: StoreSession | null;
  onSignIn: () => void;
  children: ReactNode;
}

export function AppShell({ session, onSignIn, children }: AppShellProps) {
  const handleLogout = async () => {
    try {
      await signOut();
    } catch {
      // ignore
    }
    window.location.assign(`${foundationHomeUrl}/login`);
  };

  // Mobile-only nav items so signed-in shoppers can reach orders, the
  // admin app, and sign-out from the hamburger drawer. The desktop
  // utility area shows the AvatarMenu instead, which hides these on
  // wider screens via the SiteHeader's `mobileOnly` rule.
  const navItems = [
    ...foundationHeaderNav,
    ...(session
      ? [
          { id: 'mobile-orders', label: 'My orders', href: '/orders', mobileOnly: true },
          ...(session.isAdmin
            ? [{ id: 'mobile-admin', label: 'Admin', href: adminUrl, mobileOnly: true }]
            : []),
          {
            id: 'mobile-logout',
            label: 'Sign out',
            mobileOnly: true,
            onSelect: handleLogout,
          },
        ]
      : [
          {
            id: 'mobile-signin',
            label: 'Sign in',
            mobileOnly: true,
            onSelect: onSignIn,
          },
        ]),
  ];

  return (
    <div className="og-app-shell store-app-shell">
      <SiteHeader
        brandLogoSrc={foundationLogo}
        brandLogoAlt="Olivia's Garden Foundation"
        brandEyebrow="Olivia's Garden Foundation"
        brandTitle="Merch Store"
        brandHref="/"
        navItems={navItems}
        utility={(
          <div className="og-auth-utility store-utility">
            <CartIndicator />
            {session ? (
              <AvatarMenu
                initials={getInitials(session)}
                label={session.displayName || session.email || 'Account'}
                appLinks={[
                  { id: 'orders', label: 'My orders', href: '/orders' },
                  { id: 'foundation', label: 'Foundation home', href: foundationHomeUrl },
                  { id: 'grn', label: 'Good Roots Network', href: grnUrl },
                  ...(session.isAdmin
                    ? [{ id: 'admin', label: 'Admin', href: adminUrl }]
                    : []),
                ]}
                onLogout={handleLogout}
              />
            ) : (
              <Button size="sm" onClick={onSignIn}>
                Sign in
              </Button>
            )}
          </div>
        )}
      />
      <main className="store-shell-main">
        <div className="store-shell-main__inner">{children}</div>
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
