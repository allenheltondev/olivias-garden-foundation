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

const CI_USERNAME = process.env.OGF_CI_USERNAME ?? process.env.OKRA_CI_ADMIN_USERNAME;
const CI_PASSWORD = process.env.OGF_CI_PASSWORD ?? process.env.OKRA_CI_ADMIN_PASSWORD;

export async function gotoAndWait(page: Page, path: string) {
  const response = await page.goto(path, { waitUntil: 'networkidle' });
  expect(response, `Expected a response when visiting ${path}`).not.toBeNull();
  return response;
}

export function uniqueRunId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export function hasCiCredentials() {
  return Boolean(CI_USERNAME && CI_PASSWORD);
}

export function deriveAdminBaseUrl(baseURL: string) {
  const explicit = process.env.PLAYWRIGHT_ADMIN_BASE_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/+$/, '');
  }

  const url = new URL(baseURL);
  if (!url.hostname.startsWith('admin.')) {
    url.hostname = `admin.${url.hostname}`;
  }
  url.pathname = '';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/+$/, '');
}

export async function loginThroughUi(page: Page, options?: { redirectUrl?: string }) {
  testRequiresCiCredentials();

  const loginPath = options?.redirectUrl
    ? `/login?redirect=${encodeURIComponent(options.redirectUrl)}`
    : '/login';

  await gotoAndWait(page, loginPath);
  await page.getByLabel('Email').fill(CI_USERNAME ?? '');
  await page.getByLabel('Password').fill(CI_PASSWORD ?? '');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
}

export async function loginToProfile(page: Page) {
  await loginThroughUi(page);
  await expect(page.locator('.og-auth-utility__avatar')).toBeVisible({ timeout: 15000 });
}

export async function loginToAdmin(page: Page, baseURL: string) {
  const adminBaseUrl = deriveAdminBaseUrl(baseURL);
  const foundationLoginUrl = new URL(`/login?redirect=${encodeURIComponent(adminBaseUrl)}`, baseURL).toString();
  await page.goto(adminBaseUrl, { waitUntil: 'networkidle' });
  if (await page.getByLabel('Email').count() === 0) {
    await page.goto(foundationLoginUrl, { waitUntil: 'networkidle' });
  }

  await page.getByLabel('Email').fill(CI_USERNAME ?? '');
  await page.getByLabel('Password').fill(CI_PASSWORD ?? '');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();

  await expect(page).toHaveURL(new RegExp(`^${escapeRegExp(adminBaseUrl)}`), { timeout: 30000 });
  await expect(page.getByRole('heading', { name: /Moderation and store operations in one control room\./i })).toBeVisible({
    timeout: 30000,
  });
}

function testRequiresCiCredentials() {
  expect(CI_USERNAME, 'Playwright auth flows require OGF_CI_USERNAME / OGF_CI_PASSWORD').toBeTruthy();
  expect(CI_PASSWORD, 'Playwright auth flows require OGF_CI_USERNAME / OGF_CI_PASSWORD').toBeTruthy();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
