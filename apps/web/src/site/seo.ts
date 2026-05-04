import { useEffect } from 'react';
import { foundationOrganization } from './organization';
import type { AppRoute } from './routes';
import { facebookUrl, instagramUrl, siteUrl, socialShareImage } from './routes';

const socialShareImageAlt = "Olivia's Garden Foundation social sharing image.";

type GtagCommand = (
  command: 'event' | 'config' | 'js',
  targetOrName: string | Date,
  params?: Record<string, string | number | boolean>,
) => void;

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

export function absoluteUrl(path: string) {
  return path.startsWith('http://') || path.startsWith('https://') ? path : `${siteUrl}${path}`;
}

export function buildPageTitle(route: AppRoute) {
  return route.path === '/'
    ? `${route.title} | Grow Food, Learn Skills, Build Community`
    : `${route.title} | Olivia's Garden Foundation`;
}

export function useRouteSeo(route: AppRoute, pathname: string) {
  useEffect(() => {
    const pageTitle = buildPageTitle(route);
    const pageUrl = absoluteUrl(pathname === '/' ? '/' : pathname);
    const pageImage = absoluteUrl(route.seoImage ?? socialShareImage);
    const robots = route.allowIndex === false
      ? 'noindex, nofollow, noarchive'
      : 'index, follow, max-image-preview:large';

    document.title = pageTitle;
    ensureMeta('meta[name="description"]', { name: 'description' }, route.description);
    ensureMeta('meta[name="robots"]', { name: 'robots' }, robots);
    ensureMeta('meta[property="og:type"]', { property: 'og:type' }, 'website');
    ensureMeta('meta[property="og:site_name"]', { property: 'og:site_name' }, foundationOrganization.name);
    ensureMeta('meta[property="og:title"]', { property: 'og:title' }, pageTitle);
    ensureMeta('meta[property="og:description"]', { property: 'og:description' }, route.description);
    ensureMeta('meta[property="og:url"]', { property: 'og:url' }, pageUrl);
    ensureMeta('meta[property="og:image"]', { property: 'og:image' }, pageImage);
    ensureMeta('meta[property="og:image:alt"]', { property: 'og:image:alt' }, socialShareImageAlt);
    ensureMeta('meta[name="twitter:card"]', { name: 'twitter:card' }, 'summary_large_image');
    ensureMeta('meta[name="twitter:title"]', { name: 'twitter:title' }, pageTitle);
    ensureMeta('meta[name="twitter:description"]', { name: 'twitter:description' }, route.description);
    ensureMeta('meta[name="twitter:image"]', { name: 'twitter:image' }, pageImage);
    ensureMeta('meta[name="twitter:image:alt"]', { name: 'twitter:image:alt' }, socialShareImageAlt);
    ensureLink('link[rel="canonical"]', 'canonical', pageUrl);

    ensureStructuredData('organization', {
      '@context': 'https://schema.org',
      '@type': 'NonprofitOrganization',
      name: foundationOrganization.name,
      legalName: foundationOrganization.legalName,
      taxID: foundationOrganization.ein,
      email: foundationOrganization.contactEmail,
      url: siteUrl,
      logo: absoluteUrl(foundationOrganization.logoImage),
      sameAs: [instagramUrl, facebookUrl],
    });

    ensureStructuredData('webpage', {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: pageTitle,
      description: route.description,
      url: pageUrl,
      isPartOf: {
        '@type': 'WebSite',
        name: foundationOrganization.name,
        url: siteUrl,
      },
    });

    const gtag = (window as Window & { gtag?: GtagCommand }).gtag;
    gtag?.('event', 'page_view', {
      page_title: pageTitle,
      page_location: pageUrl,
      page_path: pathname,
    });
  }, [pathname, route]);
}

// --- Per-workshop dynamic SEO ---
//
// useRouteSeo runs once per pathname change with the route table entry. For
// /workshops/:slug there's no static entry (slug is dynamic), so the initial
// pass falls through to notFoundRoute and applies generic noindex meta.
// After the workshop is fetched on the client, applyWorkshopSeo overrides
// title, description, og/twitter image, canonical, robots, and replaces the
// WebPage JSON-LD with a Schema.org Event so search engines and unfurlers
// that execute JS get workshop-specific signals.
//
// JS-only crawlers (Google, Slack/iMessage unfurlers via scraper APIs) will
// pick this up. Non-JS crawlers see the prerendered list-page fallback at
// /workshops; per-workshop pages aren't prerendered (would require DB at
// build time).

