import { expect, test } from '@playwright/test';
import { gotoAndWait } from './test-helpers';

test.describe('login page', () => {
  test('renders the configured auth entry points', async ({ page }) => {
    await gotoAndWait(page, '/login');

    const unavailableHeading = page.getByRole('heading', { name: 'Login unavailable.' });
    if (await unavailableHeading.count()) {
      await expect(unavailableHeading).toBeVisible();
      await expect(page.getByText('Login is not configured for this environment yet.')).toBeVisible();
      return;
    }

    await expect(page.getByRole('tab', { name: 'Log in' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Sign up' })).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();

    const googleButton = page.getByRole('button', { name: 'Continue with Google' });
    if (await googleButton.count()) {
      await expect(googleButton).toBeVisible();
      await expect(page.getByText('Or sign in with')).toBeVisible();
    }
  });
});
