import type { ReactNode } from 'react';
import { Button, SiteFooter as SharedSiteFooter, SiteHeader as SharedSiteHeader } from '@olivias/ui';
import type { AuthSession } from '../auth/session';
import type { AppRoute } from './routes';
import { facebookUrl, footerRoutes, goodRootsNetworkUrl, instagramUrl, navRoutes } from './routes';

export function getUserInitials(session: AuthSession | null) {
  if (!session) {
    return '?';
  }

  const source = session.user.name?.trim() || session.user.email?.trim() || '';
  if (!source) {
    return '?';
  }

  const parts = source
    .replace(/@.*/, '')
    .split(/[\s._-]+/)
    .filter(Boolean);

  const initials = parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('');
  return initials || source.slice(0, 2).toUpperCase();
}

export function SiteHeader({
  pathname,
  onNavigate,
  authEnabled,
  authSession,
  authBusy,
  authError,
}: {
  pathname: string;
  onNavigate: (path: string) => void;
  authEnabled: boolean;
  authSession: AuthSession | null;
  authBusy: boolean;
  authError: string | null;
}) {
  const initials = getUserInitials(authSession);
  const avatarLabel = authSession
    ? authSession.user.name ?? authSession.user.email ?? 'Signed-in account'
    : 'Go to login page';
  const headerNavItems = [
    ...navRoutes.map((route) => ({
      id: route.path,
      label: route.label,
      active: pathname === route.path,
      onSelect: () => onNavigate(route.path),
    })),
    ...(authSession
      ? [{
          id: 'good-roots-network',
          label: 'Good Roots Network',
          active: false,
          onSelect: () => window.location.assign(goodRootsNetworkUrl),
        }]
      : []),
    {
      id: authSession ? 'profile' : 'login',
      label: authSession ? 'Profile' : 'Log in',
      active: pathname === '/login',
      mobileOnly: true,
      onSelect: () => onNavigate('/login'),
    },
    {
      id: 'donate',
      label: 'Donate',
      active: pathname === '/donate',
      accent: true,
      onSelect: () => onNavigate('/donate'),
    },
  ];

  return (
    <SharedSiteHeader
      brandEyebrow="Olivia's Garden Foundation"
      brandTitle="Homesteading, growing, and community"
      onBrandClick={() => onNavigate('/')}
      navItems={headerNavItems}
      utility={(
        <div className="og-auth-utility">
          {authSession ? (
            <button
              type="button"
              className="og-auth-utility__avatar"
              onClick={() => onNavigate('/login')}
              aria-label={avatarLabel}
              title={avatarLabel}
            >
              {initials}
            </button>
          ) : (
            <button
              type="button"
              className="og-auth-utility__login"
              onClick={() => onNavigate('/login')}
              disabled={!authEnabled || authBusy}
            >
              Log in
            </button>
          )}
          {authError && pathname === '/login' ? <p className="og-login-page__error" role="alert">{authError}</p> : null}
        </div>
      )}
    />
  );
}

export function SiteFooter({
  currentPage,
  onNavigate,
}: {
  currentPage: AppRoute;
  onNavigate: (path: string) => void;
}) {
  const footerLinks = footerRoutes.map((route) => ({
    id: route.path,
    label: route.label,
    active: currentPage.path === route.path,
    onSelect: () => onNavigate(route.path),
  }));

  return (
    <SharedSiteFooter
      tagline={currentPage.path === '/donate'
        ? 'Founded in love. Growing for community.'
        : 'Growing food, sharing seeds, and helping more people feel at home on the land.'}
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
  );
}

export function PageHero({
  eyebrow,
  title,
  body,
  aside,
  actions,
  className,
  titleClassName,
  backgroundImage,
}: {
  eyebrow?: string;
  title: string;
  body: string;
  aside?: ReactNode;
  actions?: ReactNode;
  className?: string;
  titleClassName?: string;
  backgroundImage?: string;
}) {
  const backgroundImageValue = backgroundImage
    ? (backgroundImage.startsWith('/') ? `url(${backgroundImage})` : backgroundImage)
    : undefined;

  return (
    <section
      className={`page-hero ${backgroundImage ? 'page-hero--background' : ''} ${className ?? ''}`.trim()}
      style={backgroundImageValue ? { ['--page-hero-image' as string]: backgroundImageValue } : undefined}
    >
      <div className={`page-hero__copy ${backgroundImage ? 'page-hero__copy--overlay' : ''}`.trim()}>
        {eyebrow ? <p className="page-eyebrow">{eyebrow}</p> : null}
        <h1 className={titleClassName}>{title}</h1>
        <p className="page-hero__body">{body}</p>
        {actions ? <div className="page-hero__actions">{actions}</div> : null}
      </div>
      {aside ? <div className="page-hero__aside">{aside}</div> : null}
    </section>
  );
}

export function Section({
  title,
  body,
  children,
  intro,
  className,
}: {
  title: string;
  body?: string;
  intro?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`page-section ${className ?? ''}`.trim()}>
      <div className="page-section__heading">
        <h2>{title}</h2>
        {intro ? <p className="page-section__intro">{intro}</p> : null}
        {body ? <p className="page-section__body">{body}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function CtaButton({
  children,
  onClick,
  variant = 'primary',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary';
}) {
  return (
    <Button className="site-cta" variant={variant} onClick={onClick}>
      {children}
    </Button>
  );
}

export function WorkIcon({ kind }: { kind: 'sprout' | 'tool' | 'post' | 'hands' }) {
  const iconByKind = {
    sprout: '/images/icons/trowel.webp',
    tool: '/images/icons/seedling.webp',
    post: '/images/icons/pot.webp',
    hands: '/images/icons/hands.webp',
  } satisfies Record<'sprout' | 'tool' | 'post' | 'hands', string>;

  return <img src={iconByKind[kind]} alt="" aria-hidden="true" className="work-icon" />;
}
