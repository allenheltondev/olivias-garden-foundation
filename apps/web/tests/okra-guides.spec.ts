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
  related?: string[];
  showInFooter?: boolean;
  sections?: Array<{ id: string }>;
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
      // Scope to the guides list: the same title can also appear as a footer link.
      const guideList = page.getByRole('region', { name: 'Okra growing guides' });
      await expect(guideList.getByRole('link', { name: new RegExp(guide.title) })).toHaveAttribute('href', path);
    });

    if (guide.showInFooter) {
      test(`${path} is linked from the footer and the link opens it`, async ({ page }) => {
        await gotoAndWait(page, '/');
        const footerLink = page.getByRole('contentinfo').getByRole('link', { name: guide.title, exact: true });
        await expect(footerLink).toHaveAttribute('href', path);
        await footerLink.click();
        await expect(page).toHaveURL(new RegExp(`${path}$`));
        await expect(page.getByRole('heading', { level: 1, name: guide.title })).toBeVisible();
      });
    }
  }
});

test('FAQ links to published okra guides open the guide', async ({ page }) => {
  await gotoAndWait(page, '/faq');
  const guidePaths = new Set(publishedGuides.map((guide) => `/okra/${guide.slug}`));
  const hrefs = await page.locator('main a[href^="/okra/"]').evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
  const linked = [...new Set(hrefs.filter((href) => guidePaths.has(href)))];
  test.skip(linked.length === 0, 'The FAQ does not link to a published okra guide yet.');

  for (const href of linked) {
    const guide = publishedGuides.find((candidate) => `/okra/${candidate.slug}` === href)!;
    await gotoAndWait(page, '/faq');
    await page.locator(`main a[href="${href}"]`).first().click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(page.getByRole('heading', { level: 1, name: guide.title })).toBeVisible();
  }
});

test.describe('okra guide client-side navigation', () => {
  test.skip(publishedGuides.length === 0, 'No published okra guides yet.');

  const readArticleHeadlines = (page: import('@playwright/test').Page) =>
    page.locator('script[data-seo-id="okra-guide-article"]').evaluateAll((scripts) =>
      scripts.map((script) => (JSON.parse(script.textContent ?? '{}') as { headline?: string }).headline));

  test('moving to another guide never shows the previous guide', async ({ page }) => {
    const from = publishedGuides.find((guide) =>
      guide.related?.some((slug) => publishedGuides.some((candidate) => candidate.slug === slug)));
    test.skip(!from, 'No published guide links to another published guide yet.');
    const to = publishedGuides.find((guide) => guide.slug === from!.related!.find((slug) =>
      publishedGuides.some((candidate) => candidate.slug === slug)))!;

    await gotoAndWait(page, `/okra/${from!.slug}`);
    await expect.poll(() => readArticleHeadlines(page)).toEqual([from!.seoTitle ?? from!.title]);

    // Record every DOM state during the navigation: B's heading must never
    // appear alongside A's body sections or A's Article JSON-LD, even for one render.
    const fromSectionIds = (from!.sections ?? [])
      .map((section) => section.id)
      .filter((id) => !(to.sections ?? []).some((section) => section.id === id));
    await page.evaluate(({ toTitle, fromHeadline, fromSectionIds }) => {
      const win = window as Window & { __staleGuideSeen?: string[] };
      win.__staleGuideSeen = [];
      const check = () => {
        if (document.querySelector('h1')?.textContent?.trim() !== toTitle) return;
        const staleSection = fromSectionIds.find((id) => document.getElementById(id));
        if (staleSection) win.__staleGuideSeen!.push(`section #${staleSection}`);
        const article = document.querySelector('script[data-seo-id="okra-guide-article"]');
        if (article && (JSON.parse(article.textContent ?? '{}') as { headline?: string }).headline === fromHeadline) {
          win.__staleGuideSeen!.push('article JSON-LD');
        }
      };
      new MutationObserver(check).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    }, { toTitle: to.title, fromHeadline: from!.seoTitle ?? from!.title, fromSectionIds });

    await page.getByRole('navigation', { name: 'Related okra guides' }).getByRole('link', { name: new RegExp(to.title) }).click();
    await expect(page).toHaveURL(new RegExp(`/okra/${to.slug}$`));
    await expect(page.getByRole('heading', { level: 1, name: to.title })).toBeVisible();
    await expect.poll(() => readArticleHeadlines(page)).toEqual([to.seoTitle ?? to.title]);
    expect(await page.evaluate(() => (window as Window & { __staleGuideSeen?: string[] }).__staleGuideSeen)).toEqual([]);
  });

  test('moving from a guide to an unknown slug clears its structured data', async ({ page }) => {
    await gotoAndWait(page, `/okra/${publishedGuides[0].slug}`);
    await expect(page.locator('script[data-seo-id="okra-guide-article"]')).toHaveCount(1);

    // Client-side navigation (BrowserRouter listens to popstate).
    await page.evaluate(() => {
      window.history.pushState({}, '', '/okra/not-a-real-guide');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    await expect(page.getByRole('heading', { level: 1, name: /page not found/i })).toBeVisible();
    await expect(page.locator('script[data-seo-id^="okra-guide-"]')).toHaveCount(0);
  });

  test('links to a section on another page scroll to that section', async ({ page }) => {
    let source: GuideFile | undefined;
    let href: string | undefined;
    for (const guide of publishedGuides) {
      await gotoAndWait(page, `/okra/${guide.slug}`);
      href = await page.locator('main a[href^="/"][href*="#"]').evaluateAll((links, currentPath) =>
        links
          .map((link) => link.getAttribute('href') ?? '')
          .find((value) => value.split('#')[0] !== currentPath && value.split('#')[1]), `/okra/${guide.slug}`);
      if (href) {
        source = guide;
        break;
      }
    }
    test.skip(!source || !href, 'No published guide links to a section on another page yet.');

    const [path, id] = href!.split('#');
    await page.locator(`main a[href="${href}"]`).first().click();
    await expect(page).toHaveURL(new RegExp(`${path}#${id}$`));
    // Scrolled to the section itself (allowing for the sticky header's scroll
    // margin), not merely somewhere on the page that happens to show it.
    await expect.poll(() => page.locator(`[id="${id}"]`).evaluate((element) => element.getBoundingClientRect().top))
      .toBeLessThan(160);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  });
});

test.describe('okra guides on mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test.skip(publishedGuides.length === 0, 'No published okra guides yet.');

  test('first guide stays readable without horizontal overflow', async ({ page }) => {
    await gotoAndWait(page, `/okra/${publishedGuides[0].slug}`);
    await expectNoHorizontalOverflow(page);
  });
});
