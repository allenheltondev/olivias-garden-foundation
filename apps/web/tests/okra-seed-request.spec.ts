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

    await dialog.getByLabel('Name', { exact: true }).fill(`Playwright Seed Request ${runId}`);
    await dialog.getByLabel('Email', { exact: true }).fill(`playwright-seeds-${runId}@example.com`);
    await dialog.getByLabel('Street address', { exact: true }).fill('123 Garden Row');
    await dialog.getByLabel('City', { exact: true }).fill('McKinney');
    await dialog.getByLabel('State / province', { exact: true }).fill('TX');
    await dialog.getByLabel('Postal code', { exact: true }).fill('75069');
    await dialog.getByLabel('Country').selectOption('US');

    // The public map pin is opt-in: it must start unchecked and say exactly
    // what would be shown. This run leaves it off so staging gets no pin.
    const mapConsent = dialog.getByRole('checkbox', { name: /seeds sent.*pin to the public okra map/i });
    await expect(mapConsent).not.toBeChecked();
    await expect(dialog).toContainText('only your first name, your city, and the month');
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
