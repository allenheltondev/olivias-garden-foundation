import { expect, test, type Frame, type Locator, type Page } from '@playwright/test';
import { gotoAndWait, trackBrowserErrors } from './test-helpers';

async function getEmbeddedCheckoutFrame(page: Page) {
  await expect(page.locator('iframe[title="Embedded checkout"]')).toBeVisible({ timeout: 30000 });

  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const frame = page.frames().find((candidate) => candidate.name() === 'embedded-checkout');
    if (frame) {
      return frame;
    }
    await page.waitForTimeout(250);
  }

  throw new Error('Timed out finding Stripe embedded checkout frame');
}

function isDescendantFrame(frame: Frame, ancestor: Frame) {
  let current: Frame | null = frame;
  while (current) {
    if (current === ancestor) {
      return true;
    }
    current = current.parentFrame();
  }
  return false;
}

async function waitForEmbeddedCheckoutLocator(
  page: Page,
  embeddedFrame: Frame,
  locatorFactory: (scope: Frame) => Locator,
  description: string,
  timeoutMs = 30000,
) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const candidateFrames = page.frames().filter((frame) => isDescendantFrame(frame, embeddedFrame));

    for (const frame of candidateFrames) {
      try {
        const locator = locatorFactory(frame).first();
        if (await locator.count()) {
          return locator;
        }
      } catch {
        // Stripe can re-render frames during mount; keep scanning.
      }
    }

    await page.waitForTimeout(250);
  }

  throw new Error(`Timed out finding Stripe element: ${description}`);
}

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

    const embeddedFrame = await getEmbeddedCheckoutFrame(page);
    const checkout = page.frameLocator('iframe[title="Embedded checkout"]');
    await expect(checkout.getByText(/Payment method/i)).toBeVisible({ timeout: 30000 });

    const cardButton = checkout.locator('button[data-testid="card-accordion-item-button"]');
    await expect(cardButton).toBeVisible({ timeout: 30000 });
    await cardButton.click();

    await expect(checkout.getByText(/Card information/i)).toBeVisible({ timeout: 30000 });
    await (await waitForEmbeddedCheckoutLocator(
      page,
      embeddedFrame,
      (scope) => scope.locator('input[name="cardNumber"]'),
      'card number input',
      60000,
    )).fill('4242 4242 4242 4242');
    await (await waitForEmbeddedCheckoutLocator(
      page,
      embeddedFrame,
      (scope) => scope.locator('input[name="cardExpiry"]'),
      'card expiry input',
      60000,
    )).fill('12 / 34');
    await (await waitForEmbeddedCheckoutLocator(
      page,
      embeddedFrame,
      (scope) => scope.locator('input[name="cardCvc"]'),
      'card cvc input',
      60000,
    )).fill('123');
    await (await waitForEmbeddedCheckoutLocator(
      page,
      embeddedFrame,
      (scope) => scope.locator('input[name="billingName"]'),
      'billing name input',
      60000,
    )).fill(`Playwright Stage Donor ${runId}`);
    await (await waitForEmbeddedCheckoutLocator(
      page,
      embeddedFrame,
      (scope) => scope.locator('input[name="billingPostalCode"]'),
      'billing postal code input',
      60000,
    )).fill('75069');

    const saveInfoCheckbox = checkout.getByRole('checkbox', { name: /Save my information for faster checkout/i });
    await expect(saveInfoCheckbox).toBeVisible({ timeout: 30000 });
    if (await saveInfoCheckbox.isChecked()) {
      await saveInfoCheckbox.uncheck();
    }

    const donateButton = checkout.locator('button[data-testid="hosted-payment-submit-button"]');
    await expect(donateButton).toBeEnabled({ timeout: 30000 });
    await donateButton.click();

    await expect(page).toHaveURL(/\/donate\?session_id=/, { timeout: 60000 });
    await expect(page.getByText('Donation complete')).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('heading', { name: 'Your gift is in.' })).toBeVisible({ timeout: 30000 });

    await assertNoBrowserErrors();
  });
});
