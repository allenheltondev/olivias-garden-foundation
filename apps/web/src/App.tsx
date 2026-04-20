import { type ClipboardEvent, type FormEvent, type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { loadStripe, type StripeEmbeddedCheckout } from '@stripe/stripe-js';
import { Button, Card, Input, SiteFooter as SharedSiteFooter, SiteHeader as SharedSiteHeader } from '@olivias/ui';
import {
  confirmSignUp,
  confirmPasswordReset,
  getCognitoConfig,
  requestPasswordReset,
  resendSignUpCode,
  restoreAuthSession,
  signInWithPassword,
  signOut,
  signUpWithPassword,
} from './auth/cognito';
import type { AuthSession } from './auth/session';
import { OkraExperience } from './okra/OkraExperience';

type Route = {
  path: string;
  label: string;
  showInNav?: boolean;
  showInFooter?: boolean;
  title: string;
  description: string;
  seoImage?: string;
  allowIndex?: boolean;
};

const routes: Route[] = [
  {
    path: '/',
    label: 'Home',
    showInNav: true,
    showInFooter: true,
    title: "Olivia's Garden Foundation",
    description: "Olivia's Garden Foundation is a Texas nonprofit teaching families to grow food, care for animals, preserve harvests, and build practical self-sufficiency.",
    seoImage: '/images/home/garden-landscaping.jpg',
  },
  {
    path: '/auth/callback',
    label: 'Auth callback',
    title: 'Sign in',
    description: 'Complete sign-in for the foundation web app.',
    allowIndex: false,
  },
  {
    path: '/login',
    label: 'Login',
    title: 'Log in',
    description: "Use one Good Roots Network account across Olivia's Garden experiences.",
    allowIndex: false,
  },
  {
    path: '/about',
    label: 'About',
    showInNav: true,
    showInFooter: true,
    title: "About Olivia's Garden",
    description: "Read Olivia's story, the foundation's mission, and the family-led work behind practical food-growing education in McKinney, Texas.",
    seoImage: '/images/about/luffa-trellis.jpg',
  },
  {
    path: '/get-involved',
    label: 'Get Involved',
    title: 'Get involved',
    description: "Find ways to support Olivia's Garden Foundation through volunteering, seed sharing, workshops, and community participation.",
    seoImage: '/images/home/watering-seedlings.jpg',
  },
  {
    path: '/seeds',
    label: 'Request Seeds',
    title: 'Request free okra seeds',
    description: "Request free okra seeds from Olivia's Garden Foundation and join a growing food project rooted in Olivia's seed line.",
    seoImage: '/images/okra/olivia-okra.jpg',
  },
  {
    path: '/okra',
    label: 'Okra Project',
    showInNav: true,
    showInFooter: true,
    title: 'The Okra Project',
    description: 'Explore the Okra Project map, request seeds, and follow a public invitation to grow food and share the story back.',
    seoImage: '/images/okra/olivia-okra.jpg',
  },
  {
    path: '/impact',
    label: 'Impact',
    title: "What we're building",
    description: "See what Olivia's Garden Foundation is growing now, from garden beds and animals to the next phase of community programs.",
    seoImage: '/images/home/produce-basket.jpg',
  },
  {
    path: '/donate',
    label: 'Donate',
    showInFooter: true,
    title: "Support Olivia's Garden",
    description: "Donate to Olivia's Garden Foundation through one-time gifts or Garden Club recurring support, with a permanent named garden marker for every donor.",
    seoImage: '/images/home/sunset-garden.jpg',
  },
  {
    path: '/contact',
    label: 'Contact',
    showInFooter: true,
    title: 'Get in touch',
    description: "Contact Olivia's Garden Foundation for volunteering, seeds, donations, partnerships, and general questions.",
    seoImage: '/images/home/bee-suit.jpg',
  },
];

const navRoutes = routes.filter((route) => route.showInNav);
const footerRoutes = routes.filter((route) => route.showInFooter);
const goodRootsNetworkUrl = import.meta.env.VITE_GRN_URL || 'https://goodroots.network';
const instagramUrl = 'https://instagram.com/oliviasgardentx';
const facebookUrl = 'https://www.facebook.com/profile.php?id=100087146659606#';
const webApiBase = (import.meta.env.VITE_WEB_API_BASE ?? '/api/web').replace(/\/+$/, '');
const siteUrl = (import.meta.env.VITE_SITE_URL ?? 'https://oliviasgarden.org').replace(/\/+$/, '');
const stripePublishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY?.trim() ?? '';
const stripePromise = stripePublishableKey ? loadStripe(stripePublishableKey) : null;

type DonationMode = 'one_time' | 'recurring';

type DonationCheckoutRequest = {
  mode: DonationMode;
  amountCents: number;
  returnUrl: string;
  donorName?: string;
  donorEmail?: string;
  dedicationName?: string;
  tShirtPreference?: string;
};

type DonationCheckoutResponse = {
  clientSecret: string;
  checkoutSessionId: string;
};

type DonationCheckoutSessionStatus = {
  sessionId: string;
  status: string;
  paymentStatus: string | null;
  customerEmail: string | null;
};

const internalPaths = new Set(routes.map((route) => route.path));

function createCorrelationId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `ogf-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function webApiUrl(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${webApiBase}${normalizedPath}`;
}

function absoluteUrl(path: string) {
  return path.startsWith('http://') || path.startsWith('https://') ? path : `${siteUrl}${path}`;
}

function ensureMeta(selector: string, attributes: Record<string, string>, content: string) {
  if (typeof document === 'undefined') {
    return;
  }

  let meta = document.head.querySelector(selector) as HTMLMetaElement | null;
  if (!meta) {
    meta = document.createElement('meta');
    Object.entries(attributes).forEach(([key, value]) => meta?.setAttribute(key, value));
    document.head.appendChild(meta);
  }

  meta.setAttribute('content', content);
}

function ensureLink(selector: string, rel: string, href: string) {
  if (typeof document === 'undefined') {
    return;
  }

  let link = document.head.querySelector(selector) as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.setAttribute('rel', rel);
    document.head.appendChild(link);
  }

  link.setAttribute('href', href);
}

function ensureStructuredData(id: string, payload: Record<string, unknown>) {
  if (typeof document === 'undefined') {
    return;
  }

  let script = document.head.querySelector(`script[data-seo-id="${id}"]`) as HTMLScriptElement | null;
  if (!script) {
    script = document.createElement('script');
    script.type = 'application/ld+json';
    script.dataset.seoId = id;
    document.head.appendChild(script);
  }

  script.textContent = JSON.stringify(payload);
}

