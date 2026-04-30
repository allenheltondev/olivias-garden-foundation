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
