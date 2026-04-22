import { expect, test } from '@playwright/test';
import { gotoAndWait, trackBrowserErrors } from './test-helpers';

test.describe('okra seed request flow (staging)', () => {
  test('opens the modal, submits a real seed request, and shows success', async ({ page, baseURL }) => {
    expect(baseURL).toBeTruthy();

    const assertNoBrowserErrors = trackBrowserErrors(page);
    const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

    await gotoAndWait(page, '/okra');

    await page.getByRole('button', { name: 'Request free seeds' }).first().click();

    const dialog = page.getByRole('dialog', { name: 'Request free okra seeds' });
    await expect(dialog).toBeVisible();

    const submitButton = dialog.getByRole('button', { name: 'Send my request' });
    await expect(submitButton).toBeDisabled();

    await dialog.getByLabel('Name').fill(`Playwright Seed Request ${runId}`);
    await dialog.getByLabel('Email').fill(`playwright-seeds-${runId}@example.com`);
    await dialog.getByLabel('Street address').fill('123 Garden Row');
    await dialog.getByLabel('City').fill('McKinney');
    await dialog.getByLabel('State / province').fill('TX');
    await dialog.getByLabel('Postal code').fill('75069');
    await dialog.getByLabel('Country').selectOption('US');
    await dialog
      .getByLabel('Message')
      .fill(`Please send seeds for the staging Playwright run ${runId}.`);

    await expect(submitButton).toBeEnabled();
    await submitButton.click();

    await expect(dialog.getByRole('status')).toContainText(
      "Request received. We'll be in touch by email soon.",
      { timeout: 30000 },
    );

    await assertNoBrowserErrors();
  });
});
