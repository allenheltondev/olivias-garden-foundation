import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import {
  gotoAndWait,
  hasCiCredentials,
  loginToProfile,
  trackBrowserErrors,
  uniqueRunId,
} from './test-helpers';

test.describe('okra authenticated workflows (staging)', () => {
  test.skip(
    !hasCiCredentials(),
    'Authenticated okra workflows require OGF_CI_USERNAME / OGF_CI_PASSWORD.',
  );

  test('logged-in okra submission appears in profile activity', async ({ page, baseURL }) => {
    expect(baseURL).toBeTruthy();

    const assertNoBrowserErrors = trackBrowserErrors(page);
    const runId = uniqueRunId();
    const storyText = `Playwright logged-in okra submission ${runId}`;

    await loginToProfile(page);
    await gotoAndWait(page, '/okra');

    await page.getByRole('button', { name: 'Add my okra patch' }).first().click();

    const dialog = page.getByRole('dialog', { name: 'Add my okra patch' });
    await expect(dialog).toBeVisible();

    await dialog.locator('input[type="file"]').setInputFiles([
      fileURLToPath(new URL('../../../services/okra-api/scripts/integration/img/okra1.jpg', import.meta.url)),
    ]);
    await expect(dialog.getByLabel('Upload complete')).toHaveCount(1, { timeout: 30000 });

    await dialog.getByLabel('Your garden story (optional)').fill(storyText);
    await dialog.getByLabel('Location (city, state, or address)').fill('McKinney, Texas');
    await dialog.getByRole('button', { name: 'Or click to pick on map' }).click();

    const map = dialog.locator('.location-input__map');
    await expect(map).toBeVisible();
    await map.click({ position: { x: 160, y: 120 } });

    await expect(dialog.getByRole('radio', { name: /City/ })).toBeVisible();
    await dialog.getByRole('radio', { name: /City/ }).check();
    await dialog.getByRole('button', { name: 'Submit your garden' }).click();

    await expect(dialog.getByRole('status')).toContainText(
      'Your garden has been submitted and is pending review. Thank you.',
      { timeout: 30000 },
    );

    await gotoAndWait(page, '/profile');
    await expect(page.getByText('Your activity')).toBeVisible();
    await expect(page.getByText(storyText)).toBeVisible({ timeout: 30000 });

    await assertNoBrowserErrors();
  });

  test('logged-in seed request appears in profile activity', async ({ page, baseURL }) => {
    expect(baseURL).toBeTruthy();

    const assertNoBrowserErrors = trackBrowserErrors(page);
    const runId = uniqueRunId();
    const requestMessage = `Playwright logged-in seed request ${runId}`;

    await loginToProfile(page);
    await gotoAndWait(page, '/okra');

    await page.getByRole('button', { name: 'Request free seeds' }).first().click();

    const dialog = page.getByRole('dialog', { name: 'Request free okra seeds' });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel('Name').fill(`Playwright Seed Request ${runId}`);
    await dialog.getByLabel('Street address').fill('123 Garden Row');
    await dialog.getByLabel('City').fill('McKinney');
    await dialog.getByLabel('State / province').fill('TX');
    await dialog.getByLabel('Postal code').fill('75069');
    await dialog.getByLabel('Country').selectOption('US');
    await dialog.getByLabel('Message').fill(requestMessage);
    await dialog.getByRole('button', { name: 'Send my request' }).click();

    await expect(dialog.getByRole('status')).toContainText(
      "Request received. We'll be in touch by email soon.",
      { timeout: 30000 },
    );

    await gotoAndWait(page, '/profile');
    await expect(page.getByText('Your activity')).toBeVisible();
    await expect(page.getByText('Seed request by mail')).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(requestMessage)).toBeVisible({ timeout: 30000 });

    await assertNoBrowserErrors();
  });
});
