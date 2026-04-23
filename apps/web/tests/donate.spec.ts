import { expect, test, type Page } from '@playwright/test';
import { gotoAndWait, trackBrowserErrors } from './test-helpers';

async function fillStripeField(page: Page, label: RegExp, value: string) {
  const deadline = Date.now() + 30000;

  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      try {
        const field = frame.getByLabel(label).first();
        if (await field.count()) {
          await field.fill(value);
          return;
        }
      } catch {
        // Keep scanning other frames while Stripe mounts.
      }
    }

    await page.waitForTimeout(250);
  }

  throw new Error(`Timed out finding Stripe field ${label}`);
}

async function clickStripePayButton(page: Page) {
  const deadline = Date.now() + 30000;

  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      try {
        const button = frame.getByRole('button', { name: /pay|donate|subscribe/i }).last();
        if (await button.count()) {
          await expect(button).toBeEnabled({ timeout: 5000 });
          await button.click();
          return;
        }
      } catch {
        // Keep scanning other frames while Stripe mounts.
      }
    }

    await page.waitForTimeout(250);
  }

  throw new Error('Timed out finding Stripe pay button');
}

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

    await expect(page.locator('.donate-embedded-checkout__mount iframe')).toBeVisible({ timeout: 30000 });

    await fillStripeField(page, /Card number/i, '4242424242424242');
    await fillStripeField(page, /Expiration date/i, '1234');
    await fillStripeField(page, /Security code|CVV|CVC/i, '123');
    await clickStripePayButton(page);

    await expect(page).toHaveURL(/\/donate\?session_id=/, { timeout: 60000 });
    await expect(page.getByText('Donation complete')).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('heading', { name: 'Your gift is in.' })).toBeVisible({ timeout: 30000 });

    await assertNoBrowserErrors();
  });
});
