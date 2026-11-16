import { type MouseEvent, type ReactNode } from 'react';
import {
  AvatarMenu,
  Button,
  PageHero as SharedPageHero,
  SiteFooter as SharedSiteFooter,
  SiteHeader as SharedSiteHeader,
} from '@olivias/ui';
import type { PageHeroProps } from '@olivias/ui';
import type { AuthSession } from '../auth/session';
import type { AppRoute } from './routes';
import {
  adminUrl,
  candidProfileUrl,
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
  const marketingNavItems = navRoutes.map((route) => {
    // Learn vs. launch: the marketing page at /good-roots is the front door for
    // people who don't have an account yet. Once someone is signed in they've
    // already "learned" what the network is, so the same nav item launches them
    // straight into the app instead of showing marketing copy again. This keeps
    // "Garden Planner" meaning exactly one thing within a given auth state
    // and matches the app launcher in the account menu.
    if (route.path === '/good-roots' && authSession) {
      return {
        id: route.path,
        label: route.label,
        // No onSelect → the shared header renders a plain anchor and follows the
        // href, performing a real cross-app navigation rather than SPA routing.
        href: buildCrossAppUrl(goodRootsNetworkUrl, authSession),
      };
    }

    return {
      id: route.path,
      label: route.label,
      href: route.path,
      active: pathname === route.path,
      accent: route.path === '/donate',
      onSelect: () => onNavigate(route.path),
    };
  });

  const accountMobileItems = authSession
    ? [
        {
          id: 'profile',
          label: 'Profile',
          href: '/profile',
          active: pathname === '/profile',
          mobileOnly: true,
          divider: true,
          onSelect: () => onNavigate('/profile'),
        },
        {
          id: 'okra-submissions',
          label: 'My okra submissions',
          href: '/okra/submissions',
          active: pathname === '/okra/submissions',
          mobileOnly: true,
          onSelect: () => onNavigate('/okra/submissions'),
        },
        {
          id: 'grn-app',
          label: 'Garden Planner',
          href: buildCrossAppUrl(goodRootsNetworkUrl, authSession),
          mobileOnly: true,
          sectionLabel: 'Apps',
        },
        ...(authSession.user.isAdmin
          ? [{
              id: 'admin',
              label: 'Admin',
              href: buildCrossAppUrl(adminUrl, authSession),
              mobileOnly: true,
            }]
          : []),
        ...(onLogout
          ? [{
              id: 'logout',
              label: 'Log out',
              mobileOnly: true,
              divider: true,
              onSelect: onLogout,
            }]
          : []),
      ]
    : [{
        id: 'login',
        label: 'Log in',
        href: '/login',
        active: pathname === '/login',
        mobileOnly: true,
        divider: true,
        onSelect: () => onNavigate('/login'),
      }];

  const headerNavItems = [...marketingNavItems, ...accountMobileItems];

  return (
    <>
      <a className="skip-to-content" href="#main-content">Skip to main content</a>
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
                  { id: 'grn', label: 'Garden Planner', href: buildCrossAppUrl(goodRootsNetworkUrl, authSession) },
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
    </>
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
      meta={(
        <>
          {foundationOrganization.name} is a 501(c)(3) nonprofit organization, EIN {foundationOrganization.ein}. Donations are tax-deductible. ©{new Date().getFullYear()}{' '}
          <a href={candidProfileUrl} target="_blank" rel="noreferrer" className="og-site-footer__link og-site-footer__link--meta">
            {foundationOrganization.name}
          </a>
          . All rights reserved.
        </>
      )}
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
  ...props
}: PageHeroProps) {
  return <SharedPageHero {...props} />;
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
  effectiveDate,
  intro,
  children,
}: {
  title: string;
  effectiveDate: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <article className="legal-document">
      <header className="legal-document__header">
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
