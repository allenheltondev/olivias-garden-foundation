import { expect, test } from '@playwright/test';
import { gotoAndWait, mainPaths, readInternalLinks, readMetaContent } from './test-helpers';

test('homepage and donate page expose core metadata', async ({ page }) => {
  await gotoAndWait(page, '/');
  await expect(page).toHaveTitle(/Olivia's Garden Foundation/i);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/$/);
  await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute('href', '/images/icons/logo.svg');
  await expect(page.locator('header img[src="/images/icons/logo.svg"]').first()).toBeVisible();
  await expect(page.locator('footer img[src="/images/icons/logo.svg"]').first()).toBeVisible();
  expect(await readMetaContent(page, 'meta[name="description"]')).toBeTruthy();
  expect(await readMetaContent(page, 'meta[property="og:title"]')).toBeTruthy();
  expect(await readMetaContent(page, 'meta[property="og:description"]')).toBeTruthy();
  expect(await readMetaContent(page, 'meta[property="og:image"]')).toContain('/images/home/og-image.png');
  expect(await readMetaContent(page, 'meta[property="og:image:alt"]')).toBeTruthy();
  expect(await readMetaContent(page, 'meta[property="og:url"]')).toBeTruthy();

  await gotoAndWait(page, '/donate');
  await expect(page).toHaveTitle(/Support Olivia's Garden/i);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/donate$/);
  expect(await readMetaContent(page, 'meta[name="description"]')).toBeTruthy();
  expect(await readMetaContent(page, 'meta[name="twitter:image"]')).toContain('/images/home/og-image.png');
  expect(await readMetaContent(page, 'meta[name="twitter:image:alt"]')).toBeTruthy();
});

test('main internal routes respond without broken links', async ({ page, request, baseURL }) => {
  expect(baseURL).toBeTruthy();

  const discoveredLinks = new Set<string>(mainPaths);

  for (const path of mainPaths) {
    await gotoAndWait(page, path);
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
  await expect(page.getByRole('button', { name: 'Open email to send' })).toBeVisible();

  const buttonNames = await page.getByRole('button').evaluateAll((buttons) =>
    buttons
      .filter((button) => button instanceof HTMLElement && button.offsetParent !== null)
      .map((button) => button.getAttribute('aria-label') || button.textContent || '')
      .map((text) => text.trim()),
  );

  expect(buttonNames.every(Boolean)).toBeTruthy();
});
