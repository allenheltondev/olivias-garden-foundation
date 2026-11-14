import { expect, test } from '@playwright/test';
import { gotoAndWait, mainPaths, readInternalLinks, readMetaContent } from './test-helpers';
import { seoRoutes, defaultImageAlt } from '../scripts/seo-data.mjs';

const socialCards = ['okra', 'donate', 'about', 'faq', 'good-roots', 'get-involved', 'impact'];

for (const name of socialCards) {
  test(`${name} exposes its social card to crawlers and the live app`, async ({ page, request }) => {
    const imagePath = `/images/social/${name}.png`;
    const response = await request.get(`/${name}`);
    expect(response.ok()).toBeTruthy();
    const html = await response.text();
    // Inspect the original response: share crawlers do not execute React.
    expect(html).toMatch(new RegExp(`<meta property="og:image" content="https?://[^" ]+${imagePath}"`));
    expect(html).toMatch(new RegExp(`<meta name="twitter:image" content="https?://[^" ]+${imagePath}"`));

    const route = seoRoutes.find((entry: { path: string }) => entry.path === `/${name}`)!;
    const descriptions = [
      ['name', 'description', route.description],
      ['property', 'og:description', route.description],
      ['name', 'twitter:description', route.description],
      ['property', 'og:image:alt', route.seoImageAlt],
      ['name', 'twitter:image:alt', route.seoImageAlt],
    ];
    for (const [attribute, tag, content] of descriptions) {
      const escaped = content.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
      const match = html.match(new RegExp(`<meta\\s+${attribute}="${tag}"\\s+content="([^"]*)"`));
      expect(match?.[1], `Crawler ${tag} for /${name}`).toBe(escaped);
    }

    const image = await request.get(imagePath);
    expect(image.ok()).toBeTruthy();
    expect(image.headers()['content-type']).toContain('image/png');

    await gotoAndWait(page, `/${name}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', new RegExp(`${imagePath}$`));
    await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute('content', new RegExp(`${imagePath}$`));
    for (const [attribute, tag, content] of descriptions) {
      await expect(page.locator(`meta[${attribute}="${tag}"]`)).toHaveAttribute('content', content);
    }

    // Navigation must also restore the default card on pages without a custom one.
    await page.getByRole('banner').getByRole('link', { name: 'Go to home', exact: true }).click();
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /\/images\/home\/og-image\.png$/);
    await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute('content', /\/images\/home\/og-image\.png$/);
    await expect(page.locator('meta[property="og:image:alt"]')).toHaveAttribute('content', defaultImageAlt);
    await expect(page.locator('meta[name="twitter:image:alt"]')).toHaveAttribute('content', defaultImageAlt);
  });
}

test('homepage and donate page expose core metadata', async ({ page }) => {
  await gotoAndWait(page, '/');
  await expect(page).toHaveTitle(/Olivia's Garden Foundation/i);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/$/);
  await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute('href', '/images/icons/logo.svg');
  await expect(page.locator('header img[src="/images/icons/logo.svg"]').first()).toBeVisible();
  expect(await readMetaContent(page, 'meta[name="description"]')).toBeTruthy();
  expect(await readMetaContent(page, 'meta[property="og:title"]')).toBeTruthy();
  expect(await readMetaContent(page, 'meta[property="og:description"]')).toBeTruthy();
  expect(await readMetaContent(page, 'meta[property="og:image"]')).toContain('/images/home/og-image.png');
  expect(await readMetaContent(page, 'meta[property="og:image:alt"]')).toBeTruthy();
  expect(await readMetaContent(page, 'meta[property="og:url"]')).toBeTruthy();

  const organizationJsonLd = await page
    .locator('script[type="application/ld+json"][data-seo-id="organization"]')
    .textContent();
  expect(organizationJsonLd).toBeTruthy();
  const organization = JSON.parse(organizationJsonLd ?? '{}') as {
    '@type'?: string;
    legalName?: string;
    taxID?: string;
    email?: string;
  };
  expect(organization['@type']).toBe('NonprofitOrganization');
  expect(organization.legalName).toBe("Olivia's Garden Foundation");
  expect(organization.taxID).toBe('33-3101032');
  expect(organization.email).toBe('allen@oliviasgarden.org');

  // /donate mounts Stripe Embedded Checkout iframes that keep the network
  // from going idle. We only inspect <title> and meta tags here, so
  // DOMContentLoaded is enough.
  await gotoAndWait(page, '/donate', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveTitle(/Support Olivia's Garden/i);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/donate$/);
  expect(await readMetaContent(page, 'meta[name="description"]')).toBeTruthy();
  expect(await readMetaContent(page, 'meta[name="twitter:image"]')).toContain('/images/social/donate.png');
  expect(await readMetaContent(page, 'meta[name="twitter:image:alt"]')).toBeTruthy();
});

test('unknown routes render a noindex 404 page inside the site shell', async ({ page }) => {
  await gotoAndWait(page, '/totally-fake-route');

  await expect(page.getByRole('banner')).toBeVisible();
  await expect(page.getByRole('contentinfo')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: /page not found/i })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Go home' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open the Okra map' })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/totally-fake-route$/);
  expect(await readMetaContent(page, 'meta[name="robots"]')).toContain('noindex');
});

test('main internal routes respond without broken links', async ({ page, request, baseURL }) => {
  expect(baseURL).toBeTruthy();

  const discoveredLinks = new Set<string>(mainPaths);

  for (const path of mainPaths) {
    // /donate keeps the network busy via Stripe iframes; everything
    // else is fine on networkidle.
    const waitUntil = path === '/donate' ? 'domcontentloaded' : 'networkidle';
    await gotoAndWait(page, path, { waitUntil });
    for (const href of await readInternalLinks(page)) {
      discoveredLinks.add(href);
    }
  }

  for (const path of discoveredLinks) {
    const response = await request.get(new URL(path, baseURL).toString());
    expect(response.ok(), `Expected ${path} to load successfully.`).toBeTruthy();
  }
});

test('accessibility smoke checks keep labels and headings in place', async ({ page }) => {
  await gotoAndWait(page, '/contact');

  await expect(page.getByRole('heading', { level: 1, name: /get in touch/i })).toBeVisible();
  await expect(page.getByLabel('Name')).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Message')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();

  const buttonNames = await page.getByRole('button').evaluateAll((buttons) =>
    buttons
      .filter((button) => button instanceof HTMLElement && button.offsetParent !== null)
      .map((button) => button.getAttribute('aria-label') || button.textContent || '')
      .map((text) => text.trim()),
  );

  expect(buttonNames.every(Boolean)).toBeTruthy();
});
