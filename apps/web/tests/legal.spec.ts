import { expect, test } from '@playwright/test';
import { gotoAndWait } from './test-helpers';

test.describe('legal pages', () => {
  test('privacy policy loads and is linked in the footer', async ({ page }) => {
    await gotoAndWait(page, '/privacy');

    await expect(page.getByRole('heading', { name: 'Privacy Policy', level: 1 })).toBeVisible();
    await expect(page.locator('.legal-document__effective')).toContainText('April 30, 2026');

    const footerLink = page.locator('footer').getByRole('link', { name: 'Terms of Service' });
    await expect(footerLink).toBeVisible();
  });

  test('terms of service loads and is linked in the footer', async ({ page }) => {
    await gotoAndWait(page, '/terms');

    await expect(page.getByRole('heading', { name: 'Terms of Service', level: 1 })).toBeVisible();
    await expect(page.locator('.legal-document__effective')).toContainText('April 23, 2026');

    const footerLink = page.locator('footer').getByRole('link', { name: 'Privacy Policy' });
    await expect(footerLink).toBeVisible();
  });

  test('data deletion page loads with deletion instructions and footer link', async ({ page }) => {
    await gotoAndWait(page, '/data');

    await expect(
      page.getByRole('heading', { name: 'Data and account deletion', level: 1 }),
    ).toBeVisible();
    await expect(page.locator('.legal-document__effective')).toContainText('April 24, 2026');
    await expect(page.getByRole('heading', { name: /Delete from inside your account/ })).toBeVisible();

    const footerLink = page.locator('footer').getByRole('link', { name: 'Your data' });
    await expect(footerLink).toBeVisible();
  });
});
