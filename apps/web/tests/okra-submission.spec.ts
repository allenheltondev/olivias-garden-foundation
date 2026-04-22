import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { gotoAndWait, trackBrowserErrors } from './test-helpers';

const TEST_IMAGE_PATH = fileURLToPath(new URL('../public/images/okra/olivia-okra.jpg', import.meta.url));

test.describe('okra submission flow (staging)', () => {
  test('opens the modal, uploads an okra photo, submits, and shows success', async ({ page, baseURL }) => {
    expect(baseURL).toBeTruthy();

    const assertNoBrowserErrors = trackBrowserErrors(page);
    const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const contributorName = `Playwright Grower ${runId}`;
    const storyText = `A small backyard okra patch submitted by Playwright run ${runId}.`;

    await gotoAndWait(page, '/okra');

    await page.getByRole('button', { name: 'Add my okra patch' }).first().click();

    const dialog = page.getByRole('dialog', { name: 'Add my okra patch' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Submit your garden' })).toBeDisabled();

    await dialog.locator('input[type="file"]').setInputFiles(TEST_IMAGE_PATH);
    await expect(dialog.getByLabel('Upload complete')).toBeVisible({ timeout: 30000 });

    await dialog.getByLabel('Your name (optional)').fill(contributorName);
    await dialog.getByLabel('Your garden story (optional)').fill(storyText);
    await dialog.getByLabel('Location (city, state, or address)').fill('McKinney, Texas');

    await dialog.getByRole('button', { name: 'Or click to pick on map' }).click();

    const map = dialog.locator('.location-input__map');
    await expect(map).toBeVisible();
    await map.click({ position: { x: 160, y: 120 } });

    await expect(dialog.getByText(/Coordinates:/)).toBeVisible();
    await dialog.getByRole('radio', { name: /City/ }).check();
    await expect(dialog.getByRole('button', { name: 'Submit your garden' })).toBeEnabled();

    await dialog.getByRole('button', { name: 'Submit your garden' }).click();

    await expect(dialog.getByRole('status')).toContainText(
      'Your garden has been submitted and is pending review. Thank you.',
      { timeout: 30000 },
    );

    await assertNoBrowserErrors();
  });
});
