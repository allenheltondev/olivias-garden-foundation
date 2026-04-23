import { expect, test } from '@playwright/test';
import { gotoAndWait } from './test-helpers';

test.describe('legal pages', () => {
  test('privacy policy loads and is linked in the footer', async ({ page }) => {
    await gotoAndWait(page, '/privacy');

    await expect(page.getByRole('heading', { name: 'Privacy Policy' })).toBeVisible();
    await expect(page.getByText('Effective date: April 23, 2026.')).toBeVisible();

    const footerLink = page.locator('footer').getByRole('link', { name: 'Terms of Service' });
    await expect(footerLink).toBeVisible();
  });

  test('terms of service loads and is linked in the footer', async ({ page }) => {
    await gotoAndWait(page, '/terms');

    await expect(page.getByRole('heading', { name: 'Terms of Service' })).toBeVisible();
    await expect(page.getByText('Effective date: April 23, 2026.')).toBeVisible();

    const footerLink = page.locator('footer').getByRole('link', { name: 'Privacy Policy' });
    await expect(footerLink).toBeVisible();
  });
});
