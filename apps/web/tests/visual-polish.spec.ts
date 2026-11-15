import { expect, test } from '@playwright/test';
import { gotoAndWait } from './test-helpers';

test('mobile giving choices come before the longer story and keep their selection', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoAndWait(page, '/donate', { waitUntil: 'domcontentloaded' });
  const options = page.getByRole('region', { name: 'Donation options' });
  await expect(options.getByRole('heading', { name: 'Choose your gift' })).toBeVisible();
  const first = await options.getByRole('button', { name: '$15', exact: true }).boundingBox();
  const second = await options.getByRole('button', { name: '$25', exact: true }).boundingBox();
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  expect(first!.y).toBeLessThan(1100);
  expect(Math.abs(first!.y - second!.y)).toBeLessThan(2);
  const story = page.getByRole('heading', { name: 'A donation should feel like belonging, not just a transaction.' });
  expect((await story.boundingBox())!.y).toBeGreaterThan(first!.y);
  await options.getByRole('button', { name: '$50', exact: true }).click();
  await expect(options.getByRole('button', { name: '$50', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await options.getByRole('button', { name: 'Monthly Garden Club' }).click();
  await expect(options.getByRole('button', { name: 'Monthly Garden Club' })).toHaveAttribute('aria-pressed', 'true');
  await expect(options.getByLabel(/T-shirt choice/)).toBeVisible();
  await options.getByRole('button', { name: 'One-time gift' }).click();
  await expect(options.getByLabel(/T-shirt choice/)).toHaveCount(0);
  await expect(options.getByRole('button', { name: '$50', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('the mobile product introduction shows the garden designer before the feature sections', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoAndWait(page, '/good-roots', { waitUntil: 'domcontentloaded' });
  const preview = page.getByRole('img', { name: 'Good Roots garden designer showing vegetable beds laid out across a garden.' });
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute('width', '1616');
  await expect(preview).toHaveAttribute('height', '1212');
  await expect(preview).toHaveAttribute('loading', 'eager');
  await expect(preview).toHaveAttribute('fetchpriority', 'high');
  await expect.poll(() => preview.evaluate((image: HTMLImageElement) => image.currentSrc))
    .toMatch(/app-garden-map-(480|768)\.avif$/);
  expect((await preview.boundingBox())!.y).toBeLessThan(850);
  const steps = page.getByRole('heading', { name: 'How it works', exact: true });
  expect((await preview.boundingBox())!.y).toBeLessThan((await steps.boundingBox())!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('participation choices show availability and workshops have a useful next step', async ({ page }) => {
  await page.route('**/workshops', (route) => route.request().resourceType() === 'fetch'
    ? route.fulfill({ json: { items: [] } })
    : route.continue());
  await gotoAndWait(page, '/get-involved');
  await expect(page.getByText('Available now', { exact: true })).toHaveCount(2);
  await expect(page.getByText('Browse workshops', { exact: true })).toBeVisible();
  await expect(page.locator('.get-involved-card .og-garden-icon')).toHaveCount(4);
  await page.getByRole('link', { name: 'View workshops', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No workshops scheduled yet.' })).toBeVisible();
  await page.getByRole('link', { name: 'Suggest a workshop' }).click();
  await expect(page).toHaveURL(/\/contact$/);
  await expect(page.getByRole('heading', { name: 'Send a message' })).toBeVisible();
});

test('the participation workshop card stays accurate when registration is open', async ({ page }) => {
  await page.route('**/workshops', (route) => route.request().resourceType() === 'fetch'
    ? route.fulfill({ json: { items: [{
      id: 'sample-workshop', slug: 'seed-saving', title: 'Seed saving',
      short_description: 'Learn to save seeds from the garden.', description: null,
      status: 'open', workshop_date: null, location: 'The garden', capacity: 10,
      seats_remaining: 10, image_url: null, is_paid: false, price_cents: null,
      currency: 'usd', interested_count: 0, my_signup: null,
    }] } })
    : route.continue());
  await gotoAndWait(page, '/get-involved');
  const card = page.locator('.get-involved-card').filter({ has: page.getByRole('heading', { name: 'Hands-on workshops.' }) });
  await expect(card.getByText('Browse workshops', { exact: true })).toBeVisible();
  await expect(card).not.toContainText('Nothing is on the calendar');
  await expect(card).not.toContainText('Being planned');
  await card.getByRole('link', { name: 'View workshops', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Seed saving' })).toBeVisible();
  await expect(page.getByText('Registration open', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No workshops scheduled yet.' })).toHaveCount(0);
});

test('mobile contact puts the message form before supporting details', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoAndWait(page, '/contact');
  const form = await page.getByRole('heading', { name: 'Send a message' }).boundingBox();
  const details = await page.getByRole('heading', { name: 'Reach us directly' }).boundingBox();
  expect(form!.y).toBeLessThan(details!.y);
  await expect(page.getByRole('button', { name: 'Send message' })).toBeDisabled();
});

test('requesting seeds keeps optional account actions out of the guest form', async ({ page }) => {
  await gotoAndWait(page, '/okra', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Request free seeds', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Request free okra seeds' });
  await expect(dialog.getByLabel('Name', { exact: true })).toBeVisible();
  const account = dialog.locator('.seed-request__account');
  // Accounts are optional and may be disabled in a local environment.
  if (await account.count()) {
    await expect(account.getByRole('button', { name: 'Log in', exact: true })).not.toBeVisible();
    await account.locator('summary').click();
    await expect(account.getByRole('button', { name: 'Log in', exact: true })).toBeVisible();
    await expect(account.getByRole('button', { name: 'Sign up', exact: true })).toBeVisible();
  }
});
