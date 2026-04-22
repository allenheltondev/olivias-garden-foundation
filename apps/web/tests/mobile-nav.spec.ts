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

  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
  await page.getByRole('link', { name: 'Okra Project' }).click();

  await expect(page).toHaveURL(/\/okra$/);
  await expect(page.getByRole('heading', { level: 1, name: /the okra project/i })).toBeVisible();

  await expectNoHorizontalOverflow(page);
});
