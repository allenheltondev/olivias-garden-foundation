import { expect, test } from '@playwright/test';
import { gotoAndWait } from './test-helpers';

const FOUNDATION_EIN = '33-3101032';

test.describe('foundation disclosures', () => {
  test('footer lists nonprofit status, EIN, and tax-deductible language', async ({ page }) => {
    await gotoAndWait(page, '/');

    const footer = page.locator('footer');
    await expect(footer).toContainText(
      `Olivia's Garden Foundation is a 501(c)(3) nonprofit organization, EIN ${FOUNDATION_EIN}.`,
    );
    await expect(footer).toContainText('Donations are tax-deductible.');
    await expect(footer).toContainText("©2026 Olivia's Garden Foundation. All rights reserved.");
  });

  test('donate page surfaces the EIN and tax-deductible language near the gift action', async ({ page }) => {
    await gotoAndWait(page, '/donate');

    const donateForm = page.locator('.donate-form-card');
    await expect(donateForm).toContainText('501(c)(3)');
    await expect(donateForm).toContainText(`EIN ${FOUNDATION_EIN}`);
    await expect(donateForm).toContainText('tax-deductible');
    await expect(donateForm.getByRole('button', { name: 'Make donation' })).toBeVisible();
  });

  test('contact page lists the legal name and EIN with direct contact details', async ({ page }) => {
    await gotoAndWait(page, '/contact');

    const contactCard = page.locator('.contact-card').filter({ hasText: 'Reach us directly' });
    await expect(contactCard).toContainText("Legal name: Olivia's Garden Foundation");
    await expect(contactCard).toContainText(`EIN: ${FOUNDATION_EIN}`);
    await expect(contactCard.getByRole('link', { name: 'allen@oliviasgarden.org' })).toBeVisible();
  });
});
