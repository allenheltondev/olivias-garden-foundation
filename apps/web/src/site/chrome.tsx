import { type MouseEvent, type ReactNode } from 'react';
import {
  AvatarMenu,
  Button,
  SiteFooter as SharedSiteFooter,
  SiteHeader as SharedSiteHeader,
} from '@olivias/ui';
import type { AuthSession } from '../auth/session';
import type { AppRoute } from './routes';
import {
  adminUrl,
  facebookUrl,
  footerRoutes,
  goodRootsNetworkUrl,
  instagramUrl,
  legalFooterRoutes,
  navRoutes,
} from './routes';
import { foundationOrganization } from './organization';

export function buildCrossAppUrl(targetUrl: string, session: AuthSession) {
  try {
    const target = new URL(targetUrl);
    const payload = btoa(JSON.stringify({
      accessToken: session.accessToken,
      idToken: session.idToken,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt,
    }));
    return `${target.origin}${target.pathname}${target.search}#session=${payload}`;
  } catch {
    return targetUrl;
  }
}

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
  avatarUrl,
  onLogout,
}: {
  pathname: string;
  onNavigate: (path: string) => void;
  authEnabled: boolean;
  authSession: AuthSession | null;
  authBusy: boolean;
  authError: string | null;
  avatarUrl?: string | null;
  onLogout?: () => void;
}) {
  const initials = getUserInitials(authSession);
  const avatarLabel = authSession
    ? authSession.user.name ?? authSession.user.email ?? 'Signed-in account'
    : 'Go to login page';
  const headerNavItems = [
    ...navRoutes.map((route) => ({
      id: route.path,
      label: route.label,
      href: route.path,
      active: pathname === route.path,
      accent: route.path === '/donate',
      onSelect: () => onNavigate(route.path),
    })),
    {
      id: authSession ? 'profile' : 'login',
      label: authSession ? 'Profile' : 'Log in',
      href: authSession ? '/profile' : '/login',
      active: authSession ? pathname === '/profile' : pathname === '/login',
      mobileOnly: true,
      onSelect: () => onNavigate(authSession ? '/profile' : '/login'),
    },
  ];

  return (
    <SharedSiteHeader
      brandLogoSrc={foundationOrganization.logoImage}
      brandLogoAlt=""
      brandEyebrow={foundationOrganization.name}
      brandTitle="Homesteading, growing, and community"
      brandHref="/"
      onBrandClick={() => onNavigate('/')}
      navItems={headerNavItems}
      utility={(
        <div className="og-auth-utility">
          {authSession ? (
            <AvatarMenu
              initials={initials}
              label={avatarLabel}
              avatarUrl={avatarUrl}
              personalLinks={[
                { id: 'okra-submissions', label: 'My okra submissions', href: '/okra/submissions' },
              ]}
              appLinks={[
                { id: 'grn', label: 'Good Roots Network', href: buildCrossAppUrl(goodRootsNetworkUrl, authSession) },
                ...(authSession.user.isAdmin
                  ? [{ id: 'admin', label: 'Admin', href: buildCrossAppUrl(adminUrl, authSession) }]
                  : []),
              ]}
              onProfile={() => onNavigate('/profile')}
              onLogout={onLogout}
            />
          ) : (
            <a
              className="og-auth-utility__login"
              href="/login"
              aria-disabled={!authEnabled || authBusy || undefined}
              onClick={(event) => {
                if (!authEnabled || authBusy) {
                  event.preventDefault();
                  return;
                }

                event.preventDefault();
                onNavigate('/login');
              }}
            >
              Log in
            </a>
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
    href: route.path,
    active: currentPage.path === route.path,
    onSelect: () => onNavigate(route.path),
  }));
  const legalFooterLinks = legalFooterRoutes.map((route) => ({
    id: route.path,
    label: route.label,
    href: route.path,
    active: currentPage.path === route.path,
    onSelect: () => onNavigate(route.path),
  }));

  return (
    <SharedSiteFooter
      meta={`${foundationOrganization.name} is a 501(c)(3) nonprofit organization, EIN ${foundationOrganization.ein}. Donations are tax-deductible. ©2026 ${foundationOrganization.name}. All rights reserved.`}
      links={footerLinks}
      legalLinks={legalFooterLinks}
      socialLinks={[
        {
          id: 'instagram',
          href: instagramUrl,
          label: `Follow ${foundationOrganization.name} on Instagram`,
          icon: 'instagram',
        },
        {
          id: 'facebook',
          href: facebookUrl,
          label: `Follow ${foundationOrganization.name} on Facebook`,
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
  id,
  title,
  body,
  children,
  intro,
  className,
}: {
  id?: string;
  title: string;
  body?: string;
  intro?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`page-section ${className ?? ''}`.trim()}>
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
  href,
  onClick,
  variant = 'primary',
}: {
  children: ReactNode;
  href?: string;
  onClick?: (event: MouseEvent<HTMLAnchorElement | HTMLButtonElement>) => void;
  variant?: 'primary' | 'secondary';
}) {
  if (href) {
    return (
      <a className={`site-cta og-button og-button--${variant} og-button--md`} href={href} onClick={onClick}>
        {children}
      </a>
    );
  }

  return (
    <Button className="site-cta" variant={variant} onClick={onClick}>
      {children}
    </Button>
  );
}

export function LegalDocument({
  title,
  eyebrow = 'Legal',
  effectiveDate,
  intro,
  children,
}: {
  title: string;
  eyebrow?: string;
  effectiveDate: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <article className="legal-document">
      <header className="legal-document__header">
        <p className="legal-document__eyebrow">{eyebrow}</p>
        <h1 className="legal-document__title">{title}</h1>
        <p className="legal-document__effective">
          <span className="legal-document__effective-label">Effective date</span>
          <span className="legal-document__effective-value">{effectiveDate}</span>
        </p>
        {intro ? <div className="legal-document__intro">{intro}</div> : null}
      </header>
      <div className="legal-document__body">{children}</div>
    </article>
  );
}

export function LegalSection({
  id,
  number,
  title,
  children,
}: {
  id?: string;
  number: number;
  title: string;
  children: ReactNode;
}) {
  const anchor = id ?? `section-${number}`;
  return (
    <section id={anchor} className="legal-section">
      <h2 className="legal-section__heading">
        <a href={`#${anchor}`} className="legal-section__anchor" aria-label={`Link to ${title}`}>
          <span className="legal-section__number">{String(number).padStart(2, '0')}</span>
          <span className="legal-section__title">{title}</span>
        </a>
      </h2>
      <div className="legal-section__body">{children}</div>
    </section>
  );
}

export function LegalTableOfContents({
  items,
}: {
  items: { id: string; title: string }[];
}) {
  return (
    <nav className="legal-toc" aria-label="Table of contents">
      <p className="legal-toc__label">Contents</p>
      <ol className="legal-toc__list">
        {items.map((item, index) => (
          <li key={item.id} className="legal-toc__item">
            <a href={`#${item.id}`} className="legal-toc__link">
              <span className="legal-toc__number">{String(index + 1).padStart(2, '0')}</span>
              <span>{item.title}</span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
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
