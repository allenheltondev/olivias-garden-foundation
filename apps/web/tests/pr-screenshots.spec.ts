import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from '@playwright/test';
import { gotoAndWait } from './test-helpers';

function screenshotPath(filename: string) {
  const baseDir = process.env.PLAYWRIGHT_PR_SCREENSHOT_DIR ?? 'test-results/pr-screenshots';
  const outputPath = join(baseDir, filename);
  mkdirSync(dirname(outputPath), { recursive: true });
  return outputPath;
}

test.describe('PR screenshots', () => {
  test.skip(process.env.PLAYWRIGHT_CAPTURE_PR_SCREENSHOTS !== 'true', 'PR screenshot capture is only enabled in CI.');

  test('capture homepage desktop screenshot', async ({ page }) => {
    await gotoAndWait(page, '/');
    await page.screenshot({
      path: screenshotPath('homepage-desktop.png'),
      fullPage: true,
    });
  });

  test('capture donate desktop screenshot', async ({ page }) => {
    await gotoAndWait(page, '/donate');
    await page.screenshot({
      path: screenshotPath('donate-desktop.png'),
      fullPage: true,
    });
  });

  test('capture good-roots desktop screenshot', async ({ page }) => {
    await gotoAndWait(page, '/good-roots');
    await page.screenshot({
      path: screenshotPath('good-roots-desktop.png'),
      fullPage: true,
    });
  });
});

test.describe('PR screenshots mobile', () => {
  test.skip(process.env.PLAYWRIGHT_CAPTURE_PR_SCREENSHOTS !== 'true', 'PR screenshot capture is only enabled in CI.');
  test.use({ viewport: { width: 390, height: 844 } });

  test('capture homepage mobile screenshot', async ({ page }) => {
    await gotoAndWait(page, '/');
    await page.screenshot({
      path: screenshotPath('homepage-mobile.png'),
      fullPage: true,
    });
  });

  test('capture good-roots mobile screenshot', async ({ page }) => {
    await gotoAndWait(page, '/good-roots');
    await page.screenshot({
      path: screenshotPath('good-roots-mobile.png'),
      fullPage: true,
    });
  });
});
