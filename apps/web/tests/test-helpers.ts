import { expect, type Page } from '@playwright/test';

export const mainPaths = [
  '/',
  '/about',
  '/get-involved',
  '/impact',
  '/donate',
  '/contact',
  '/seeds',
  '/okra',
];

export function trackBrowserErrors(page: Page) {
  const errors: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });

  page.on('pageerror', (error) => {
    errors.push(error.message);
  });

  return async () => {
    expect(errors).toEqual([]);
  };
}

export async function gotoAndWait(page: Page, path: string) {
  const response = await page.goto(path, { waitUntil: 'networkidle' });
  expect(response, `Expected a response when visiting ${path}`).not.toBeNull();
  return response;
}

export async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));

  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

export async function readMetaContent(page: Page, selector: string) {
  return page.locator(selector).getAttribute('content');
}

export async function readInternalLinks(page: Page) {
  const hrefs = await page.locator('a[href^="/"]').evaluateAll((links) =>
    links
      .map((link) => link.getAttribute('href') ?? '')
      .filter(Boolean),
  );

  return [...new Set(hrefs)]
    .map((href) => href.split('#')[0]?.split('?')[0] ?? '')
    .filter(Boolean);
}
