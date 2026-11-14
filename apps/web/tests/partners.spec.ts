import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow, gotoAndWait } from './test-helpers';

test.describe('partners page', () => {
  test('invites partners and is linked from the footer and Get Involved', async ({ page }) => {
    await gotoAndWait(page, '/partners');

    await expect(page.getByRole('heading', { level: 1, name: 'Partner with us' })).toBeVisible();
    await expect(page.locator('main')).toContainText("We don't have any partners yet.");
    await expect(page.getByRole('heading', { level: 3, name: 'Extension and Master Gardener programs' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Ways to sponsor' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'Bulk growing' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'Satellite sharing' })).toBeVisible();
    await expect(page.locator('footer').getByRole('link', { name: 'Partner with us' })).toBeVisible();

    await gotoAndWait(page, '/get-involved');
    await page.locator('main').getByRole('link', { name: 'Partner with us' }).click();
    await expect(page).toHaveURL(/\/partners$/);
  });

  test('sends a partnership inquiry through the contact endpoint', async ({ page }) => {
    let submitted: Record<string, unknown> | null = null;
    await page.route(/\/contact$/, async (route) => {
      submitted = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ status: 202, json: { ok: true } });
    });

    await gotoAndWait(page, '/partners');
    const submit = page.getByRole('button', { name: 'Start the conversation' });
    await expect(submit).toBeDisabled();

    await page.getByRole('textbox', { name: /^Organization/ }).fill('Example County Master Gardeners');
    await page.getByLabel('Your name').fill('Pat Gardener');
    await page.getByRole('textbox', { name: /^Email/ }).fill('pat@example.org');
    await page.getByLabel('What do you have in mind?').fill('We could hand out okra seeds at our spring plant sale.');
    await submit.click();

    await expect(page.getByText("Thank you. We'll read this closely")).toBeVisible();
    expect(submitted).toMatchObject({
      kind: 'general_inquiry',
      contactName: 'Pat Gardener',
      email: 'pat@example.org',
      referral: 'Partners page',
    });
    expect(String(submitted?.message)).toContain('Organization: Example County Master Gardeners');
    expect(String(submitted?.message)).toContain('Type: Extension or Master Gardener program');
  });
});

test.describe('partners page mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('stays readable without horizontal overflow', async ({ page }) => {
    await gotoAndWait(page, '/partners');
    await expect(page.getByRole('heading', { level: 1, name: 'Partner with us' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
