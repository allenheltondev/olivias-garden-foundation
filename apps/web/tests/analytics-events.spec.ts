import { expect, test, type Page } from '@playwright/test';
import { gotoAndWait } from './test-helpers';

type DataLayerEntry = unknown[];

async function gaEvents(page: Page, eventName: string) {
  const entries = (await page.evaluate(() => {
    const layer = (window as unknown as { dataLayer?: DataLayerEntry[] }).dataLayer ?? [];
    return layer.map((entry) => Array.from(entry as ArrayLike<unknown>));
  })) as DataLayerEntry[];
  return entries
    .filter((entry) => entry[0] === 'event' && entry[1] === eventName)
    .map((entry) => (entry[2] ?? {}) as Record<string, unknown>);
}

test.describe('analytics key events', () => {
  test('newsletter signup sends newsletter_signup with its source and no email', async ({ page }) => {
    await page.route(/\/newsletter$/, (route) => route.fulfill({ status: 200, json: { ok: true } }));
    await gotoAndWait(page, '/');

    await page.getByLabel('Email address').fill('reader@example.com');
    await page.getByRole('button', { name: 'Keep me posted' }).click();

    await expect.poll(async () => (await gaEvents(page, 'newsletter_signup')).length).toBe(1);
    const [params] = await gaEvents(page, 'newsletter_signup');
    expect(params).toEqual({ source: 'home' });
  });

  test('seed request success sends seed_request_submitted without personal data', async ({ page }) => {
    await page.route(/\/requests$/, (route) => (
      route.request().method() === 'POST'
        ? route.fulfill({ status: 201, json: { id: 'req-1' } })
        : route.continue()
    ));
    await gotoAndWait(page, '/okra');

    await page.getByRole('button', { name: 'Request free seeds' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Request free okra seeds' });
    await dialog.getByLabel('Name', { exact: true }).fill('Analytics Test');
    await dialog.getByLabel('Email', { exact: true }).fill('analytics@example.com');
    await dialog.getByLabel('Street address', { exact: true }).fill('123 Garden Row');
    await dialog.getByLabel('City', { exact: true }).fill('McKinney');
    await dialog.getByLabel('State / province', { exact: true }).fill('TX');
    await dialog.getByLabel('Postal code', { exact: true }).fill('75069');
    await dialog.getByLabel('Country').selectOption('US');
    await dialog.getByRole('button', { name: 'Send my request' }).click();

    await expect(dialog.getByRole('status')).toContainText('Request received');
    const events = await gaEvents(page, 'seed_request_submitted');
    expect(events).toEqual([{ fulfillment_method: 'mail', country: 'US' }]);
  });

  test.describe('donation completion', () => {
    const sessionId = 'cs_test_analytics';

    async function mockSessionStatus(page: Page, paymentStatus: string) {
      await page.route(/\/donations\/checkout-session-status/, (route) => route.fulfill({
        status: 200,
        json: { sessionId, status: 'complete', paymentStatus, customerEmail: null },
      }));
    }

    test.beforeEach(async ({ context }) => {
      await context.addInitScript((id) => {
        const key = `ogf:pending-donation:${id}`;
        if (!window.localStorage.getItem(key)) {
          window.localStorage.setItem(key, JSON.stringify({ mode: 'recurring', amountCents: 2500, savedAt: Date.now() }));
        }
      }, sessionId);
    });

    test('a paid session sends donation_completed once, even after a refresh', async ({ page }) => {
      await mockSessionStatus(page, 'paid');

      await gotoAndWait(page, `/donate?session_id=${sessionId}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByText('Your gift is in.')).toBeVisible();
      expect(await gaEvents(page, 'donation_completed')).toEqual([
        { donation_type: 'recurring', value: 25, currency: 'USD' },
      ]);

      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByText('Your gift is in.')).toBeVisible();
      expect(await gaEvents(page, 'donation_completed')).toEqual([]);
    });

    test('reopening the return URL in a second tab does not count the gift again', async ({ context, page }) => {
      await mockSessionStatus(page, 'paid');
      await gotoAndWait(page, `/donate?session_id=${sessionId}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByText('Your gift is in.')).toBeVisible();
      expect(await gaEvents(page, 'donation_completed')).toHaveLength(1);

      const secondTab = await context.newPage();
      await mockSessionStatus(secondTab, 'paid');
      await gotoAndWait(secondTab, `/donate?session_id=${sessionId}`, { waitUntil: 'domcontentloaded' });
      await expect(secondTab.getByText('Your gift is in.')).toBeVisible();
      expect(await gaEvents(secondTab, 'donation_completed')).toEqual([]);
    });

    test('a complete but unpaid session shows a processing message and does not count as a donation', async ({ page }) => {
      await mockSessionStatus(page, 'unpaid');

      await gotoAndWait(page, `/donate?session_id=${sessionId}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'Thank you. Your payment is still processing.' })).toBeVisible();
      await expect(page.getByText('Your gift is in.')).toHaveCount(0);
      expect(await gaEvents(page, 'donation_completed')).toEqual([]);
    });
  });
});
