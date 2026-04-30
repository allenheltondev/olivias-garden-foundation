import { expect, test } from '@playwright/test';
import { gotoAndWait } from './test-helpers';

type DataLayerEntry = unknown[];

test.describe('analytics consent mode', () => {
  test('default consent is denied before any GA config call, and no GA cookies are written', async ({ page, context }) => {
    await context.clearCookies();
    await gotoAndWait(page, '/');

    const dataLayer = (await page.evaluate(() => {
      const layer = (window as unknown as { dataLayer?: DataLayerEntry[] }).dataLayer;
      return layer ? layer.map((entry) => Array.from(entry)) : [];
    })) as DataLayerEntry[];

    const firstConsentDefaultIndex = dataLayer.findIndex(
      (entry) => entry[0] === 'consent' && entry[1] === 'default',
    );
    expect(firstConsentDefaultIndex, 'gtag("consent", "default", ...) must be in dataLayer').toBeGreaterThanOrEqual(0);

    const firstGaConfigIndex = dataLayer.findIndex(
      (entry) => entry[0] === 'config' && typeof entry[1] === 'string' && entry[1].startsWith('G-'),
    );
    if (firstGaConfigIndex >= 0) {
      expect(firstConsentDefaultIndex).toBeLessThan(firstGaConfigIndex);
    }

    const consentParams = dataLayer[firstConsentDefaultIndex]?.[2] as Record<string, string> | undefined;
    expect(consentParams).toBeTruthy();
    expect(consentParams?.analytics_storage).toBe('denied');
    expect(consentParams?.ad_storage).toBe('denied');
    expect(consentParams?.ad_user_data).toBe('denied');
    expect(consentParams?.ad_personalization).toBe('denied');

    const cookies = await context.cookies();
    const gaCookies = cookies.filter((cookie) => cookie.name === '_ga' || cookie.name.startsWith('_ga_'));
    expect(gaCookies, `Unexpected GA cookies set: ${gaCookies.map((c) => c.name).join(', ')}`).toEqual([]);
  });
});
