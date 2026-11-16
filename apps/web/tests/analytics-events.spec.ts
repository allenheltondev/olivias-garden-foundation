import { expect, test, type Page } from '@playwright/test';
import { gotoAndWait } from './test-helpers';

type DataLayerEntry = unknown[];

async function gaEvents(page: Page, eventName: string) {
  const entries = (await page.evaluate(() => {
    const layer = (window as unknown as { dataLayer?: DataLayerEntry[] }).dataLayer ?? [];
    return layer.map((entry) => Array.from(entry as ArrayLike<unknown>));
  })) as DataLayerEntry[];
  return entries
    .filter((entry) => entry[0] === 'event' && entry[1] === eventName)
    .map((entry) => (entry[2] ?? {}) as Record<string, unknown>);
}

test.describe('analytics key events', () => {
  test('newsletter signup sends newsletter_signup with its source and no email', async ({ page }) => {
    await page.route(/\/newsletter$/, (route) => route.fulfill({ status: 200, json: { ok: true } }));
    await gotoAndWait(page, '/');

    await page.getByLabel('Email address').fill('reader@example.com');
    await page.getByRole('button', { name: 'Keep me posted' }).click();

    await expect.poll(async () => (await gaEvents(page, 'newsletter_signup')).length).toBe(1);
    const [params] = await gaEvents(page, 'newsletter_signup');
    expect(params).toEqual({ source: 'home' });
  });

  test('seed request success sends seed_request_submitted without personal data', async ({ page }) => {
    await page.route(/\/requests$/, (route) => (
      route.request().method() === 'POST'
        ? route.fulfill({ status: 201, json: { id: 'req-1' } })
        : route.continue()
    ));
    await gotoAndWait(page, '/okra');

    await page.getByRole('button', { name: 'Request free seeds' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Request free okra seeds' });
    await dialog.getByLabel('Name', { exact: true }).fill('Analytics Test');
    await dialog.getByLabel('Email', { exact: true }).fill('analytics@example.com');
    await dialog.getByLabel('Street address', { exact: true }).fill('123 Garden Row');
    await dialog.getByLabel('City', { exact: true }).fill('McKinney');
    await dialog.getByLabel('State / province', { exact: true }).fill('TX');
    await dialog.getByLabel('Postal code', { exact: true }).fill('75069');
    await dialog.getByLabel('Country').selectOption('US');
    await dialog.getByRole('button', { name: 'Send my request' }).click();

    await expect(dialog.getByRole('status')).toContainText('Request received');
    const events = await gaEvents(page, 'seed_request_submitted');
    expect(events).toEqual([{ fulfillment_method: 'mail', country: 'US' }]);
  });

  test.describe('donation completion', () => {
    const sessionId = 'cs_test_analytics';

    async function mockSessionStatus(page: Page, paymentStatus: string) {
      await page.route(/\/donations\/checkout-session-status/, (route) => route.fulfill({
        status: 200,
        json: { sessionId, status: 'complete', paymentStatus, customerEmail: null },
      }));
    }

    test.beforeEach(async ({ context }) => {
      await context.addInitScript((id) => {
        const key = `ogf:pending-donation:${id}`;
        if (!window.localStorage.getItem(key)) {
          window.localStorage.setItem(key, JSON.stringify({ mode: 'recurring', amountCents: 2500, savedAt: Date.now() }));
        }
      }, sessionId);
    });

    test('a paid session sends donation_completed once, even after a refresh', async ({ page }) => {
      await mockSessionStatus(page, 'paid');

      await gotoAndWait(page, `/donate?session_id=${sessionId}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByText('Your gift is in.')).toBeVisible();
      expect(await gaEvents(page, 'donation_completed')).toEqual([
        { donation_type: 'recurring', value: 25, currency: 'USD' },
      ]);

      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByText('Your gift is in.')).toBeVisible();
      expect(await gaEvents(page, 'donation_completed')).toEqual([]);
    });

    test('reopening the return URL in a second tab does not count the gift again', async ({ context, page }) => {
      await mockSessionStatus(page, 'paid');
      await gotoAndWait(page, `/donate?session_id=${sessionId}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByText('Your gift is in.')).toBeVisible();
      expect(await gaEvents(page, 'donation_completed')).toHaveLength(1);

      const secondTab = await context.newPage();
      await mockSessionStatus(secondTab, 'paid');
      await gotoAndWait(secondTab, `/donate?session_id=${sessionId}`, { waitUntil: 'domcontentloaded' });
      await expect(secondTab.getByText('Your gift is in.')).toBeVisible();
      expect(await gaEvents(secondTab, 'donation_completed')).toEqual([]);
    });

    test('a complete but unpaid session shows a processing message and does not count as a donation', async ({ page }) => {
      await mockSessionStatus(page, 'unpaid');

      await gotoAndWait(page, `/donate?session_id=${sessionId}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'Thank you. Your payment is still processing.' })).toBeVisible();
      await expect(page.getByText('Your gift is in.')).toHaveCount(0);
      expect(await gaEvents(page, 'donation_completed')).toEqual([]);
    });
  });

  test.describe('garden planner funnel', () => {
    // The planner origin this build sends new members to. CI passes the
    // deployed GRN URL; the fallback matches the app's production default.
    const plannerOrigin = new URL(
      process.env.PLAYWRIGHT_GRN_BASE_URL?.trim() || 'https://grn.oliviasgarden.org',
    ).origin;

    async function loginConfigured(page: Page) {
      await expect(page.locator('h1').first()).toBeVisible();
      return (await page.getByRole('heading', { name: 'Login unavailable.' }).count()) === 0;
    }

    function fakeJwt(claims: Record<string, unknown>) {
      const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
      return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(claims)}.signature`;
    }

    test('planner CTA reports its location and opens Sign up headed for the planner', async ({ page }) => {
      await gotoAndWait(page, '/good-roots');

      await page.getByRole('link', { name: 'Start planning for free' }).first().click();
      await page.waitForURL(/\/login\?/);

      const url = new URL(page.url());
      expect(url.searchParams.get('mode')).toBe('signup');
      expect(new URL(url.searchParams.get('redirect') ?? '').origin).toBe(plannerOrigin);
      expect(await gaEvents(page, 'planner_cta_click')).toEqual([{ location: 'hero', signed_in: false }]);

      if (await loginConfigured(page)) {
        await expect(page.getByRole('tab', { name: 'Sign up' })).toHaveAttribute('aria-selected', 'true');
        await expect(page.getByRole('heading', { name: 'Create your account.' })).toBeVisible();
      } else {
        // Only environments without Cognito config land here; staging must not.
        await expect(page.getByRole('heading', { name: 'Login unavailable.' })).toBeVisible();
      }
    });

    test('email signup and verification sign the new member straight into the planner', async ({ page }) => {
      const email = 'planner-funnel@example.com';
      const password = 'Garden!2026x';
      const idToken = fakeJwt({ sub: 'user-123', email, given_name: 'Pat', family_name: 'Planter' });
      const cognitoCalls: { target: string; body: Record<string, unknown> }[] = [];

      await page.route(/https:\/\/cognito-idp\.[a-z0-9-]+\.amazonaws\.com\/?$/, async (route) => {
        const target = (route.request().headers()['x-amz-target'] ?? '').split('.').pop() ?? '';
        const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
        cognitoCalls.push({ target, body });
        const json: Record<string, unknown> = target === 'SignUp'
          ? { UserConfirmed: false, UserSub: 'user-123' }
          : target === 'InitiateAuth'
            ? { AuthenticationResult: { AccessToken: fakeJwt({ sub: 'user-123' }), IdToken: idToken, RefreshToken: 'refresh-token', ExpiresIn: 3600 } }
            : {};
        await route.fulfill({ status: 200, contentType: 'application/x-amz-json-1.1', body: JSON.stringify(json) });
      });
      await page.route(`${plannerOrigin}/**`, (route) => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><title>Planner</title><h1>Planner</h1>',
      }));

      await gotoAndWait(page, '/good-roots');
      await page.getByRole('link', { name: 'Start planning for free' }).first().click();
      await page.waitForURL(/\/login\?/);
      test.skip(!(await loginConfigured(page)), 'Login is not configured for this environment.');

      await page.getByLabel('First name').fill('Pat');
      await page.getByLabel('Last name').fill('Planter');
      await page.getByLabel('Email', { exact: true }).fill(email);
      await page.getByLabel('New password').fill(password);
      await page.getByLabel('Confirm password').fill(password);
      await page.getByRole('button', { name: 'Sign up', exact: true }).click();

      await expect(page.getByRole('heading', { name: 'Verify your email.' })).toBeVisible();
      expect(await gaEvents(page, 'sign_up')).toEqual([{ method: 'email', destination: 'planner' }]);

      for (const [index, digit] of [...'123456'].entries()) {
        await page.getByLabel(`Verification code character ${index + 1}`).fill(digit);
      }
      await page.getByRole('button', { name: 'Verify email' }).click();

      await page.waitForURL((target) => target.origin === plannerOrigin);
      const landed = new URL(page.url());
      expect(landed.hash.startsWith('#session=')).toBe(true);
      const handedOff = JSON.parse(Buffer.from(landed.hash.slice('#session='.length), 'base64').toString()) as {
        idToken: string;
      };
      expect(handedOff.idToken).toBe(idToken);

      expect(cognitoCalls.map((call) => call.target)).toEqual(['SignUp', 'ConfirmSignUp', 'InitiateAuth']);
      expect(cognitoCalls[2].body).toMatchObject({
        AuthFlow: 'USER_PASSWORD_AUTH',
        AuthParameters: { USERNAME: email, PASSWORD: password },
      });
    });

    test('homepage planner card reports a promo click', async ({ page }) => {
      await gotoAndWait(page, '/');

      await page.getByRole('link', { name: 'Try the planner' }).click();
      await page.waitForURL(/\/good-roots$/);
      expect(await gaEvents(page, 'planner_promo_click')).toEqual([{ location: 'home' }]);
    });
  });
});
