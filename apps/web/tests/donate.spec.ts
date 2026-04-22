import { expect, test } from '@playwright/test';
import { gotoAndWait } from './test-helpers';

test.describe('donation flow', () => {
  test('donate flow opens Stripe checkout from the Stage site', async ({ page }) => {
    await gotoAndWait(page, '/');

    await page.getByRole('link', { name: 'Donate' }).first().click();
    await expect(page).toHaveURL(/\/donate$/);

    await expect(page.getByRole('button', { name: 'One-time gift' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Monthly Garden Club' })).toBeVisible();
    await expect(page.getByRole('button', { name: '$15' })).toBeVisible();
    await expect(page.getByRole('button', { name: '$25' })).toBeVisible();
    await expect(page.getByRole('button', { name: '$50' })).toBeVisible();
    await expect(page.getByRole('button', { name: '$100' })).toBeVisible();

    await page.getByLabel(/^Name/).fill('Playwright Stage Donor');
    await page.getByLabel(/^Email/).fill('stage-donor@example.com');
    await page.getByLabel(/Who should we name your bee after/i).fill('Stage Donor Family');
    await page.getByRole('button', { name: 'Make donation' }).click();

    await expect(page.getByRole('heading', { level: 3, name: /secure checkout is ready below/i })).toBeVisible({ timeout: 30000 });
    await expect(page.locator('.donate-embedded-checkout__mount iframe')).toBeVisible({ timeout: 30000 });
  });
});
