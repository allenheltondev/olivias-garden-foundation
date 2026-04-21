import { useEffect } from 'react';
import type { AppRoute } from './routes';
import { facebookUrl, instagramUrl, siteUrl } from './routes';

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
    const pageImage = absoluteUrl(route.seoImage ?? '/images/home/garden-landscaping.jpg');
    const robots = route.allowIndex === false
      ? 'noindex, nofollow, noarchive'
      : 'index, follow, max-image-preview:large';

    document.title = pageTitle;
    ensureMeta('meta[name="description"]', { name: 'description' }, route.description);
    ensureMeta('meta[name="robots"]', { name: 'robots' }, robots);
    ensureMeta('meta[property="og:type"]', { property: 'og:type' }, 'website');
    ensureMeta('meta[property="og:site_name"]', { property: 'og:site_name' }, "Olivia's Garden Foundation");
    ensureMeta('meta[property="og:title"]', { property: 'og:title' }, pageTitle);
    ensureMeta('meta[property="og:description"]', { property: 'og:description' }, route.description);
    ensureMeta('meta[property="og:url"]', { property: 'og:url' }, pageUrl);
    ensureMeta('meta[property="og:image"]', { property: 'og:image' }, pageImage);
    ensureMeta('meta[name="twitter:card"]', { name: 'twitter:card' }, 'summary_large_image');
    ensureMeta('meta[name="twitter:title"]', { name: 'twitter:title' }, pageTitle);
    ensureMeta('meta[name="twitter:description"]', { name: 'twitter:description' }, route.description);
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
      description: route.description,
      url: pageUrl,
      isPartOf: {
        '@type': 'WebSite',
        name: "Olivia's Garden Foundation",
        url: siteUrl,
      },
    });
  }, [pathname, route]);
}