async function createDonationCheckoutSession(
  payload: DonationCheckoutRequest,
  authSession: AuthSession | null,
): Promise<DonationCheckoutResponse> {
  const headers = new Headers({
    'Content-Type': 'application/json',
    'X-Correlation-Id': createCorrelationId(),
  });

  if (authSession?.accessToken) {
    headers.set('Authorization', `Bearer ${authSession.accessToken}`);
  }

  const response = await fetch(webApiUrl('/donations/checkout-session'), {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let message = 'Unable to start donation checkout right now.';

    try {
      const body = await response.json() as { error?: string };
      if (typeof body.error === 'string' && body.error.trim()) {
        message = body.error;
      }
    } catch {
      // Keep the generic fallback message.
    }

    throw new Error(message);
  }

  return await response.json() as DonationCheckoutResponse;
}

async function getDonationCheckoutSessionStatus(sessionId: string): Promise<DonationCheckoutSessionStatus> {
  const response = await fetch(`${webApiUrl('/donations/checkout-session-status')}?session_id=${encodeURIComponent(sessionId)}`, {
    method: 'GET',
    headers: {
      'X-Correlation-Id': createCorrelationId(),
    },
  });

  if (!response.ok) {
    let message = 'Unable to confirm donation status right now.';

    try {
      const body = await response.json() as { error?: string };
      if (typeof body.error === 'string' && body.error.trim()) {
        message = body.error;
      }
    } catch {
      // Keep the generic fallback message.
    }

    throw new Error(message);
  }

  return await response.json() as DonationCheckoutSessionStatus;
}

function getCurrentPath() {
  if (typeof window === 'undefined') {
    return '/';
  }

  const normalized = window.location.pathname.replace(/\/+$/, '') || '/';
  return internalPaths.has(normalized) ? normalized : '/';
}

function usePathname() {
  const [pathname, setPathname] = useState(getCurrentPath);

  useEffect(() => {
    const updatePath = () => setPathname(getCurrentPath());

    window.addEventListener('popstate', updatePath);
    return () => window.removeEventListener('popstate', updatePath);
  }, []);

  return {
    pathname,
    navigate(nextPath: string) {
      if (nextPath === pathname) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      window.history.pushState({}, '', nextPath);
      setPathname(nextPath);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
  };
}

function getUserInitials(session: AuthSession | null) {
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

function App() {
  const { pathname, navigate } = usePathname();
  const authConfig = getCognitoConfig();
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [loginModePreference, setLoginModePreference] = useState<'login' | 'signup'>('login');
  const page = routes.find((route) => route.path === pathname) ?? routes[0];

  useEffect(() => {
    const pageTitle = page.path === '/'
      ? `${page.title} | Grow Food, Learn Skills, Build Community`
      : `${page.title} | Olivia's Garden Foundation`;
    const pageUrl = absoluteUrl(pathname === '/' ? '/' : pathname);
    const pageImage = absoluteUrl(page.seoImage ?? '/images/home/garden-landscaping.jpg');
    const robots = page.allowIndex === false
      ? 'noindex, nofollow, noarchive'
      : 'index, follow, max-image-preview:large';

    document.title = pageTitle;
    ensureMeta('meta[name="description"]', { name: 'description' }, page.description);
    ensureMeta('meta[name="robots"]', { name: 'robots' }, robots);
    ensureMeta('meta[property="og:type"]', { property: 'og:type' }, 'website');
    ensureMeta('meta[property="og:site_name"]', { property: 'og:site_name' }, "Olivia's Garden Foundation");
    ensureMeta('meta[property="og:title"]', { property: 'og:title' }, pageTitle);
    ensureMeta('meta[property="og:description"]', { property: 'og:description' }, page.description);
    ensureMeta('meta[property="og:url"]', { property: 'og:url' }, pageUrl);
    ensureMeta('meta[property="og:image"]', { property: 'og:image' }, pageImage);
    ensureMeta('meta[name="twitter:card"]', { name: 'twitter:card' }, 'summary_large_image');
    ensureMeta('meta[name="twitter:title"]', { name: 'twitter:title' }, pageTitle);
    ensureMeta('meta[name="twitter:description"]', { name: 'twitter:description' }, page.description);
    ensureMeta('meta[name="twitter:image"]', { name: 'twitter:image' }, pageImage);
    ensureLink('link[rel="canonical"]', 'canonical', pageUrl);

    ensureStructuredData('organization', {
      '@context': 'https://schema.org',
      '@type': 'NonprofitOrganization',
      name: "Olivia's Garden Foundation",
      url: siteUrl,
      sameAs: [instagramUrl, facebookUrl],
    });

    ensureStructuredData('webpage', {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: pageTitle,
      description: page.description,
      url: pageUrl,
      isPartOf: {
        '@type': 'WebSite',
        name: "Olivia's Garden Foundation",
        url: siteUrl,
      },
    });
  }, [page, pathname]);

  useEffect(() => {
    let active = true;

    restoreAuthSession(authConfig)
      .then((session) => {
        if (!active) return;
        setAuthSession(session);
        setAuthReady(true);
      })
      .catch(() => {
        if (!active) return;
        setAuthSession(null);
        setAuthReady(true);
      });

    return () => {
      active = false;
    };
  }, [authConfig.clientId, authConfig.domain, authConfig.enabled, authConfig.userPoolId]);

  const openLoginPage = () => {
    setAuthError(null);
    setLoginModePreference('login');
    navigate('/login');
  };

  const openSignupPage = () => {
    setAuthError(null);
    setLoginModePreference('signup');
    navigate('/login');
  };

  const submitLogin = async (email: string, password: string) => {
    if (!authConfig.enabled) {
      throw new Error('Login is not configured for this environment yet.');
    }

    setAuthError(null);
    setAuthBusy(true);
    try {
      const session = await signInWithPassword(authConfig, email, password);
      setAuthSession(session);
      return session;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to sign in.';
      setAuthError(message);
      throw new Error(message);
    } finally {
      setAuthBusy(false);
    }
  };

  const submitSignup = async (
    email: string,
    password: string,
    firstName: string,
    lastName: string,
    newsletterOptIn: boolean,
  ) => {
    if (!authConfig.enabled) {
      throw new Error('Login is not configured for this environment yet.');
    }

    setAuthError(null);
    setAuthBusy(true);
    try {
      return await signUpWithPassword(authConfig, email, password, firstName, lastName, newsletterOptIn);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to create your account.';
      setAuthError(message);
      throw new Error(message);
    } finally {
      setAuthBusy(false);
    }
  };

  const submitPasswordResetRequest = async (email: string) => {
    if (!authConfig.enabled) {
      throw new Error('Login is not configured for this environment yet.');
    }

    setAuthError(null);
    setAuthBusy(true);
    try {
      await requestPasswordReset(authConfig, email);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to send reset instructions.';
      setAuthError(message);
      throw new Error(message);
    } finally {
      setAuthBusy(false);
    }
  };

  const submitPasswordResetConfirm = async (email: string, code: string, password: string) => {
    if (!authConfig.enabled) {
      throw new Error('Login is not configured for this environment yet.');
    }

    setAuthError(null);
    setAuthBusy(true);
    try {
      await confirmPasswordReset(authConfig, email, code, password);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to reset your password.';
      setAuthError(message);
      throw new Error(message);
    } finally {
      setAuthBusy(false);
    }
  };

  const submitSignUpConfirmation = async (email: string, code: string) => {
    if (!authConfig.enabled) {
      throw new Error('Login is not configured for this environment yet.');
    }

    setAuthError(null);
    setAuthBusy(true);
    try {
      await confirmSignUp(authConfig, email, code);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to verify your email.';
      setAuthError(message);
      throw new Error(message);
    } finally {
      setAuthBusy(false);
    }
  };

  const resendSignupVerification = async (email: string) => {
    if (!authConfig.enabled) {
      throw new Error('Login is not configured for this environment yet.');
    }

    setAuthError(null);
    setAuthBusy(true);
    try {
      await resendSignUpCode(authConfig, email);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to resend the verification code.';
      setAuthError(message);
      throw new Error(message);
    } finally {
      setAuthBusy(false);
    }
  };

  const handleLogout = () => {
    setAuthSession(null);
    signOut(authConfig);
  };

  return (
    <div className="og-app-shell">
      <SiteHeader
        pathname={pathname}
        onNavigate={navigate}
        authEnabled={authConfig.enabled}
        authSession={authSession}
        authBusy={authBusy || !authReady}
        authError={authError}
      />
      <main className={`og-app-main ${pathname === '/login' ? 'og-app-main--flush' : ''}`.trim()}>
        {pathname === '/' ? <HomePage onNavigate={navigate} /> : null}
        {pathname === '/auth/callback' ? <AuthCallbackPage /> : null}
        {pathname === '/login' ? (
          <LoginPage
            authEnabled={authConfig.enabled}
            authSession={authSession}
            authBusy={authBusy || !authReady}
            authError={authError}
            defaultMode={loginModePreference}
            onSubmitLogin={submitLogin}
            onSubmitSignup={submitSignup}
            onConfirmSignup={submitSignUpConfirmation}
            onResendSignupCode={resendSignupVerification}
            onRequestPasswordReset={submitPasswordResetRequest}
            onConfirmPasswordReset={submitPasswordResetConfirm}
            onLogout={handleLogout}
            onNavigate={navigate}
          />
        ) : null}
        {pathname === '/about' ? <AboutPage /> : null}
        {pathname === '/get-involved' ? <GetInvolvedPage onNavigate={navigate} /> : null}
        {pathname === '/okra' ? (
          <OkraPage
            onNavigate={navigate}
            authEnabled={authConfig.enabled}
            authSession={authSession}
            onLogin={openLoginPage}
            onSignup={openSignupPage}
          />
        ) : null}
        {pathname === '/impact' ? <ImpactPage onNavigate={navigate} /> : null}
        {pathname === '/donate' ? <DonatePage onNavigate={navigate} authSession={authSession} /> : null}
        {pathname === '/contact' ? <ContactPage /> : null}
        {pathname === '/seeds' ? <SeedsPage onNavigate={navigate} /> : null}
      </main>
      <SiteFooter currentPage={page} onNavigate={navigate} />
    </div>
  );
}

function SiteHeader({
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

function SiteFooter({
  currentPage,
  onNavigate,
}: {
  currentPage: Route;
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
  );
}

function PageHero({
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
  return (
    <section
      className={`page-hero ${backgroundImage ? 'page-hero--background' : ''} ${className ?? ''}`.trim()}
      style={backgroundImage ? { ['--page-hero-image' as string]: `url(${backgroundImage})` } : undefined}
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

function Section({
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

function CtaButton({
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

function WorkIcon({ kind }: { kind: 'sprout' | 'tool' | 'post' | 'hands' }) {
  const iconByKind = {
    sprout: '/images/icons/trowel.webp',
    tool: '/images/icons/seedling.webp',
    post: '/images/icons/pot.webp',
    hands: '/images/icons/hands.webp',
  } satisfies Record<'sprout' | 'tool' | 'post' | 'hands', string>;

  return <img src={iconByKind[kind]} alt="" aria-hidden="true" className="work-icon" />;
}

function HomePage({ onNavigate }: { onNavigate: (path: string) => void; }) {
  return (
    <>
      <PageHero
        title="Learn to grow food. Learn to keep it going."
        body="Olivia's Garden Foundation is a 501(c)(3) nonprofit in McKinney, Texas helping individuals and families learn how to grow food, care for animals, preserve what they produce, and build practical self-sufficiency."
        className="home-hero"
        titleClassName="home-hero__title"
        backgroundImage="/images/home/garden-landscaping.jpg"
        actions={
          <a
            className="home-hero__cta"
            href="https://instagram.com/oliviasgardentx"
            target="_blank"
            rel="noreferrer"
          >
            Get involved
          </a>
        }
      />

      <section className="home-mission-band" aria-label="Mission">
        <div className="home-mission-band__copy">
          <p className="home-mission-band__eyebrow">Mission</p>
          <h2>Practical food-growing education for families and the wider community.</h2>
          <p>
            We teach through real work on a functioning property in McKinney, then share that work
            in ways that help more people start growing, raising, preserving, and sharing food of
            their own while connecting growers with each other and with people in their communities
            who need fresh food.
          </p>
        </div>
      </section>

      <section className="page-section home-photo-band-section">
        <div className="home-photo-band" aria-label="Life and work at the foundation">
          <img
            className="home-photo-band__image"
            src="/images/home/melon-harvest.jpg"
            alt="Harvesting in raised beds with a child."
          />
          <img
            className="home-photo-band__image"
            src="/images/home/watering-seedlings.jpg"
            alt="Watering seedlings in a raised garden bed."
          />
          <img
            className="home-photo-band__image home-photo-band__image--mobile-hide"
            src="/images/home/bee-suit.jpg"
            alt="Working bees with a child in protective gear."
          />

        </div>
      </section>

      <section className="home-mobile-image-break" aria-label="Life and work at the foundation">
        <img
          className="home-mobile-image-break__image"
          src="/images/home/melon-harvest.jpg"
          alt="Harvesting in raised beds with a child."
        />
      </section>

      <Section
        title="What we do"
        intro="We share what we learn from doing the work ourselves and staying close to what  helps people get started."
        className="section-teach"
      >
        <div className="home-teach-grid" aria-label="Core focus areas">
          <div className="home-teach-stack">
            <article className="home-teach-item">
              <div className="home-teach-item__body">
                <div className="home-teach-item__heading">
                  <div className="home-teach-item__icon"><WorkIcon kind="sprout" /></div>
                  <h3>Teach from real work</h3>
                </div>
                <p>If we're sharing it, it's something we're actively doing.</p>
              </div>
            </article>
            <article className="home-teach-item">
              <div className="home-teach-item__body">
                <div className="home-teach-item__heading">
                  <div className="home-teach-item__icon"><WorkIcon kind="tool" /></div>
                  <h3>Make starting feel possible</h3>
                </div>
                <p>This should feel within reach. The goal is to make getting started simpler.</p>
              </div>
            </article>
            <article className="home-teach-item">
              <div className="home-teach-item__body">
                <div className="home-teach-item__heading">
                  <div className="home-teach-item__icon"><WorkIcon kind="post" /></div>
                  <h3>Stay honest about the work</h3>
                </div>
                <p>This is a working place. Some days are messy, and we show that too.</p>
              </div>
            </article>
            <article className="home-teach-item">
              <div className="home-teach-item__body">
                <div className="home-teach-item__heading">
                  <div className="home-teach-item__icon"><WorkIcon kind="hands" /></div>
                  <h3>Share what helps</h3>
                </div>
                <p>The goal isn't just to grow here. It's to help more people start where they are.</p>
              </div>
            </article>
          </div>
        </div>
      </Section>

      <section className="home-mobile-image-break" aria-label="Learning through real work">
        <img
          className="home-mobile-image-break__image"
          src="/images/home/watering-seedlings.jpg"
          alt="Watering seedlings in a raised garden bed."
        />
      </section>

      <Section title="Ways to take part" className="section-take-part">
        <div className="home-action-grid">
          <article className="home-editorial-block home-editorial-block--action">
            <h3>Who is Olivia?</h3>
            <p>
              Olivia was a true Texas cowgirl who loved being outside, spending time in the garden, and interacting with animals. Learn more about her.
            </p>
            <CtaButton onClick={() => onNavigate('/about')} variant="secondary">Olivia's story</CtaButton>
          </article>
          <article className="home-editorial-block home-editorial-block--action">
            <h3>Get free okra seeds</h3>
            <p>
              The foundation gives away free okra seeds from a line of plants Olivia grew herself.
              It is meant to be an easy, generous way for people to start growing food.
            </p>
            <CtaButton onClick={() => onNavigate('/okra')} variant="secondary">Request your seeds</CtaButton>
          </article>
          <article className="home-editorial-block home-editorial-block--action">
            <h3>Support the work</h3>
            <p>
              You can directly support the garden,
              animals, tools, and community-facing programs to keep growing.
            </p>
            <CtaButton onClick={() => onNavigate('/donate')} variant="secondary">Donate</CtaButton>
          </article>
          <article className="home-editorial-block home-editorial-block--action">
            <h3>Follow along</h3>
            <p>
              Instagram is the best place to see what is growing, what is being built, and what the
              day-to-day work actually looks like.
            </p>
            <a
              className="home-action-link home-action-link--secondary"
              href="https://instagram.com/oliviasgardentx"
              target="_blank"
              rel="noreferrer"
            >
              Follow us
            </a>
          </article>

        </div>
      </Section>

    </>
  );
}

function AboutPage() {
  return (
    <div className="about-prose-page">
      <section className="about-prose-hero" aria-label="About Olivia's Garden">
        <div className="about-prose-hero__copy">
          <div className="about-prose-hero__header">
            <p className="about-prose-hero__eyebrow">In Olivia&apos;s memory</p>
            <h1>About Olivia&apos;s Garden</h1>
            <p className="about-prose-hero__dek">
              The story behind the foundation, the family, and the work being built in Olivia&apos;s memory.
            </p>
          </div>
          <div className="about-prose-hero__story">
            <p>
            Olivia used to pull things off plants and eat them raw, right there in the garden.
            Dragon&apos;s tongue green beans. Borage flowers. Colossus marigold heads. She&apos;d pop
            them into her mouth in front of company like it was a magic trick, this big grin,
            totally pleased with herself. She thought it was the coolest thing in the world that
            you could grow something and eat it before you even made it back inside.
            </p>
            <p>
            She loved okra most of all. Straight off the plant. That is still how we eat it.
            </p>
            <p>
            She was four years old. Tough as nails. An absolute cowgirl. She herded the goats and
            fed the chickens and wanted to be part of whatever was happening on the land. She and
            her dad Allen used to walk the property together and throw out ideas about what they
            would plant, what they would build someday. Nothing finished. Just ideas tossed into
            the air between them.
            </p>
            <p>
            She was diagnosed with AML in 2023. Acute myeloid leukemia. We fought it for seven and
            a half months. Children&apos;s Medical Center in Plano was our home base. We also traveled
            to St. Jude in Memphis, Nationwide Children&apos;s in Columbus, and Seattle Children&apos;s
            Hospital. We were preparing for a bone marrow transplant when she passed.
            </p>
          </div>
        </div>

        <figure className="photo-card photo-card--tall about-prose-hero__image">
          <img
            src="/images/home/sunset-garden.jpg"
            alt="Sunset over the garden beds at Olivia's Garden."
          />
          <figcaption>The land where her memory keeps taking shape.</figcaption>
        </figure>
      </section>

      <hr className="about-divider" />

        <section className="about-prose-block about-prose-block--origin" aria-label="How the foundation began">
          <p className="about-prose-block__eyebrow">How it began</p>
          <p>
            After Olivia passed, Allen and Mallory wanted to build something in her memory. They had
            seen up close what families in treatment go through. The logistics are relentless. Access
            to fresh, local food is harder than it should be. The first idea was straightforward:
            start a foundation to grow and provide locally available food to families who needed it
          most.
        </p>
        <p>
          Then they started building the garden. And as they built, they kept coming back to
          Olivia. How much she loved being out here. How naturally she took to it. How the things
          she was learning at four years old were the kind of things most people never learn at
          all. The mission grew from there. Not just food. Skills. The kind that stay with a
          person, that make a family more capable and more self-reliant. Teach someone to grow food
          and you have changed what they are capable of for the rest of their lives.
        </p>
      </section>

      <hr className="about-divider" />

        <section className="about-memory-layout" aria-label="Building the garden">
          <div className="about-prose-block">
            <p className="about-prose-block__eyebrow">Building the garden</p>
            <p>
              Allen sat down and designed the garden she always wanted.
            </p>
            <p>
              He pulled in everything they had talked about on those walks. Her ideas, her favorite
            things to grow, the way she moved through the land. Then they built it. Six raised beds
            became a quarter-acre memorial garden. Volunteers showed up. The community showed up.
            Their daughter Isabella helped however she could.
          </p>
          <p>
            It was a hard year. Building was the channel for grief, the thing that made it possible
            to get through each day. And watching the community pour in made something clear that
            they already suspected: teaching people to grow things, raise things, care for a piece
            of land was the right thing to build toward.
          </p>
          <p>
            The Colossus marigolds go in every season. Olivia&apos;s favorite. They always will.
          </p>
        </div>

        <figure className="photo-card about-memory-layout__image">
          <img
            src="/images/about/luffa-trellis.jpg"
            alt="Garden rows and trellised plants at Olivia's Garden."
          />
          <figcaption>Built by hand, in memory, with the community alongside us.</figcaption>
        </figure>
      </section>

      <hr className="about-divider" />

        <section className="about-prose-block about-prose-block--closing" aria-label="Who runs the foundation">
          <p className="about-prose-block__eyebrow">Who runs it</p>
          <p>
            Olivia&apos;s Garden Foundation is run by the Helton family. Allen, Mallory, and Isabella,
            out of McKinney, Texas.
          </p>
        <p>
          We are not experts. We are a family who loves a little girl who loved this land, and we
          are doing our best to honor that by sharing what we know and building something useful for
          other people.
        </p>
        <p>
          If you are going through what we went through, AML or any childhood cancer, and you want
          to talk to someone who has been there, we are here for that too.
        </p>
        <p>
          We are still learning. We are building in public. And we are glad you found us.
        </p>
      </section>
    </div>
  );
}

function GetInvolvedPage({ onNavigate }: { onNavigate: (path: string) => void; }) {
  return (
    <>
      <PageHero
        eyebrow="Get Involved"
        title="Get involved"
        body="There are a few clear ways to be part of the work here now, and a few more that are being built honestly instead of rushed."
      />

      <div className="stack-grid get-involved-grid">
        <Card title="Start with seeds. Literally." className="get-involved-card">
          <p className="get-involved-card__eyebrow">Easiest first step</p>
          <p>
            The easiest way into this is okra. It&apos;s one of the most forgiving plants you can grow.
            It tolerates heat, bounces back from neglect, and produces more than you expect.
          </p>
          <CtaButton onClick={() => onNavigate('/seeds')}>Request your free okra seeds</CtaButton>
        </Card>

        <Card title="Come work the land." className="get-involved-card">
          <p className="get-involved-card__eyebrow">In person</p>
          <p>
            We run regular work days tied to garden prep, animal care, event setup,
            whatever needs doing that week. It&apos;s real work and you&apos;ll go home tired.
          </p>
          <ul className="site-list">
            <li>Garden work days and bed prep</li>
            <li>Animal care for chickens, turkeys, geese, goats, bees, and guineas</li>
            <li>Event and workshop support</li>
          </ul>
          <CtaButton onClick={() => onNavigate('/contact')}>Sign up to volunteer</CtaButton>
        </Card>

        <Card title="Hands-on workshops -- coming soon." className="get-involved-card">
          <p className="get-involved-card__eyebrow">Coming soon</p>
          <p>
            Workshops are planned, but they are not active yet. When they launch, they will be
            built around real tasks and hands-on learning, not classroom-style theory.
          </p>
          <CtaButton variant="secondary">Notify me when workshops open</CtaButton>
        </Card>

        <Card title="Help us map where food is growing." className="get-involved-card">
          <p className="get-involved-card__eyebrow">Online</p>
          <p>
            The Okra Project is a living map of people growing food. If you&apos;re growing food
            anywhere, add your pin. Every garden on the map makes the case that this is normal,
            widespread, and worth doing.
          </p>
          <CtaButton onClick={() => onNavigate('/okra')}>View the Okra Project map</CtaButton>
        </Card>
      </div>

      <Section
        title="Follow along."
        body="We post what is actually happening in the work: harvests, setbacks, animals, systems, and the day-to-day reality of learning by doing."
      >
        <CtaButton variant="secondary">Follow us on Instagram</CtaButton>
      </Section>
    </>
  );
}

function AuthCallbackPage() {
  return (
    <>
      <PageHero
        eyebrow="Sign in"
        title="Sign in from the login page"
        body="This route was kept so older auth links do not break, but the site now uses a custom sign-in form on the login page."
      />
    </>
  );
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validatePassword(value: string) {
  if (value.length < 8) {
    return 'Use at least 8 characters.';
  }

  if (!/[A-Z]/.test(value)) {
    return 'Include at least one uppercase letter.';
  }

  if (!/[a-z]/.test(value)) {
    return 'Include at least one lowercase letter.';
  }

  if (!/[0-9]/.test(value)) {
    return 'Include at least one number.';
  }

  if (!/[^A-Za-z0-9]/.test(value)) {
    return 'Include at least one special character.';
  }

  return null;
}

const VERIFICATION_CODE_LENGTH = 6;

function normalizeVerificationCode(value: string) {
  return value.replace(/[^a-zA-Z0-9]/g, '').slice(0, VERIFICATION_CODE_LENGTH);
}

function VerificationCodeInput({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const characters = Array.from({ length: VERIFICATION_CODE_LENGTH }, (_, index) => value[index] ?? '');

  const updateValue = (nextValue: string, focusIndex?: number) => {
    const normalized = normalizeVerificationCode(nextValue);
    onChange(normalized);

    if (focusIndex === undefined) {
      return;
    }

    window.requestAnimationFrame(() => {
      inputRefs.current[focusIndex]?.focus();
      inputRefs.current[focusIndex]?.select();
    });
  };

  const handleInputChange = (index: number, nextCharacter: string) => {
    const sanitized = normalizeVerificationCode(nextCharacter);
    if (!sanitized) {
      const nextChars = [...characters];
      nextChars[index] = '';
      updateValue(nextChars.join(''), index);
      return;
    }

    if (sanitized.length > 1) {
      const nextChars = [...characters];
      for (let offset = 0; offset < sanitized.length && index + offset < VERIFICATION_CODE_LENGTH; offset += 1) {
        nextChars[index + offset] = sanitized[offset] ?? '';
      }
      updateValue(nextChars.join(''), Math.min(index + sanitized.length, VERIFICATION_CODE_LENGTH - 1));
      return;
    }

    const nextChars = [...characters];
    nextChars[index] = sanitized;
    updateValue(nextChars.join(''), Math.min(index + 1, VERIFICATION_CODE_LENGTH - 1));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>, index: number) => {
    if (event.key === 'Backspace' && !characters[index] && index > 0) {
      event.preventDefault();
      const nextChars = [...characters];
      nextChars[index - 1] = '';
      updateValue(nextChars.join(''), index - 1);
    }

    if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      inputRefs.current[index - 1]?.focus();
    }

    if (event.key === 'ArrowRight' && index < VERIFICATION_CODE_LENGTH - 1) {
      event.preventDefault();
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    updateValue(event.clipboardData.getData('text'), VERIFICATION_CODE_LENGTH - 1);
  };

  return (
    <div className="og-verification-code" role="group" aria-label="Verification code">
      {characters.map((character, index) => (
        <input
          key={index}
          ref={(element) => {
            inputRefs.current[index] = element;
          }}
          className="og-verification-code__slot"
          type="text"
          inputMode="numeric"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          value={character}
          onChange={(event) => handleInputChange(index, event.target.value)}
          onKeyDown={(event) => handleKeyDown(event, index)}
          onPaste={handlePaste}
          disabled={disabled}
          aria-label={`Verification code character ${index + 1}`}
        />
      ))}
    </div>
  );
}

function LoginPage({
  authEnabled,
  authSession,
  authBusy,
  authError,
  defaultMode,
  onSubmitLogin,
  onSubmitSignup,
  onConfirmSignup,
  onResendSignupCode,
  onRequestPasswordReset,
  onConfirmPasswordReset,
  onLogout,
  onNavigate,
}: {
  authEnabled: boolean;
  authSession: AuthSession | null;
  authBusy: boolean;
  authError: string | null;
  defaultMode: 'login' | 'signup';
  onSubmitLogin: (email: string, password: string) => Promise<AuthSession>;
  onSubmitSignup: (
    email: string,
    password: string,
    firstName: string,
    lastName: string,
    newsletterOptIn: boolean,
  ) => Promise<{ userConfirmed: boolean }>;
  onConfirmSignup: (email: string, code: string) => Promise<void>;
  onResendSignupCode: (email: string) => Promise<void>;
  onRequestPasswordReset: (email: string) => Promise<void>;
  onConfirmPasswordReset: (email: string, code: string, password: string) => Promise<void>;
  onLogout: () => void;
  onNavigate: (path: string) => void;
}) {
  const displayName = authSession?.user.name ?? authSession?.user.email ?? 'Good Roots Network member';
  const initials = getUserInitials(authSession);
  const [mode, setMode] = useState<'login' | 'signup' | 'verify' | 'forgot'>(defaultMode);
  const [forgotStep, setForgotStep] = useState<'request' | 'confirm'>('request');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [newsletterOptIn, setNewsletterOptIn] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [showPasswordHint, setShowPasswordHint] = useState(false);

  useEffect(() => {
    setMode(defaultMode);
    setForgotStep('request');
    setLocalError(null);
    setStatusMessage(null);
    setShowPasswordHint(false);
  }, [defaultMode]);

  const handleModeChange = (nextMode: 'login' | 'signup') => {
    setMode(nextMode);
    setForgotStep('request');
    setLocalError(null);
    setStatusMessage(null);
    setShowPasswordHint(false);
  };

  const startForgotPassword = () => {
    setMode('forgot');
    setForgotStep('request');
    setLocalError(null);
    setStatusMessage(null);
    setShowPasswordHint(false);
    setPassword('');
    setConfirmPassword('');
    setResetCode('');
  };

  const startVerification = (nextEmail: string) => {
    setMode('verify');
    setForgotStep('request');
    setEmail(nextEmail);
    setPassword('');
    setConfirmPassword('');
    setResetCode('');
    setLocalError(null);
    setStatusMessage('Enter the verification code we sent to your email.');
    setShowPasswordHint(false);
  };

  const handleResendVerification = async () => {
    const trimmedEmail = email.trim();
    if (!isValidEmail(trimmedEmail)) {
      setLocalError('Please enter a valid email address.');
      return;
    }

    setLocalError(null);
    setStatusMessage(null);

    try {
      await onResendSignupCode(trimmedEmail);
      setStatusMessage('A new verification code is on the way.');
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Unable to resend the code.');
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedEmail = email.trim();
    if (!isValidEmail(trimmedEmail)) {
      setShowPasswordHint(false);
      setLocalError('Please enter a valid email address.');
      return;
    }

    if ((mode === 'login' || mode === 'signup' || (mode === 'forgot' && forgotStep === 'confirm')) && !password) {
      setShowPasswordHint(false);
      setLocalError('Password is required.');
      return;
    }

    if (mode === 'signup') {
      if (!firstName.trim()) {
        setShowPasswordHint(false);
        setLocalError('First name is required.');
        return;
      }

      if (!lastName.trim()) {
        setShowPasswordHint(false);
        setLocalError('Last name is required.');
        return;
      }

      const passwordError = validatePassword(password);
      if (passwordError) {
        setShowPasswordHint(true);
        setLocalError(passwordError);
        return;
      }

      if (password !== confirmPassword) {
        setShowPasswordHint(false);
        setLocalError('Passwords do not match.');
        return;
      }
    }

    if (mode === 'forgot' && forgotStep === 'confirm') {
      if (normalizeVerificationCode(resetCode).length !== VERIFICATION_CODE_LENGTH) {
        setShowPasswordHint(false);
        setLocalError('Enter the 6-character verification code.');
        return;
      }

      const passwordError = validatePassword(password);
      if (passwordError) {
        setShowPasswordHint(true);
        setLocalError(passwordError);
        return;
      }

      if (password !== confirmPassword) {
        setShowPasswordHint(false);
        setLocalError('Passwords do not match.');
        return;
      }
    }

    if (mode === 'verify' && normalizeVerificationCode(resetCode).length !== VERIFICATION_CODE_LENGTH) {
      setShowPasswordHint(false);
      setLocalError('Enter the 6-character verification code.');
      return;
    }

    setShowPasswordHint(false);
    setLocalError(null);
    setStatusMessage(null);

    try {
      if (mode === 'login') {
        const session = await onSubmitLogin(trimmedEmail, password);
        const redirectTo = new URLSearchParams(window.location.search).get('redirect');
        if (redirectTo) {
          try {
            const redirectOrigin = new URL(redirectTo).origin;
            const isCrossOrigin = redirectOrigin !== window.location.origin;
            if (isCrossOrigin) {
              const payload = btoa(JSON.stringify({
                accessToken: session.accessToken,
                idToken: session.idToken,
                refreshToken: session.refreshToken,
                expiresAt: session.expiresAt,
              }));
              window.location.assign(`${redirectTo}#session=${payload}`);
            } else {
              window.location.assign(redirectTo);
            }
          } catch {
            onNavigate('/');
          }
        } else {
          onNavigate('/');
        }
        return;
      }

      if (mode === 'signup') {
        const result = await onSubmitSignup(
          trimmedEmail,
          password,
          firstName.trim(),
          lastName.trim(),
          newsletterOptIn,
        );
        setFirstName('');
        setLastName('');
        setPassword('');
        setConfirmPassword('');
        setNewsletterOptIn(false);
        if (result.userConfirmed) {
          setMode('login');
          setStatusMessage('Account created. You can log in now.');
        } else {
          startVerification(trimmedEmail);
        }
        return;
      }

      if (mode === 'verify') {
        await onConfirmSignup(trimmedEmail, normalizeVerificationCode(resetCode));
        setMode('login');
        setResetCode('');
        setStatusMessage('Email verified. You can log in now.');
        return;
      }

      if (mode === 'forgot' && forgotStep === 'request') {
        await onRequestPasswordReset(trimmedEmail);
        setForgotStep('confirm');
        setPassword('');
        setConfirmPassword('');
        setStatusMessage("If there's an account for that email, we've sent a verification code.");
        return;
      }

      if (mode === 'forgot' && forgotStep === 'confirm') {
        await onConfirmPasswordReset(trimmedEmail, normalizeVerificationCode(resetCode), password);
        setMode('login');
        setForgotStep('request');
        setPassword('');
        setConfirmPassword('');
        setResetCode('');
        setStatusMessage('Password reset. You can log in with your new password now.');
        return;
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'Please verify your email address before logging in.') {
        startVerification(trimmedEmail);
        return;
      }

      setLocalError(error instanceof Error ? error.message : 'Unable to continue.');
    }
  };

  return (
    <section className="og-login-page">
      <div className="og-login-page__backdrop">
        <div className="og-login-page__card">
          {authEnabled ? (
            authSession ? (
              <>
                <p className="og-login-page__eyebrow">Olivia&apos;s Garden</p>
                <div className="og-login-page__account">
                  <div className="og-login-page__account-avatar" aria-hidden="true">{initials}</div>
                  <div className="og-login-page__account-copy">
                    <p className="og-login-page__account-eyebrow">Signed in</p>
                    <p className="og-login-page__account-name">{displayName}</p>
                    <p className="og-login-page__account-body">
                      You&apos;re all set. Head back to the okra project or sign out here.
                    </p>
                  </div>
                </div>

                <div className="og-login-page__footer">
                  <button type="button" className="og-login-page__link" onClick={() => onNavigate('/okra')}>
                    Back to the Okra Project
                  </button>
                  <button type="button" className="og-login-page__link og-login-page__link--danger" onClick={onLogout}>
                    Log out
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="og-login-page__eyebrow">Olivia&apos;s Garden</p>
                <h1 className="og-login-page__title">
                  {mode === 'login'
                    ? 'Welcome back!'
                    : mode === 'signup'
                      ? 'Create your account.'
                      : mode === 'verify'
                        ? 'Verify your email.'
                      : forgotStep === 'request'
                        ? 'Reset your password.'
                        : 'Choose a new password.'}
                </h1>

                {mode === 'signup' ? (
                  <div className="og-login-page__benefits">
                    <p className="og-login-page__benefits-title">With an account you can:</p>
                    <ul className="og-login-page__benefits-list">
                      <li>Access the Good Roots Network</li>
                      <li>Edit your okra photo submissions instead of starting over each time.</li>
                    </ul>
                  </div>
                ) : null}

                {mode === 'forgot' ? (
                  <p className="og-login-page__body">
                    {forgotStep === 'request'
                      ? 'Enter your email and we will send a verification code to reset your password.'
                      : 'Use the code from your email and choose a new password.'}
                  </p>
                ) : null}

                {mode === 'verify' ? (
                  <p className="og-login-page__body">
                    Enter the verification code we sent to your email to finish setting up your account.
                  </p>
                ) : null}

                {mode !== 'forgot' && mode !== 'verify' ? (
                  <div className="og-login-page__switch" role="tablist" aria-label="Authentication mode">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={mode === 'login'}
                      className={`og-login-page__switch-option ${mode === 'login' ? 'is-active' : ''}`.trim()}
                      onClick={() => handleModeChange('login')}
                    >
                      Log in
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={mode === 'signup'}
                      className={`og-login-page__switch-option ${mode === 'signup' ? 'is-active' : ''}`.trim()}
                      onClick={() => handleModeChange('signup')}
                    >
                      Sign up
                    </button>
                  </div>
                ) : null}

                <form className="og-login-page__form" onSubmit={handleSubmit}>
                  {mode === 'signup' ? (
                    <div className="og-login-page__field-row">
                      <Input
                        label="First name"
                        type="text"
                        autoComplete="given-name"
                        placeholder="First name"
                        value={firstName}
                        onChange={(event) => setFirstName(event.target.value)}
                        disabled={authBusy}
                      />

                      <Input
                        label="Last name"
                        type="text"
                        autoComplete="family-name"
                        placeholder="Last name"
                        value={lastName}
                        onChange={(event) => setLastName(event.target.value)}
                        disabled={authBusy}
                      />
                    </div>
                  ) : null}

                  <Input
                    label="Email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    disabled={authBusy || mode === 'verify'}
                  />

                  {mode === 'verify' ? (
                    <label className="og-login-page__field">
                      <span>Verification code</span>
                      <VerificationCodeInput value={resetCode} onChange={setResetCode} disabled={authBusy} />
                    </label>
                  ) : null}

                  {mode === 'login' || mode === 'signup' || (mode === 'forgot' && forgotStep === 'confirm') ? (
                    <div className="og-login-page__password-block">
                      <Input
                        label={mode === 'login' ? 'Password' : 'New password'}
                        type="password"
                        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                        placeholder={mode === 'login' ? 'Enter your password' : 'Create a password'}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        disabled={authBusy}
                      />

                      {mode === 'login' ? (
                        <div className="og-login-page__meta-action">
                          <button type="button" className="og-login-page__link og-login-page__link--inline" onClick={startForgotPassword}>
                            Forgot password?
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {mode === 'forgot' && forgotStep === 'confirm' ? (
                    <label className="og-login-page__field">
                      <span>Verification code</span>
                      <VerificationCodeInput value={resetCode} onChange={setResetCode} disabled={authBusy} />
                    </label>
                  ) : null}

                  {mode === 'signup' || (mode === 'forgot' && forgotStep === 'confirm') ? (
                    <>
                      <Input
                        label={mode === 'signup' ? 'Confirm password' : 'Confirm new password'}
                        type="password"
                        autoComplete="new-password"
                        placeholder="Repeat your password"
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        disabled={authBusy}
                      />
                      {showPasswordHint ? (
                        <p className="og-login-page__hint">
                          Use at least 8 characters with uppercase, lowercase, a number, and a symbol.
                        </p>
                      ) : null}

                      {mode === 'signup' ? (
                        <label className="og-login-page__checkbox">
                          <input
                            type="checkbox"
                            checked={newsletterOptIn}
                            onChange={(event) => setNewsletterOptIn(event.target.checked)}
                            disabled={authBusy}
                          />
                          <span>Keep me updated with foundation news and occasional newsletter emails.</span>
                        </label>
                      ) : null}
                    </>
                  ) : null}

                  <div className="og-login-page__actions">
                    <button type="submit" className="og-login-page__primary" disabled={authBusy}>
                      {authBusy
                        ? mode === 'login'
                          ? 'Logging in...'
                          : mode === 'signup'
                            ? 'Creating account...'
                            : mode === 'verify'
                              ? 'Verifying...'
                            : forgotStep === 'request'
                              ? 'Sending code...'
                              : 'Resetting password...'
                        : mode === 'login'
                          ? 'Log in'
                          : mode === 'signup'
                            ? 'Sign up'
                            : mode === 'verify'
                              ? 'Verify email'
                            : forgotStep === 'request'
                              ? 'Send reset code'
                              : 'Save new password'}
                    </button>
                  </div>
                </form>

                <div className="og-login-page__footer">
                  {mode === 'verify' ? (
                    <>
                      <button type="button" className="og-login-page__link og-login-page__link--inline" onClick={handleResendVerification}>
                        Resend code
                      </button>
                      <button type="button" className="og-login-page__link og-login-page__link--inline" onClick={() => handleModeChange('login')}>
                        Back to log in
                      </button>
                    </>
                  ) : null}
                  {mode === 'forgot' ? (
                    <button type="button" className="og-login-page__link og-login-page__link--inline" onClick={() => handleModeChange('login')}>
                      Back to log in
                    </button>
                  ) : null}
                </div>

              </>
            )
          ) : (
            <>
              <p className="og-login-page__eyebrow">Olivia&apos;s Garden</p>
              <h1 className="og-login-page__title">Login unavailable.</h1>
              <p className="og-login-page__note">
                Login is not configured for this environment yet.
              </p>
              <div className="og-login-page__footer">
                <button type="button" className="og-login-page__link" onClick={() => onNavigate('/okra')}>
                  Back to the Okra Project
                </button>
              </div>
            </>
          )}

          {statusMessage ? <p className="og-login-page__success">{statusMessage}</p> : null}
          {localError || authError ? <p className="og-login-page__error" role="alert">{localError ?? authError}</p> : null}
        </div>
      </div>
    </section>
  );
}

function OkraPage({
  onNavigate,
  authEnabled,
  authSession,
  onLogin,
  onSignup,
}: {
  onNavigate: (path: string) => void;
  authEnabled: boolean;
  authSession: AuthSession | null;
  onLogin: () => void;
  onSignup: () => void;
}) {
  return (
    <OkraExperience
      onNavigate={onNavigate}
      authEnabled={authEnabled}
      authSession={authSession}
      onLogin={onLogin}
      onSignup={onSignup}
    />
  );
}

function SeedsPage({ onNavigate }: { onNavigate: (path: string) => void; }) {
  return (
    <>
      <PageHero
        eyebrow="Seeds"
        title="Request free okra seeds"
        body="The seed request flow is still being set up, but the program itself is real. The foundation gives away free okra seeds from a line of plants Olivia grew herself."
      />

      <Section
        title="What you get"
        body="Free okra seeds for people in the United States who want to start growing food and take part in the Okra Project."
      >
        <p className="page-kicker">Simple, low-friction, and meant to get you growing quickly.</p>
        <p className="page-text">
          This is meant to be an easy entry point. Start with one crop, get it in the ground, and
          see where it leads. When it grows, we ask that you send back photos so the project can
          show how that seed line keeps moving through other gardens.
        </p>
        <CtaButton onClick={() => onNavigate('/contact')}>Contact us for seeds</CtaButton>
      </Section>
    </>
  );
}

function ImpactPage({ onNavigate }: { onNavigate: (path: string) => void; }) {
  return (
    <>
      <PageHero
        eyebrow="Impact"
        title="What exists now and what is coming next."
        body="The foundation is already doing real work, and some parts of the public-facing program are still being built."
        aside={
          <div className="page-photo">
            <img
              src="/images/home/produce-basket.jpg"
              alt="Basket of harvested produce from the garden."
            />
          </div>
        }
      />

      <Section
        title="What's already growing."
        body="The work is active and productive."
      >
        <p className="page-kicker">This is not a concept page. The work is already happening.</p>
        <p className="page-text">
          On the land right now: productive garden beds, flowers, chickens, turkeys, geese, goats,
          bees, and guineas. A small Texas vineyard. A pond we use to observe and teach about
          micro-ecosystems.
        </p>
        <p className="page-text">
          Seasonal crops across the full range -- carrots, beets, broccoli, cauliflower, eggplant,
          tomatoes, peppers, onions, artichokes, beans, zucchini, cucumbers. Borage, zinnias,
          cosmos, day lilies, forget-me-nots, and Colossus marigolds from border to border.
        </p>
      </Section>

      <Section
        title="Where we're going."
        body="Next comes a fuller public program: workshops, stronger seed sharing through the Okra Project, and more structured ways to share what the foundation grows with the community."
      >
        <CtaButton onClick={() => onNavigate('/get-involved')}>Get involved</CtaButton>
      </Section>

      <Section
        title="See it as it happens."
        body="The best way to understand the foundation is to see the work as it happens: what is growing, what is getting built, what worked, and what had to be adjusted."
      >
        <CtaButton variant="secondary">Follow on Instagram</CtaButton>
      </Section>
    </>
  );
}

function DonatePage({
  onNavigate,
  authSession,
}: {
  onNavigate: (path: string) => void;
  authSession: AuthSession | null;
}) {
  const initialReturnedSessionId = typeof window === 'undefined'
    ? null
    : new URLSearchParams(window.location.search).get('session_id');
  const [selectedMode, setSelectedMode] = useState<DonationMode>('one_time');
  const [selectedAmount, setSelectedAmount] = useState(2500);
  const [customAmount, setCustomAmount] = useState('');
  const [donorName, setDonorName] = useState(authSession?.user.name ?? '');
  const [donorEmail, setDonorEmail] = useState(authSession?.user.email ?? '');
  const [dedicationName, setDedicationName] = useState('');
  const [tShirtPreference, setTShirtPreference] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCheckingStatus, setIsCheckingStatus] = useState(Boolean(initialReturnedSessionId));
  const [error, setError] = useState<string | null>(null);
  const [checkoutClientSecret, setCheckoutClientSecret] = useState<string | null>(null);
  const [checkoutSessionId, setCheckoutSessionId] = useState<string | null>(null);
  const [returnedSessionId, setReturnedSessionId] = useState(initialReturnedSessionId);
  const [checkoutStatus, setCheckoutStatus] = useState<DonationCheckoutSessionStatus | null>(null);
  const checkoutContainerRef = useRef<HTMLDivElement | null>(null);
  const embeddedCheckoutRef = useRef<StripeEmbeddedCheckout | null>(null);

  useEffect(() => {
    if (authSession?.user.name) {
      setDonorName((current) => current || authSession.user.name || '');
    }
    if (authSession?.user.email) {
      setDonorEmail((current) => current || authSession.user.email || '');
    }
  }, [authSession?.user.email, authSession?.user.name]);

  const effectiveAmount = customAmount.trim()
    ? Math.round(Number(customAmount) * 100)
    : selectedAmount;

  useEffect(() => {
    if (!returnedSessionId) {
      setCheckoutStatus(null);
      setIsCheckingStatus(false);
      return;
    }

    let active = true;
    setIsCheckingStatus(true);
    setError(null);

    void getDonationCheckoutSessionStatus(returnedSessionId)
      .then((status) => {
        if (!active) {
          return;
        }

        setCheckoutStatus(status);
      })
      .catch((statusError) => {
        if (!active) {
          return;
        }

        setError(statusError instanceof Error ? statusError.message : 'Unable to confirm donation status.');
      })
      .finally(() => {
        if (active) {
          setIsCheckingStatus(false);
        }
      });

    return () => {
      active = false;
    };
  }, [returnedSessionId]);

  useEffect(() => {
    if (!checkoutClientSecret || !checkoutContainerRef.current) {
      return;
    }

    if (!stripePromise) {
      setError('Stripe checkout is not configured for this environment yet.');
      setCheckoutClientSecret(null);
      setIsSubmitting(false);
      return;
    }

    let active = true;
    let mountedCheckout: StripeEmbeddedCheckout | null = null;

    void stripePromise
      .then(async (stripe) => {
        if (!stripe) {
          throw new Error('Stripe checkout is unavailable right now.');
        }

        const checkoutContainer = checkoutContainerRef.current;
        if (!checkoutContainer) {
          throw new Error('Stripe checkout container is unavailable.');
        }

        mountedCheckout = await stripe.initEmbeddedCheckout({
          fetchClientSecret: async () => checkoutClientSecret,
        });

        if (!active) {
          mountedCheckout.destroy();
          return;
        }

        embeddedCheckoutRef.current = mountedCheckout;
        mountedCheckout.mount(checkoutContainer);
        setIsSubmitting(false);
      })
      .catch((checkoutError) => {
        if (!active) {
          return;
        }

        setError(checkoutError instanceof Error ? checkoutError.message : 'Unable to open Stripe checkout.');
        setCheckoutClientSecret(null);
        setCheckoutSessionId(null);
        setIsSubmitting(false);
      });

    return () => {
      active = false;
      if (embeddedCheckoutRef.current) {
        embeddedCheckoutRef.current.destroy();
        embeddedCheckoutRef.current = null;
      } else if (mountedCheckout) {
        mountedCheckout.destroy();
      }
    };
  }, [checkoutClientSecret]);

  const resetCheckoutExperience = () => {
    embeddedCheckoutRef.current?.destroy();
    embeddedCheckoutRef.current = null;
    setCheckoutClientSecret(null);
    setCheckoutSessionId(null);
    setCheckoutStatus(null);
    setReturnedSessionId(null);
    setIsCheckingStatus(false);
    setIsSubmitting(false);
    setError(null);

    if (typeof window !== 'undefined') {
      window.history.replaceState({}, '', window.location.pathname);
    }
  };

  const startCheckout = async (mode: DonationMode) => {
    setError(null);

    if (!Number.isFinite(effectiveAmount) || effectiveAmount < 500) {
      setError('Please choose or enter a donation of at least $5.');
      return;
    }

    setIsSubmitting(true);

    try {
      const { clientSecret, checkoutSessionId: nextCheckoutSessionId } = await createDonationCheckoutSession(
        {
          mode,
          amountCents: effectiveAmount,
          returnUrl: `${window.location.origin}/donate?session_id={CHECKOUT_SESSION_ID}`,
          donorName: donorName.trim() || undefined,
          donorEmail: donorEmail.trim() || undefined,
          dedicationName: dedicationName.trim() || undefined,
          tShirtPreference: mode === 'recurring' ? (tShirtPreference.trim() || undefined) : undefined,
        },
        authSession,
      );

      if (typeof window !== 'undefined') {
        window.history.replaceState({}, '', window.location.pathname);
      }

      setReturnedSessionId(null);
      setCheckoutStatus(null);
      setCheckoutSessionId(nextCheckoutSessionId);
      setCheckoutClientSecret(clientSecret);
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : 'Unable to start checkout.');
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <PageHero
        eyebrow="Donate"
        title="Plant something permanent in Olivia's Garden."
        body="Every gift becomes something visible. Each donor, no matter the amount, receives a permanent acrylic garden piece with their name placed on the grounds. Last year it was a butterfly. This year it is a bee."
        className="donate-hero"
        backgroundImage="/images/home/sunset-garden.jpg"
        actions={
          <>
            <a className="home-hero__cta" href="#donate-options">Choose your gift</a>
            <Button className="site-cta donate-hero__secondary" variant="secondary" onClick={() => onNavigate('/about')}>
              Olivia&apos;s story
            </Button>
          </>
        }
        aside={
          <div className="donate-hero__aside-card">
            <p className="donate-hero__eyebrow">This year&apos;s garden marker</p>
            <div className="donate-hero__bee">
              <span className="donate-hero__bee-body" aria-hidden="true" />
            </div>
            <p className="page-text">
              A named acrylic bee is added to the garden for every donor. Garden Club members also
              receive a free t-shirt when they begin their recurring support.
            </p>
          </div>
        }
      />

      <section className="donate-story-band">
        <div className="donate-story-band__copy">
          <p className="page-eyebrow">Why this matters</p>
          <h2>The donation should feel like belonging, not just a transaction.</h2>
          <p className="page-text">
            Support goes into seeds, animal care, tools, educational materials, and the practical
            work of keeping the foundation active for families who want to learn how to grow, tend,
            and share food.
          </p>
          <p className="page-text">
            We tell that story in the garden itself. Every donor receives a permanent acrylic marker
            with their name on it, regardless of donation size. The animal changes each year so the
            installation keeps growing while still marking a moment in the life of the garden.
          </p>
          <figure className="donate-story-band__artifact" aria-label="Placeholder for last year's acrylic butterfly donor marker">
            <div className="donate-story-band__artifact-frame" aria-hidden="true">
              <div className="donate-story-band__butterfly">
                <span className="donate-story-band__butterfly-wing donate-story-band__butterfly-wing--left" />
                <span className="donate-story-band__butterfly-body" />
                <span className="donate-story-band__butterfly-wing donate-story-band__butterfly-wing--right" />
              </div>
            </div>
            <figcaption>
              Acrylic butterfly placeholder. Last year, every donor received a butterfly in the
              garden. This year, every donor receives a bee.
            </figcaption>
          </figure>
        </div>
        <div className="donate-story-band__highlights">
          <article className="donate-highlight">
            <h3>Permanent recognition</h3>
            <p>Your name is placed in the garden as part of the yearly marker installation.</p>
          </article>
          <article className="donate-highlight">
            <h3>Yearly animal tradition</h3>
            <p>Last year was the butterfly. This year is the bee. The symbol changes, the presence stays.</p>
          </article>
          <article className="donate-highlight">
            <h3>Garden Club welcome</h3>
            <p>Recurring donors join the Garden Club and get a free t-shirt of their choice at signup.</p>
          </article>
        </div>
      </section>

      <section className="donate-checkout" id="donate-options">
        <div className="donate-checkout__intro">
          <p className="page-eyebrow">Choose your support</p>
          <h2>Give once or join the Garden Club, then finish securely with Stripe right here on the page.</h2>
          <p className="page-text">
            We host the story, your gift choice, and the dedication details here. When you&apos;re
            ready, Stripe&apos;s secure Checkout opens inside this donate page so the payment step
            still feels like part of the same experience.
          </p>
          <p className="page-text">
            If you&apos;re signed in, your donation is also recorded on your account so the
            foundation can keep your contribution connected to your record.
          </p>
          {authSession ? (
            <p className="page-kicker">
              Signed in as {authSession.user.name ?? authSession.user.email ?? 'your account'}.
            </p>
          ) : (
            <p className="page-kicker">
              You can donate without logging in, or create an account first if you want the gift saved to your profile.
            </p>
          )}
        </div>

        <div className="donate-checkout__grid">
          <article
            className={`donate-option ${selectedMode === 'one_time' ? 'donate-option--active' : ''}`.trim()}
          >
            <p className="donate-option__eyebrow">One-time gift</p>
            <h3>Fund today&apos;s work.</h3>
            <p>Support immediate needs across the garden, animals, classes, and hands-on learning.</p>
            <button type="button" className="donate-option__select" onClick={() => setSelectedMode('one_time')}>
              Choose one-time
            </button>
          </article>

          <article
            className={`donate-option ${selectedMode === 'recurring' ? 'donate-option--active' : ''}`.trim()}
          >
            <p className="donate-option__eyebrow">Garden Club</p>
            <h3>Show up every month.</h3>
            <p>Recurring support gives the foundation steadier footing and includes a free t-shirt at signup.</p>
            <button type="button" className="donate-option__select" onClick={() => setSelectedMode('recurring')}>
              Choose Garden Club
            </button>
          </article>
        </div>

        {isCheckingStatus ? (
          <div className="donate-status-card donate-status-card--neutral">
            <p className="donate-status-card__eyebrow">Checking donation</p>
            <h3>We&apos;re confirming your Stripe checkout session.</h3>
            <p>Give us a moment to read the latest status from Stripe.</p>
          </div>
        ) : null}

        {checkoutStatus?.status === 'complete' ? (
          <div className="donate-status-card donate-status-card--success">
            <p className="donate-status-card__eyebrow">Donation complete</p>
            <h3>Your gift is in.</h3>
            <p>
              Stripe marked this donation as complete, and we&apos;ll use the details from checkout
              to add the donor&apos;s permanent bee to the garden.
            </p>
            {checkoutStatus.customerEmail ? (
              <p>A receipt should be on its way to {checkoutStatus.customerEmail}.</p>
            ) : null}
            <div className="donate-status-card__actions">
              <Button className="site-cta" onClick={resetCheckoutExperience}>Make another gift</Button>
              <Button className="site-cta" variant="secondary" onClick={() => onNavigate('/impact')}>
                See the impact
              </Button>
            </div>
          </div>
        ) : null}

        {checkoutStatus && checkoutStatus.status !== 'complete' ? (
          <div className="donate-status-card donate-status-card--warning">
            <p className="donate-status-card__eyebrow">Checkout still open</p>
            <h3>Your Stripe checkout was not completed yet.</h3>
            <p>
              You can review your donation details below and start a fresh secure checkout when
              you&apos;re ready.
            </p>
            <div className="donate-status-card__actions">
              <Button className="site-cta" onClick={resetCheckoutExperience}>Start a new checkout</Button>
            </div>
          </div>
        ) : null}

        {checkoutStatus?.status === 'complete' ? null : (
        <div className="donate-form-card">
          <div className="donate-amounts" role="group" aria-label="Donation amount">
            {[1500, 2500, 5000, 10000].map((amount) => (
              <button
                key={amount}
                type="button"
                className={`donate-amounts__chip ${!customAmount && selectedAmount === amount ? 'donate-amounts__chip--active' : ''}`.trim()}
                onClick={() => {
                  setSelectedAmount(amount);
                  setCustomAmount('');
                }}
              >
                ${amount / 100}
              </button>
            ))}
            <label className="donate-amounts__custom">
              <span>Custom</span>
              <input
                type="number"
                min="5"
                step="1"
                inputMode="numeric"
                placeholder="Other amount"
                value={customAmount}
                onChange={(event) => setCustomAmount(event.target.value)}
              />
            </label>
          </div>

          <div className="donate-form-grid">
            <label>
              <span>Name</span>
              <input type="text" value={donorName} onChange={(event) => setDonorName(event.target.value)} placeholder="Your name" />
            </label>
            <label>
              <span>Email</span>
              <input type="email" value={donorEmail} onChange={(event) => setDonorEmail(event.target.value)} placeholder="you@example.com" />
            </label>
            <label>
              <span>Name for the bee</span>
              <input
                type="text"
                value={dedicationName}
                onChange={(event) => setDedicationName(event.target.value)}
                placeholder="Your name, family name, or in honor of someone"
              />
            </label>
            {selectedMode === 'recurring' ? (
              <label>
                <span>T-shirt choice</span>
                <input
                  type="text"
                  value={tShirtPreference}
                  onChange={(event) => setTShirtPreference(event.target.value)}
                  placeholder="Size, color, or style preference"
                />
              </label>
            ) : null}
          </div>

          <div className="donate-form-card__footer">
            <div>
              <p className="donate-form-card__summary">
                {selectedMode === 'recurring' ? 'Garden Club' : 'One-time donation'}: ${(effectiveAmount / 100).toFixed(2)}
              </p>
              <p className="page-text">
                {selectedMode === 'recurring'
                  ? 'Begins monthly support and includes your free t-shirt at signup.'
                  : 'Includes your permanent bee in the garden, no matter the amount.'}
              </p>
              <p className="donate-form-card__checkout-note">
                Stripe&apos;s secure checkout opens here on the page after you continue.
              </p>
            </div>
            <Button className="site-cta" onClick={() => void startCheckout(selectedMode)} disabled={isSubmitting}>
              {isSubmitting ? 'Opening Stripe...' : selectedMode === 'recurring' ? 'Open Garden Club checkout' : 'Open secure donation checkout'}
            </Button>
          </div>

          {error ? <p className="donate-form-card__error" role="alert">{error}</p> : null}

          {checkoutClientSecret ? (
            <div className="donate-embedded-checkout">
              <div className="donate-embedded-checkout__header">
                <div>
                  <p className="donate-embedded-checkout__eyebrow">Secure payment</p>
                  <h3>Stripe Checkout is ready below.</h3>
                  <p>
                    Complete the payment here without leaving the donate page.
                    {checkoutSessionId ? ` Session ${checkoutSessionId} is active.` : ''}
                  </p>
                </div>
                <Button className="site-cta" variant="secondary" onClick={resetCheckoutExperience}>
                  Edit donation
                </Button>
              </div>
              <div className="donate-embedded-checkout__mount" ref={checkoutContainerRef} />
            </div>
          ) : null}
        </div>
        )}
      </section>

      <Section
        title="Other ways to help"
        body="If your support is better expressed through volunteering, seeds, supplies, or a larger sponsorship conversation, we can point you in the right direction."
      >
        <div className="site-panel__actions">
          <CtaButton onClick={() => onNavigate('/get-involved')}>Get involved</CtaButton>
          <CtaButton onClick={() => onNavigate('/contact')} variant="secondary">Contact us directly</CtaButton>
        </div>
      </Section>
    </>
  );
}

function ContactPage() {
  return (
    <>
      <PageHero title="Get in touch" body="We'd love to hear from you." />

      <div className="contact-grid">
        <Card title="Reach out directly" className="contact-card">
          <p className="contact-card__eyebrow">Direct contact</p>
          <p>
            Whether you want seeds, have questions about the Okra Project, want to help with the
            work, or just want to say what you&apos;re growing, reach out.
          </p>
          <p className="page-text">We&apos;re real people and we actually respond.</p>
          <p className="contact-meta">Email: allen@oliviasgarden.org</p>
        </Card>

        <Card title="Send a message" className="contact-card">
          <p className="contact-card__eyebrow">Send a note</p>
          <form className="contact-form">
            <label>
              <span>Name</span>
              <input type="text" placeholder="Your name" />
            </label>
            <label>
              <span>Email</span>
              <input type="email" placeholder="Your email" />
            </label>
            <label>
              <span>Message</span>
              <textarea rows={6} placeholder="How can we help?" />
            </label>
            <label>
              <span>How did you hear about us? (optional)</span>
              <input type="text" placeholder="Instagram, friend, work day, etc." />
            </label>
            <CtaButton>Send message</CtaButton>
          </form>
        </Card>
      </div>
    </>
  );
}

export default App;
