import { expect, test, type Page } from '@playwright/test';
import { gotoAndWait, trackBrowserErrors } from './test-helpers';

type StripeFieldKind = 'cardNumber' | 'expiry' | 'cvc';

function stripeFieldLocators(frame: Page['mainFrame'], kind: StripeFieldKind) {
  switch (kind) {
    case 'cardNumber':
      return [
        frame.locator('input[name="number"]').first(),
        frame.locator('input[autocomplete="cc-number"]').first(),
        frame.getByPlaceholder(/4242|1234 1234|Card number/i).first(),
        frame.getByLabel(/Card number|Card information/i).first(),
      ];
    case 'expiry':
      return [
        frame.locator('input[name="expiry"]').first(),
        frame.locator('input[autocomplete="cc-exp"]').first(),
        frame.getByPlaceholder(/MM\s*\/\s*YY|Expiration/i).first(),
        frame.getByLabel(/Expiration date|Expiry/i).first(),
      ];
    case 'cvc':
      return [
        frame.locator('input[name="cvc"]').first(),
        frame.locator('input[autocomplete="cc-csc"]').first(),
        frame.getByPlaceholder(/CVC|CVV|Security code/i).first(),
        frame.getByLabel(/Security code|CVV|CVC/i).first(),
      ];
  }
}

async function fillStripeField(page: Page, kind: StripeFieldKind, value: string) {
  const deadline = Date.now() + 60000;

  while (Date.now() < deadline) {
    if (page.isClosed()) {
      throw new Error(`Page closed while waiting for Stripe field ${kind}`);
    }

    for (const frame of page.frames()) {
      try {
        if (!frame.url().includes('js.stripe.com')) {
          continue;
        }

        for (const field of stripeFieldLocators(frame, kind)) {
          if (await field.count()) {
            await field.fill(value);
            return;
          }
        }
      } catch {
        // Keep scanning other frames while Stripe mounts.
      }
    }

    await page.waitForTimeout(250);
  }

  throw new Error(`Timed out finding Stripe field ${kind}`);
}

async function clickStripePayButton(page: Page) {
  const deadline = Date.now() + 60000;

  while (Date.now() < deadline) {
    if (page.isClosed()) {
      throw new Error('Page closed while waiting for Stripe pay button');
    }

    for (const frame of page.frames()) {
      try {
        if (!frame.url().includes('js.stripe.com')) {
          continue;
        }
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
    test.setTimeout(120000);
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

    await fillStripeField(page, 'cardNumber', '4242424242424242');
    await fillStripeField(page, 'expiry', '1234');
    await fillStripeField(page, 'cvc', '123');
    await clickStripePayButton(page);

    await expect(page).toHaveURL(/\/donate\?session_id=/, { timeout: 60000 });
    await expect(page.getByText('Donation complete')).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('heading', { name: 'Your gift is in.' })).toBeVisible({ timeout: 30000 });

    await assertNoBrowserErrors();
  });
});
