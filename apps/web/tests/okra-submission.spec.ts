import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { gotoAndWait } from './test-helpers';

const TEST_IMAGE_PATH = fileURLToPath(new URL('../public/images/okra/olivia-okra.jpg', import.meta.url));

test('okra submission flow uploads a photo and submits a garden entry', async ({ page }) => {
  let submissionBody: Record<string, unknown> | null = null;

  await page.route('**/api/okra', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    });
  });

  await page.route('**/api/okra/stats', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ total_pins: 0, country_count: 0 }),
    });
  });

  await page.route('https://nominatim.openstreetmap.org/search?*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          lat: '33.1976',
          lon: '-96.6153',
        },
      ]),
    });
  });

  await page.route('**/api/photos', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        photoId: 'photo-test-1',
        uploadUrl: 'http://127.0.0.1:4173/test-upload/photo-test-1',
      }),
    });
  });

  await page.route('**/test-upload/*', async (route) => {
    await route.fulfill({
      status: 200,
      body: '',
    });
  });

  await page.route('**/api/submissions', async (route) => {
    submissionBody = (await route.request().postDataJSON()) as Record<string, unknown>;
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    });
  });

  await gotoAndWait(page, '/okra');

  await page.getByRole('button', { name: 'Add my okra patch' }).first().click();

  const dialog = page.getByRole('dialog', { name: 'Add my okra patch' });
  await expect(dialog).toBeVisible();

  await dialog.locator('input[type="file"]').setInputFiles(TEST_IMAGE_PATH);

  await expect(dialog.getByLabel('Upload complete')).toBeVisible();

  await dialog.getByLabel('Your name (optional)').fill('Playwright Grower');
  await dialog.getByLabel('Your garden story (optional)').fill('A small backyard okra patch for the test flow.');
  await dialog.getByLabel('Location (city, state, or address)').fill('McKinney, Texas');
  await dialog.getByRole('button', { name: 'Find on map' }).click();

  await expect(dialog.getByText(/Coordinates:/)).toContainText('33.1976, -96.6153');

  await dialog.getByRole('radio', { name: /City/ }).check();
  await dialog.getByRole('button', { name: 'Submit your garden' }).click();

  await expect(dialog.getByRole('status')).toContainText(/pending review/i);

  expect(submissionBody).not.toBeNull();
  expect(submissionBody).toMatchObject({
    photoIds: ['photo-test-1'],
    rawLocationText: 'McKinney, Texas',
    displayLat: 33.1976,
    displayLng: -96.6153,
    contributorName: 'Playwright Grower',
    storyText: 'A small backyard okra patch for the test flow.',
    privacyMode: 'city',
  });
});
