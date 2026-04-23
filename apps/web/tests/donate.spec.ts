import { expect, test } from '@playwright/test';
import { gotoAndWait, trackBrowserErrors } from './test-helpers';

test.describe('donation flow', () => {
  test('donate flow completes a real Stripe test checkout from staging', async ({ page, baseURL }) => {
    test.setTimeout(120000);
    expect(baseURL).toBeTruthy();

    const assertNoBrowserErrors = trackBrowserErrors(page);
    const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const donorEmail = `playwright-donor-${runId}@example.com`;

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
    await page.getByLabel(/^Email/).fill(donorEmail);
    await page.getByLabel(/Who should we name your bee after/i).fill(`Playwright Bee ${runId}`);
    await page.getByRole('button', { name: 'Make donation' }).click();

    await expect(page.getByRole('heading', { level: 3, name: /secure checkout is ready below/i })).toBeVisible({
      timeout: 30000,
    });

    const checkout = page.frameLocator('iframe[title="Embedded checkout"]');
    await expect(checkout.getByText(/Payment method/i)).toBeVisible({ timeout: 30000 });

    await checkout.getByLabel(/^Email$/i).fill(donorEmail);
    await checkout.getByRole('radio', { name: /^Card$/i }).check();

    await expect(checkout.getByText(/Card information/i)).toBeVisible({ timeout: 30000 });
    await checkout.getByPlaceholder('1234 1234 1234 1234').fill('4242 4242 4242 4242');
    await checkout.getByPlaceholder('MM / YY').fill('12 / 34');
    await checkout.getByPlaceholder('CVC').fill('123');
    await checkout.getByPlaceholder('Full name on card').fill(`Playwright Stage Donor ${runId}`);
    await checkout.getByPlaceholder('ZIP').fill('75069');

    const donateButton = checkout.getByRole('button', { name: /^Donate$/i });
    await expect(donateButton).toBeEnabled({ timeout: 30000 });
    await donateButton.click();

    await expect(page).toHaveURL(/\/donate\?session_id=/, { timeout: 60000 });
    await expect(page.getByText('Donation complete')).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('heading', { name: 'Your gift is in.' })).toBeVisible({ timeout: 30000 });

    await assertNoBrowserErrors();
  });
});
