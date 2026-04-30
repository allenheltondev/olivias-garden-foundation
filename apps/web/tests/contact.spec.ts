import { expect, test } from '@playwright/test';
import { gotoAndWait } from './test-helpers';

test('contact form enforces required input and shows success feedback', async ({ page }) => {
  await gotoAndWait(page, '/contact');
  await page.route('**/contact', async (route) => {
    await route.fulfill({ status: 204, body: '' });
  });

  const submitButton = page.getByRole('button', { name: 'Send message' });
  await expect(submitButton).toBeDisabled();

  await page.getByLabel('Name').fill('Playwright Volunteer');
  await page.getByLabel('Email').fill('volunteer@example.com');
  await page.getByLabel('Message').fill('I would like to help with volunteer work days.');
  await page.getByLabel(/How did you hear about us/i).fill('Stage UI tests');

  await submitButton.click();
  await expect(page.getByRole('status')).toContainText(/your message was sent/i);
});
