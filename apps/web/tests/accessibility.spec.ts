import { expect, test } from '@playwright/test';
import { gotoAndWait } from './test-helpers';

test('tabbing from the top reveals a skip-to-content link targeting main content', async ({ page }) => {
  await gotoAndWait(page, '/');

  const skipLink = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skipLink).toHaveAttribute('href', '#main-content');
  await expect(page.locator('main#main-content')).toBeVisible();

  await page.keyboard.press('Tab');
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();

  await page.keyboard.press('Enter');
  await expect(page.locator('main#main-content')).toBeFocused();
});

test('donation amount chips expose selected state to assistive technology', async ({ page }) => {
  // /donate mounts Stripe Embedded Checkout — its iframes keep the
  // network busy long enough that `networkidle` times out. We only
  // assert DOM aria state here, so DOMContentLoaded + auto-waiting
  // assertions are sufficient.
  await gotoAndWait(page, '/donate', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('button', { name: '$25' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '$50' })).toHaveAttribute('aria-pressed', 'false');

  await page.getByRole('button', { name: '$50' }).click();
  await expect(page.getByRole('button', { name: '$25' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: '$50' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByPlaceholder('Other amount').fill('75');
  await expect(page.getByRole('button', { name: '$50' })).toHaveAttribute('aria-pressed', 'false');
});
