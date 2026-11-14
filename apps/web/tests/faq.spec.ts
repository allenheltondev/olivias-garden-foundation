import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow, gotoAndWait } from './test-helpers';

test.describe('faq page', () => {
  test('lists seed, growing, and donation answers and is linked in the footer', async ({ page }) => {
    await gotoAndWait(page, '/faq');

    await expect(page.getByRole('heading', { level: 1, name: 'Frequently asked questions' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'What do I get when I request seeds?' })).toBeVisible();
    await expect(page.locator('main')).toContainText('a single packet of 10 Clemson Spineless okra seeds');
    await expect(page.locator('main')).toContainText('Plant them directly in the soil');
    await expect(page.locator('main')).toContainText('EIN 33-3101032');

    await expect(page.locator('footer').getByRole('link', { name: 'FAQ' })).toBeVisible();
  });

  test('publishes FAQPage structured data', async ({ page }) => {
    await gotoAndWait(page, '/faq');

    const faqJsonLd = await page.locator('script[type="application/ld+json"][data-seo-id="faq"]').first().textContent();
    const data = JSON.parse(faqJsonLd ?? '{}') as { '@type'?: string; mainEntity?: unknown[] };
    expect(data['@type']).toBe('FAQPage');
    expect(data.mainEntity?.length).toBeGreaterThan(0);
  });

  test('topic links jump to their section', async ({ page }) => {
    await gotoAndWait(page, '/faq');

    await page.getByRole('navigation', { name: 'FAQ topics' }).getByRole('link', { name: 'Growing your okra' }).click();
    await expect(page).toHaveURL(/#growing-okra$/);
    await expect(page.getByRole('heading', { level: 2, name: 'Growing your okra' })).toBeInViewport();
  });
});

test.describe('faq page mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('stays readable without horizontal overflow', async ({ page }) => {
    await gotoAndWait(page, '/faq');
    await expect(page.getByRole('heading', { level: 1, name: 'Frequently asked questions' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
