import { expect, test } from '@playwright/test';
import { gotoAndWait } from './test-helpers';

test.describe('visual regression', () => {
  test.skip(process.env.PLAYWRIGHT_ENABLE_VISUAL_REGRESSION !== 'true', 'Visual baselines are gated until snapshots are approved.');

  test('homepage desktop screenshot', async ({ page }) => {
    await gotoAndWait(page, '/');
    await expect(page).toHaveScreenshot('homepage-desktop.png', { fullPage: true });
  });

  test('donate page desktop screenshot', async ({ page }) => {
    await gotoAndWait(page, '/donate');
    await expect(page).toHaveScreenshot('donate-desktop.png', { fullPage: true });
  });
});

test.describe('visual regression mobile', () => {
  test.skip(process.env.PLAYWRIGHT_ENABLE_VISUAL_REGRESSION !== 'true', 'Visual baselines are gated until snapshots are approved.');
  test.use({ viewport: { width: 390, height: 844 } });

  test('homepage mobile screenshot', async ({ page }) => {
    await gotoAndWait(page, '/');
    await expect(page).toHaveScreenshot('homepage-mobile.png', { fullPage: true });
  });
});
