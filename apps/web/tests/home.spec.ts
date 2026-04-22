import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow, gotoAndWait, trackBrowserErrors } from './test-helpers';

test('homepage loads with working nav and footer', async ({ page }) => {
  const assertNoBrowserErrors = trackBrowserErrors(page);

  await gotoAndWait(page, '/');

  await expect(page).toHaveTitle(/Olivia's Garden Foundation/i);
  await expect(page.getByRole('heading', { level: 1, name: /learn to grow food/i })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Get involved' }).first()).toBeVisible();

  await page.getByRole('link', { name: 'About' }).first().click();
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByRole('heading', { level: 1, name: /about olivia's garden/i })).toBeVisible();

  const footer = page.locator('footer');
  await expect(footer.getByRole('link', { name: 'Home' })).toBeVisible();
  await expect(footer.getByRole('link', { name: 'About' })).toBeVisible();
  await expect(footer.getByRole('link', { name: 'Donate' })).toBeVisible();
  await expect(footer.getByRole('link', { name: /instagram/i })).toBeVisible();
  await expect(footer.getByRole('link', { name: /facebook/i })).toBeVisible();

  await assertNoBrowserErrors();
});

test.describe('homepage mobile', () => {
  test.use({
    viewport: { width: 390, height: 844 },
  });

  test('homepage keeps core content usable on mobile', async ({ page }) => {
    await gotoAndWait(page, '/');

    await expect(page.getByRole('heading', { level: 1, name: /learn to grow food/i })).toBeVisible();
    await expect(page.locator('.home-mobile-image-break').first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Get involved' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Donate' }).first()).toBeVisible();

    await expectNoHorizontalOverflow(page);
  });
});
