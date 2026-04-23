import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import {
  gotoAndWait,
  hasCiCredentials,
  loginToAdmin,
  trackBrowserErrors,
  uniqueRunId,
} from './test-helpers';

const OKRA_IMAGE_PATH = fileURLToPath(
  new URL('../../../services/okra-api/scripts/integration/img/okra2.jpg', import.meta.url),
);

test.describe('okra admin moderation workflows (staging)', () => {
  test.skip(
    !hasCiCredentials(),
    'Admin workflows require OGF_CI_USERNAME / OGF_CI_PASSWORD.',
  );

  test('admin approves a newly submitted okra patch', async ({ page, baseURL }) => {
    expect(baseURL).toBeTruthy();

    const assertNoBrowserErrors = trackBrowserErrors(page);
    const runId = uniqueRunId();
    const contributorName = `Playwright Admin Queue ${runId}`;
    const storyText = `Playwright admin approval submission ${runId}`;

    await gotoAndWait(page, '/okra');
    await page.getByRole('button', { name: 'Add my okra patch' }).first().click();

    const dialog = page.getByRole('dialog', { name: 'Add my okra patch' });
    await dialog.locator('input[type="file"]').setInputFiles([OKRA_IMAGE_PATH]);
    await expect(dialog.getByLabel('Upload complete')).toHaveCount(1, { timeout: 30000 });
    await dialog.getByLabel('Your name (optional)').fill(contributorName);
    await dialog.getByLabel('Your garden story (optional)').fill(storyText);
    await dialog.getByLabel('Location (city, state, or address)').fill('McKinney, Texas');
    await dialog.getByRole('button', { name: 'Or click to pick on map' }).click();
    await dialog.locator('.location-input__map').click({ position: { x: 160, y: 120 } });
    await dialog.getByRole('radio', { name: /City/ }).check();
    await dialog.getByRole('button', { name: 'Submit your garden' }).click();

    await expect(dialog.getByRole('status')).toContainText(
      'Your garden has been submitted and is pending review. Thank you.',
      { timeout: 30000 },
    );

    await loginToAdmin(page, baseURL!);

    const card = page.locator('.admin-card--submission').filter({ hasText: contributorName }).first();
    await expect(card).toBeVisible({ timeout: 30000 });
    await expect(card).toContainText(storyText);
    await card.getByRole('button', { name: 'Approve' }).click();
    await expect(card).toBeHidden({ timeout: 30000 });

    await gotoAndWait(page, '/okra');
    await expect(page.getByText(contributorName)).toBeVisible({ timeout: 30000 });

    await assertNoBrowserErrors();
  });

  test('admin marks a newly submitted seed request as handled', async ({ page, baseURL }) => {
    expect(baseURL).toBeTruthy();

    const assertNoBrowserErrors = trackBrowserErrors(page);
    const runId = uniqueRunId();
    const requesterName = `Playwright Seed Queue ${runId}`;
    const requestMessage = `Playwright admin handled seed request ${runId}`;

    await gotoAndWait(page, '/okra');
    await page.getByRole('button', { name: 'Request free seeds' }).first().click();

    const dialog = page.getByRole('dialog', { name: 'Request free okra seeds' });
    await dialog.getByLabel('Name').fill(requesterName);
    await dialog.getByLabel('Email').fill(`playwright-admin-seeds-${runId}@example.com`);
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

    await loginToAdmin(page, baseURL!);
    await page.getByRole('button', { name: 'Seed requests' }).click();

    const card = page.locator('.admin-card--submission').filter({ hasText: requesterName }).first();
    await expect(card).toBeVisible({ timeout: 30000 });
    await expect(card).toContainText(requestMessage);
    await card.getByRole('button', { name: 'Mark handled' }).click();
    await expect(card).toBeHidden({ timeout: 30000 });

    await assertNoBrowserErrors();
  });
});
