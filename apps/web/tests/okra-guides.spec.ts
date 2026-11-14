import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow, gotoAndWait, readMetaContent } from './test-helpers';

type GuideFile = {
  slug: string;
  status: 'draft' | 'published';
  title: string;
  seoTitle?: string;
  socialImage?: { src: string };
  faq?: unknown[];
};

// Every published guide in the content folder is checked, so new guides get
// coverage without new test code. OKRA_GUIDES_CONTENT_DIR matches the build
// override (point both at scripts/__fixtures__/okra-guides to test locally).
const contentDir = process.env.OKRA_GUIDES_CONTENT_DIR
  ?? fileURLToPath(new URL('../src/site/okra-guides/content', import.meta.url));
const publishedGuides: GuideFile[] = (() => {
  try {
    return readdirSync(contentDir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(readFileSync(join(contentDir, name), 'utf8')) as GuideFile)
      .filter((guide) => guide.status === 'published');
  } catch {
    return [];
  }
})();

test('unknown okra guide slugs render a noindex 404', async ({ page }) => {
  await gotoAndWait(page, '/okra/not-a-real-guide');
  await expect(page.getByRole('heading', { level: 1, name: /page not found/i })).toBeVisible();
  expect(await readMetaContent(page, 'meta[name="robots"]')).toContain('noindex');
});

test.describe('published okra guides', () => {
  test.skip(publishedGuides.length === 0, 'No published okra guides yet.');

  for (const guide of publishedGuides) {
    const path = `/okra/${guide.slug}`;

    test(`${path} serves prerendered SEO tags and structured data`, async ({ request }) => {
      const response = await request.get(path);
      expect(response.ok()).toBeTruthy();
      const html = await response.text();

      expect(html).toContain(`<link rel="canonical" href="https://oliviasgarden.org${path}" />`);
      expect(html).toContain('<meta property="og:type" content="article" />');
      expect(html).toContain(`content="https://oliviasgarden.org${guide.socialImage?.src}"`);
      expect(html).toContain('data-seo-id="okra-guide-article"');
      expect(html).toContain('data-seo-id="okra-guide-breadcrumbs"');
      expect(html).toContain('<noscript data-seo-fallback="true">');
      expect(html).toMatch(/<meta name="robots" content="index, follow/);
    });

    test(`${path} renders the guide and opens the seed request`, async ({ page }) => {
      await gotoAndWait(page, path);

      await expect(page).toHaveTitle(new RegExp(`^${(guide.seoTitle ?? guide.title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
      await expect(page.getByRole('heading', { level: 1, name: guide.title })).toBeVisible();
      expect(await readMetaContent(page, 'meta[property="og:image"]')).toContain(guide.socialImage?.src ?? '');
      expect(await readMetaContent(page, 'meta[property="og:image:alt"]')).toBeTruthy();
      if (guide.faq?.length) {
        await expect(page.locator('script[data-seo-id="okra-guide-faq"]')).toHaveCount(1);
      }

      await page.getByRole('button', { name: 'Request free seeds' }).first().click();
      await expect(page.getByRole('dialog')).toBeVisible();
    });

    test(`${path} is listed on the Okra Project page`, async ({ page }) => {
      await gotoAndWait(page, '/okra');
      await expect(page.getByRole('link', { name: new RegExp(guide.title) })).toHaveAttribute('href', path);
    });
  }
});

test.describe('okra guides on mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test.skip(publishedGuides.length === 0, 'No published okra guides yet.');

  test('first guide stays readable without horizontal overflow', async ({ page }) => {
    await gotoAndWait(page, `/okra/${publishedGuides[0].slug}`);
    await expectNoHorizontalOverflow(page);
  });
});
