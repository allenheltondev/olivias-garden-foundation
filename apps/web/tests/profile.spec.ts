import { expect, test, type Page } from '@playwright/test';
import { gotoAndWait } from './test-helpers';

const CI_USERNAME = process.env.OGF_CI_USERNAME ?? process.env.OKRA_CI_ADMIN_USERNAME;
const CI_PASSWORD = process.env.OGF_CI_PASSWORD ?? process.env.OKRA_CI_ADMIN_PASSWORD;

async function loginThroughUi(page: Page) {
  await gotoAndWait(page, '/login');
  await page.getByLabel('Email').fill(CI_USERNAME ?? '');
  await page.getByLabel('Password').fill(CI_PASSWORD ?? '');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();

  // Auth success transitions the header to the signed-in state (avatar button visible).
  await expect(page.locator('.og-auth-utility__avatar')).toBeVisible({ timeout: 15000 });
}

test.describe('profile page auth guard', () => {
  test('redirects to /login when visiting /profile without a session', async ({ page }) => {
    await gotoAndWait(page, '/profile');
    await expect(page).toHaveURL(/\/login(?:$|\?|#)/);
  });
});

test.describe('profile page (signed in)', () => {
  // Runs against a deployed environment where VITE_AUTH_* env vars made it into the build
  // and CI credentials are available. Skipped locally unless the user exports them.
  test.skip(
    !CI_USERNAME || !CI_PASSWORD,
    'Signed-in profile tests require OGF_CI_USERNAME / OGF_CI_PASSWORD (or OKRA_CI_ADMIN_USERNAME / OKRA_CI_ADMIN_PASSWORD).',
  );

  test('opens the avatar menu and navigates to the profile page', async ({ page }) => {
    await loginThroughUi(page);

    await page.locator('.og-auth-utility__avatar').click();
    await page.getByRole('menuitem', { name: 'Profile' }).click();

    await expect(page).toHaveURL(/\/profile$/);
    await expect(page.getByRole('heading', { name: /^Welcome, /i })).toBeVisible();
    await expect(page.getByLabel('Bio')).toBeVisible();
  });

  test('saves profile edits and persists them across reload', async ({ page }) => {
    await loginThroughUi(page);

    await gotoAndWait(page, '/profile');

    const uniqueBio = `E2E bio ${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const bioField = page.getByLabel('Bio');

    await expect(bioField).toBeVisible();
    await bioField.fill(uniqueBio);
    await page.getByRole('button', { name: 'Save profile' }).click();

    await expect(page.getByText('Profile saved.')).toBeVisible({ timeout: 10000 });
    await expect(bioField).toHaveValue(uniqueBio);

    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByLabel('Bio')).toHaveValue(uniqueBio);
  });

  test('redirects back to /login after logging out via the avatar menu', async ({ page }) => {
    await loginThroughUi(page);

    await page.locator('.og-auth-utility__avatar').click();
    await page.getByRole('menuitem', { name: 'Log out' }).click();

    await page.goto('/profile');
    await expect(page).toHaveURL(/\/login(?:$|\?|#)/);
  });
});
