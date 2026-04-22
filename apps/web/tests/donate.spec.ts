import { expect, test } from '@playwright/test';
import { gotoAndWait, trackBrowserErrors } from './test-helpers';

test.describe('donation flow', () => {
  test('donate flow completes a real Stripe test checkout from staging', async ({ page, baseURL }) => {
    expect(baseURL).toBeTruthy();

    const assertNoBrowserErrors = trackBrowserErrors(page);
    const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

    await gotoAndWait(page, '/');

    await page.getByRole('link', { name: 'Donate' }).first().click();
    await expect(page).toHaveURL(/\/donate$/);

    await expect(page.getByRole('button', { name: 'One-time gift' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Monthly Garden Club' })).toBeVisible();
    await expect(page.getByRole('button', { name: '$15' })).toBeVisible();
    await expect(page.getByRole('button', { name: '$25' })).toBeVisible();
    await expect(page.getByRole('button', { name: '$50' })).toBeVisible();
    await expect(page.getByRole('button', { name: '$100' })).toBeVisible();

    await page.getByLabel(/^Name/).fill(`Playwright Stage Donor ${runId}`);
    await page.getByLabel(/^Email/).fill(`playwright-donor-${runId}@example.com`);
    await page.getByLabel(/Who should we name your bee after/i).fill(`Playwright Bee ${runId}`);
    await page.getByRole('button', { name: 'Make donation' }).click();

    await expect(page.getByRole('heading', { level: 3, name: /secure checkout is ready below/i })).toBeVisible({
      timeout: 30000,
    });

    const checkoutFrame = page
      .frameLocator('.donate-embedded-checkout__mount iframe')
      .frameLocator('iframe[title*="Secure payment input frame"]');

    await expect(page.locator('.donate-embedded-checkout__mount iframe')).toBeVisible({ timeout: 30000 });

    await checkoutFrame.getByLabel(/Card number/i).fill('4242424242424242');
    await checkoutFrame.getByLabel(/Expiration date/i).fill('1234');
    await checkoutFrame.getByLabel(/Security code|CVV|CVC/i).fill('123');

    const outerCheckoutFrame = page.frameLocator('.donate-embedded-checkout__mount iframe');
    const payButton = outerCheckoutFrame.getByRole('button', { name: /pay|donate|subscribe/i }).last();
    await expect(payButton).toBeEnabled({ timeout: 30000 });
    await payButton.click();

    await expect(page).toHaveURL(/\/donate\?session_id=/, { timeout: 60000 });
    await expect(page.getByText('Donation complete')).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('heading', { name: 'Your gift is in.' })).toBeVisible({ timeout: 30000 });

    await assertNoBrowserErrors();
  });
});