export interface WorkshopSeoInput {
  slug: string;
  title: string;
  short_description: string | null;
  description: string | null;
  status: 'coming_soon' | 'gauging_interest' | 'open' | 'closed' | 'past';
  workshop_date: string | null;
  location: string | null;
  capacity: number | null;
  seats_remaining: number | null;
  image_url: string | null;
}

function workshopStatusToEventStatus(status: WorkshopSeoInput['status']): string {
  // Schema.org EventStatusType vocab. `coming_soon` doesn't have a perfect
  // analogue; map it to EventScheduled with a description hint instead of
  // the explicit Postponed/Rescheduled values which imply a prior schedule.
  switch (status) {
    case 'past':
      return 'https://schema.org/EventScheduled';
    case 'closed':
    case 'open':
    case 'gauging_interest':
    case 'coming_soon':
    default:
      return 'https://schema.org/EventScheduled';
  }
}

export function applyWorkshopSeo(workshop: WorkshopSeoInput, pathname: string) {
  if (typeof document === 'undefined') return;

  const pageUrl = absoluteUrl(pathname);
  const pageDescription =
    workshop.short_description
    ?? workshop.description?.slice(0, 200)
    ?? `Hands-on workshop at Olivia's Garden Foundation: ${workshop.title}.`;
  const pageImage = absoluteUrl(workshop.image_url ?? socialShareImage);
  const pageTitle = `${workshop.title} | Olivia's Garden Foundation`;

  document.title = pageTitle;
  ensureMeta('meta[name="description"]', { name: 'description' }, pageDescription);
  ensureMeta(
    'meta[name="robots"]',
    { name: 'robots' },
    workshop.status === 'past'
      ? 'noindex, follow, max-image-preview:large'
      : 'index, follow, max-image-preview:large',
  );
  ensureMeta('meta[property="og:type"]', { property: 'og:type' }, 'website');
  ensureMeta('meta[property="og:title"]', { property: 'og:title' }, pageTitle);
  ensureMeta('meta[property="og:description"]', { property: 'og:description' }, pageDescription);
  ensureMeta('meta[property="og:url"]', { property: 'og:url' }, pageUrl);
  ensureMeta('meta[property="og:image"]', { property: 'og:image' }, pageImage);
  ensureMeta('meta[name="twitter:title"]', { name: 'twitter:title' }, pageTitle);
  ensureMeta('meta[name="twitter:description"]', { name: 'twitter:description' }, pageDescription);
  ensureMeta('meta[name="twitter:image"]', { name: 'twitter:image' }, pageImage);
  ensureLink('link[rel="canonical"]', 'canonical', pageUrl);

  // Schema.org Event payload. Skip optional fields when we don't have data,
  // rather than emitting empty strings which Google's structured-data parser
  // flags as warnings.
  const eventPayload: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: workshop.title,
    description: pageDescription,
    url: pageUrl,
    eventStatus: workshopStatusToEventStatus(workshop.status),
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    organizer: {
      '@type': 'Organization',
      name: foundationOrganization.name,
      url: siteUrl,
    },
  };
  if (workshop.workshop_date) {
    eventPayload.startDate = workshop.workshop_date;
  }
  if (workshop.image_url) {
    eventPayload.image = pageImage;
  }
  if (workshop.location) {
    eventPayload.location = {
      '@type': 'Place',
      name: workshop.location,
      address: {
        '@type': 'PostalAddress',
        addressLocality: 'McKinney',
        addressRegion: 'TX',
        addressCountry: 'US',
      },
    };
  } else {
    // No specific location → still tag it as physically attended at the
    // foundation's home base so unfurlers don't get a malformed Place.
    eventPayload.location = {
      '@type': 'Place',
      name: "Olivia's Garden Foundation",
      address: {
        '@type': 'PostalAddress',
        addressLocality: 'McKinney',
        addressRegion: 'TX',
        addressCountry: 'US',
      },
    };
  }

  ensureStructuredData('webpage', eventPayload);

  const gtag = (window as Window & { gtag?: GtagCommand }).gtag;
  gtag?.('event', 'page_view', {
    page_title: pageTitle,
    page_location: pageUrl,
    page_path: pathname,
  });
}
