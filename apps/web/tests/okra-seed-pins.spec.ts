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

  test('lifts the low-pin zoom cap once seed pins arrive after the gardens', async ({ page }) => {
    // 2 gardens alone cap zoom at 8; 2 + 10 seed pins (12) switch to
    // clustering, which needs zoom 10+ to break clusters apart.
    const gardens = [
      { id: 'g1', display_lat: 30.3, display_lng: -97.7, contributor_name: 'A', story_text: null, country: 'US', photo_urls: [] },
      { id: 'g2', display_lat: 30.2, display_lng: -97.8, contributor_name: 'B', story_text: null, country: 'US', photo_urls: [] },
    ];
    const seeds = Array.from({ length: 10 }, (_, i) => ({
      id: `seeds-${String(i).padStart(16, '0')}`,
      display_lat: 30.25 + i * 0.01,
      display_lng: -97.75 + i * 0.01,
      first_name: `Grower${i}`,
      locality: 'Austin, TX',
      country: 'US',
      sent_month: '2026-10',
    }));

    const tileZooms: number[] = [];
    await page.route(/tile\.openstreetmap\.org\/(\d+)\//, (route) => {
      tileZooms.push(Number(route.request().url().match(/\.org\/(\d+)\//)![1]));
      return route.fulfill({ status: 204, body: '' });
    });
    await page.route(/\/okra(\?.*)?$/, (route) =>
      route.request().resourceType() === 'document'
        ? route.continue()
        : route.fulfill({ json: { total_count: gardens.length, data: gardens } }),
    );
    // Seed pins arrive well after the garden layer has rendered and capped zoom.
    await page.route(/\/okra\/seed-shipments(\?.*)?$/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.fulfill({ json: { total_count: seeds.length, data: seeds } });
    });

    await gotoAndWait(page, '/okra');
    await expect(page.locator('.cluster-icon, .pin-icon--seeds').first()).toBeVisible();

    const zoomIn = page.locator('.leaflet-control-zoom-in');
    for (let i = 0; i < 14; i++) {
      if (await zoomIn.evaluate((el) => el.classList.contains('leaflet-disabled'))) break;
      await zoomIn.click();
      await page.waitForTimeout(350);
    }

    expect(Math.max(...tileZooms)).toBeGreaterThan(8);
  });
});

