import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow, gotoAndWait } from './test-helpers';

test.use({
  viewport: { width: 390, height: 844 },
});

test('mobile navigation opens, routes, and keeps layout intact', async ({ page }) => {
  await gotoAndWait(page, '/');

  const menuButton = page.getByRole('button', { name: /open navigation menu/i });
  await expect(menuButton).toBeVisible();
  await menuButton.click();

  const primaryNav = page.getByRole('navigation', { name: 'Primary' });
  await expect(primaryNav).toBeVisible();
  await primaryNav.getByRole('link', { name: 'Okra Project' }).click();

  await expect(page).toHaveURL(/\/okra$/);
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: /these seeds came from olivia's garden\. now they're growing everywhere\./i,
    }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /request free seeds/i }).first()).toBeVisible();

  await expectNoHorizontalOverflow(page);
});
