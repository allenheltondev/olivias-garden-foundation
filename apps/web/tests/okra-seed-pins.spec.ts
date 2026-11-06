import { expect, test } from '@playwright/test';
import { gotoAndWait } from './test-helpers';

const SEED_PINS = {
  total_count: 1,
  data: [
    {
      id: 'seeds-0123456789abcdef',
      display_lat: 30.27,
      display_lng: -97.74,
      first_name: 'Jane',
      locality: 'Austin, TX',
      country: 'US',
      sent_month: '2026-10',
    },
  ],
};

test.describe('okra map seeds-sent pins', () => {
  test('shows a seeds-sent pin with first name and city only', async ({ page }) => {
    // Keep the garden layer empty so the only pin on the map is the seed pin.
    // Only intercept the API fetch, not the /okra page navigation itself.
    await page.route(/\/okra(\?.*)?$/, (route) =>
      route.request().resourceType() === 'document'
        ? route.continue()
        : route.fulfill({ json: { total_count: 0, data: [] } }),
    );
    await page.route(/\/okra\/seed-shipments(\?.*)?$/, (route) => route.fulfill({ json: SEED_PINS }));

    await gotoAndWait(page, '/okra');

    await expect(page.getByRole('list', { name: 'Map key' })).toContainText('Seeds sent');

    const pin = page.locator('.pin-icon--seeds').first();
    await expect(pin).toBeVisible();
    await pin.click();

    const dialog = page.getByRole('dialog', { name: 'Seeds sent to Jane' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Austin, TX');
    await expect(dialog).toContainText('October 2026');
  });

  test('garden map still loads when the seed pin layer fails', async ({ page }) => {
    await page.route(/\/okra\/seed-shipments(\?.*)?$/, (route) => route.fulfill({ status: 500, json: {} }));

    await gotoAndWait(page, '/okra');

    await expect(page.locator('.map-view__error')).toHaveCount(0);
    await expect(page.locator('.pin-icon--seeds')).toHaveCount(0);
  });
});
