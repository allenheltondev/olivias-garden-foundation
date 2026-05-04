import crypto from 'node:crypto';
import { createHttpClient } from './integration/http-client.mjs';
import { createReporter } from './integration/reporter.mjs';

// --- Environment variable validation ---

const REQUIRED_ENV_VARS = ['WEB_API_BASE_URL'];

function validateEnv() {
  const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(`Missing required environment variable(s): ${missing.join(', ')}`);
    console.error('All of the following must be set:');
    for (const name of REQUIRED_ENV_VARS) {
      console.error(`  ${name}=${process.env[name] ? '✓ set' : '✗ MISSING'}`);
    }
    console.error('\nOptional:');
    console.error(`  WEB_API_USER_TOKEN=${process.env.WEB_API_USER_TOKEN ? '✓ set' : 'unset (auth-gated scenarios are skipped)'}`);
    console.error(`  WEB_API_TEST_WORKSHOP_ID=${process.env.WEB_API_TEST_WORKSHOP_ID ? '✓ set' : 'unset (free signup mutation scenarios are skipped)'}`);
    console.error(`  WEB_API_TEST_WORKSHOP_SLUG=${process.env.WEB_API_TEST_WORKSHOP_SLUG ? '✓ set' : 'unset (workshop-by-slug fetch is skipped)'}`);
    console.error(`  WEB_API_TEST_PAID_WORKSHOP_ID=${process.env.WEB_API_TEST_PAID_WORKSHOP_ID ? '✓ set' : 'unset (paid signup checkout scenarios are skipped)'}`);
    console.error(`  WEB_API_TEST_PAID_RETURN_URL=${process.env.WEB_API_TEST_PAID_RETURN_URL ? '✓ set' : 'unset (defaults to http://localhost:4173/workshops/test)'}`);
    process.exit(1);
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const WORKSHOP_FIELDS = [
  'id', 'slug', 'title', 'short_description', 'description', 'status',
  'workshop_date', 'location', 'capacity', 'seats_remaining', 'image_url',
  'is_paid', 'price_cents', 'currency', 'interested_count', 'my_signup'
];

function missingFields(item, fields) {
  return fields.filter((f) => !(f in item));
}

async function run() {
  validateEnv();

  const runPrefix = `ci-${crypto.randomUUID().slice(0, 8)}`;
  console.log(`\nRun_Prefix: ${runPrefix}\n`);

  const baseUrl = process.env.WEB_API_BASE_URL;
  const userToken = process.env.WEB_API_USER_TOKEN;
  const testWorkshopId = process.env.WEB_API_TEST_WORKSHOP_ID;
  const testWorkshopSlug = process.env.WEB_API_TEST_WORKSHOP_SLUG;

  const anonymous = createHttpClient(baseUrl);
  const badTokenApi = createHttpClient(baseUrl, {
    Authorization: 'Bearer invalid-token-value'
  });
  const userApi = userToken
    ? createHttpClient(baseUrl, { Authorization: `Bearer ${userToken}` })
    : null;

  const reporter = createReporter(runPrefix);

  // --- Public Workshop Listing (anonymous) ---
  // GET /workshops is public — no Authorization header required. The
  // response shape must include the public fields and exclude any admin-only
  // ones (signup_counts is admin-side, never present here).
  console.log('\n=== Public Workshops Listing (anonymous) ===');
  try {
    const res = await anonymous.request('/workshops');
    reporter.assert('public-workshops', res.status === 200, `GET /workshops returns 200 (got ${res.status})`, res.json);
    reporter.assert('public-workshops', Array.isArray(res.json?.items), 'GET /workshops has items array', res.json);

    if (Array.isArray(res.json?.items) && res.json.items.length > 0) {
      const item = res.json.items[0];
      const missing = missingFields(item, WORKSHOP_FIELDS);
      reporter.assert('public-workshops', missing.length === 0,
        missing.length === 0 ? 'first workshop has all expected public fields' : `first workshop is missing fields: ${missing.join(', ')}`,
        item);
      reporter.assert('public-workshops', !('signup_counts' in item), 'public response does not leak admin signup_counts', item);
      reporter.assert('public-workshops', item.status !== 'past', `public listing excludes past workshops (got ${item.status})`, item);
      reporter.assert('public-workshops', item.my_signup === null, 'anonymous response has my_signup=null', item);
    } else {
      reporter.skip('public-workshops', 'no workshops available for shape checks');
    }
  } catch (err) {
    reporter.fail('public-workshops', `Public workshops listing error: ${err.message}`);
  }

  // --- Workshop By Slug (anonymous) ---
  console.log('\n=== Public Workshop By Slug ===');
  if (!testWorkshopSlug) {
    reporter.skip('public-workshop-detail', 'WEB_API_TEST_WORKSHOP_SLUG is not set');
  } else {
    try {
      const res = await anonymous.request(`/workshops/${encodeURIComponent(testWorkshopSlug)}`);
      reporter.assert('public-workshop-detail', res.status === 200, `GET /workshops/:slug returns 200 (got ${res.status})`, res.json);
      reporter.assert('public-workshop-detail', res.json?.slug === testWorkshopSlug, `slug matches (got ${res.json?.slug})`, res.json);
      reporter.assert('public-workshop-detail', UUID_PATTERN.test(res.json?.id ?? ''), 'workshop id is a UUID', res.json);
    } catch (err) {
      reporter.fail('public-workshop-detail', `Public workshop detail error: ${err.message}`);
    }
  }

  console.log('\n=== Public Workshop By Slug — Validation ===');
  try {
    const unknownRes = await anonymous.request('/workshops/this-workshop-does-not-exist-9876');
    reporter.assert('public-workshop-detail-validation', unknownRes.status === 404, `unknown slug returns 404 (got ${unknownRes.status})`, unknownRes.json);

    const badRes = await anonymous.request('/workshops/NOT_KEBAB');
    reporter.assert('public-workshop-detail-validation', badRes.status === 400, `non-kebab slug returns 400 (got ${badRes.status})`, badRes.json);
  } catch (err) {
    reporter.fail('public-workshop-detail-validation', `Workshop slug validation error: ${err.message}`);
  }

  // --- Auth Boundary on Signup Routes ---
  console.log('\n=== Workshop Signup Auth Boundary ===');
  {
    const dummyId = '00000000-0000-4000-8000-000000000000';
    {
      const res = await anonymous.request(`/workshops/${dummyId}/signup`, { method: 'POST' });
      reporter.assert('signup-auth', res.status === 401, `POST /workshops/:id/signup without auth returns 401 (got ${res.status})`, res.json);
    }
    {
      const res = await anonymous.request(`/workshops/${dummyId}/signup`, { method: 'DELETE' });
      reporter.assert('signup-auth', res.status === 401, `DELETE /workshops/:id/signup without auth returns 401 (got ${res.status})`, res.json);
    }
    {
      const res = await anonymous.request('/workshops/me/signups');
      reporter.assert('signup-auth', res.status === 401, `GET /workshops/me/signups without auth returns 401 (got ${res.status})`, res.json);
    }
    {
      const res = await badTokenApi.request(`/workshops/${dummyId}/signup`, { method: 'POST' });
      reporter.assert('signup-auth', res.status === 401, `POST /workshops/:id/signup with invalid token returns 401 (got ${res.status})`, res.json);
    }
  }

  // --- Auth Boundary Validation: bad UUID with auth ---
  console.log('\n=== Workshop Signup UUID Validation ===');
  if (!userApi) {
    reporter.skip('signup-validation', 'WEB_API_USER_TOKEN is not set');
  } else {
    try {
      const res = await userApi.request('/workshops/not-a-uuid/signup', { method: 'POST' });
      reporter.assert('signup-validation', res.status === 400, `POST /workshops/not-a-uuid/signup returns 400 (got ${res.status})`, res.json);
    } catch (err) {
      reporter.fail('signup-validation', `Signup UUID validation error: ${err.message}`);
    }
  }

  // --- Authenticated user lifecycle: my signups list ---
  console.log('\n=== Authenticated /workshops/me/signups ===');
  if (!userApi) {
    reporter.skip('my-signups', 'WEB_API_USER_TOKEN is not set');
  } else {
    try {
      const res = await userApi.request('/workshops/me/signups');
      reporter.assert('my-signups', res.status === 200, `GET /workshops/me/signups returns 200 (got ${res.status})`, res.json);
      reporter.assert('my-signups', Array.isArray(res.json?.items), 'response has items array', res.json);
    } catch (err) {
      reporter.fail('my-signups', `My signups list error: ${err.message}`);
    }
  }

  // --- Signup happy path (mutation) ---
  // Requires both a user token and an existing workshop id. The script will
  // sign up, verify idempotency, then cancel — leaving state clean.
  console.log('\n=== Workshop Signup Lifecycle (mutation, opt-in) ===');
  if (!userApi || !testWorkshopId) {
    reporter.skip('signup-lifecycle', 'WEB_API_USER_TOKEN and WEB_API_TEST_WORKSHOP_ID are required');
  } else {
    try {
      // Best-effort cleanup before we start, in case a prior run crashed
      // mid-flight and left a signup in place.
      await userApi.request(`/workshops/${testWorkshopId}/signup`, { method: 'DELETE' });

      const firstRes = await userApi.request(`/workshops/${testWorkshopId}/signup`, { method: 'POST' });
      reporter.assert('signup-lifecycle', firstRes.status === 201, `first POST signup returns 201 (got ${firstRes.status})`, firstRes.json);
      reporter.assert('signup-lifecycle', firstRes.json?.already_signed_up === false, 'first POST returns already_signed_up=false', firstRes.json);
      const expectedKinds = ['interested', 'registered', 'waitlisted'];
      reporter.assert('signup-lifecycle', expectedKinds.includes(firstRes.json?.signup?.kind),
        `signup kind is one of ${expectedKinds.join(', ')} (got ${firstRes.json?.signup?.kind})`, firstRes.json);

      const secondRes = await userApi.request(`/workshops/${testWorkshopId}/signup`, { method: 'POST' });
      reporter.assert('signup-lifecycle', secondRes.status === 201, `second POST signup is idempotent and returns 201 (got ${secondRes.status})`, secondRes.json);
      reporter.assert('signup-lifecycle', secondRes.json?.already_signed_up === true, 'second POST returns already_signed_up=true', secondRes.json);
      reporter.assert('signup-lifecycle', secondRes.json?.signup?.id === firstRes.json?.signup?.id, 'second POST returns the original signup id', secondRes.json);

      const myRes = await userApi.request('/workshops/me/signups');
      reporter.assert('signup-lifecycle', myRes.status === 200, `GET /workshops/me/signups returns 200 (got ${myRes.status})`, myRes.json);
      const inList = Array.isArray(myRes.json?.items) && myRes.json.items.some((s) => s.workshop_id === testWorkshopId);
      reporter.assert('signup-lifecycle', inList, 'workshop appears in my-signups list', myRes.json);

      const deleteRes = await userApi.request(`/workshops/${testWorkshopId}/signup`, { method: 'DELETE' });
      reporter.assert('signup-lifecycle', deleteRes.status === 200, `DELETE signup returns 200 (got ${deleteRes.status})`, deleteRes.json);

      const deleteAgain = await userApi.request(`/workshops/${testWorkshopId}/signup`, { method: 'DELETE' });
      reporter.assert('signup-lifecycle', deleteAgain.status === 404, `DELETE signup again returns 404 (got ${deleteAgain.status})`, deleteAgain.json);
    } catch (err) {
      reporter.fail('signup-lifecycle', `Signup lifecycle error: ${err.message}`);
    }
  }

  // --- Paid workshop signup (mutation, opt-in) ---
  // Requires a paid workshop with status='open' and capacity available.
  // Verifies the server returns a Stripe Checkout URL instead of creating
  // a free 'registered' row, and that the row is recorded as 'pending'.
  // Tests do NOT actually complete the Stripe payment; that requires a
  // browser session. The cleanup DELETE drops the pending row so the next
  // run can re-issue.
  console.log('\n=== Paid Workshop Signup (mutation, opt-in) ===');
  const paidWorkshopId = process.env.WEB_API_TEST_PAID_WORKSHOP_ID;
  const paidReturnUrl = process.env.WEB_API_TEST_PAID_RETURN_URL ?? 'http://localhost:4173/workshops/test';
  if (!userApi || !paidWorkshopId) {
    reporter.skip('paid-signup', 'WEB_API_USER_TOKEN and WEB_API_TEST_PAID_WORKSHOP_ID are required');
  } else {
    try {
      // Drop any prior pending row from a crashed run so we don't get an
      // already_signed_up replay instead of a fresh checkout.
      await userApi.request(`/workshops/${paidWorkshopId}/signup`, { method: 'DELETE' });

      const res = await userApi.request(`/workshops/${paidWorkshopId}/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnUrl: paidReturnUrl })
      });
      reporter.assert('paid-signup', res.status === 201, `POST paid signup returns 201 (got ${res.status})`, res.json);
      reporter.assert('paid-signup', res.json?.checkout_required === true, `checkout_required=true (got ${res.json?.checkout_required})`, res.json);
      reporter.assert('paid-signup',
        typeof res.json?.checkout_url === 'string' && res.json.checkout_url.startsWith('https://checkout.stripe.com/'),
        `checkout_url is a Stripe URL (got ${res.json?.checkout_url})`, res.json);
      reporter.assert('paid-signup', res.json?.signup?.payment_status === 'pending', `signup row is pending (got ${res.json?.signup?.payment_status})`, res.json);
      reporter.assert('paid-signup', res.json?.signup?.kind === 'registered', `signup kind is registered (got ${res.json?.signup?.kind})`, res.json);

      // Idempotent re-POST should return the SAME checkout_url so the
      // user can resume payment instead of starting a fresh session.
      const resumeRes = await userApi.request(`/workshops/${paidWorkshopId}/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnUrl: paidReturnUrl })
      });
      reporter.assert('paid-signup', resumeRes.status === 201,
        `idempotent POST returns 201 (got ${resumeRes.status})`, resumeRes.json);
      reporter.assert('paid-signup', resumeRes.json?.already_signed_up === true,
        `idempotent POST returns already_signed_up=true (got ${resumeRes.json?.already_signed_up})`, resumeRes.json);
      reporter.assert('paid-signup',
        typeof resumeRes.json?.checkout_url === 'string'
          && resumeRes.json.checkout_url === res.json?.checkout_url,
        'idempotent POST returns the original checkout_url for resume', resumeRes.json);

      // /workshops/me/signups should include the resume URL and expose
      // the workshop slug; from there we can call the public detail
      // endpoint and verify it surfaces the same resume URL.
      const myRes = await userApi.request('/workshops/me/signups');
      const myItem = Array.isArray(myRes.json?.items)
        ? myRes.json.items.find((s) => s.workshop_id === paidWorkshopId)
        : null;
      reporter.assert('paid-signup', !!myItem,
        'paid signup appears in /workshops/me/signups', myRes.json);
      if (myItem) {
        reporter.assert('paid-signup',
          typeof myItem.checkout_url === 'string' && myItem.checkout_url === res.json?.checkout_url,
          'me/signups item exposes the resume checkout_url', myItem);
        reporter.assert('paid-signup',
          typeof myItem.expires_at === 'string',
          'me/signups item exposes expires_at on pending', myItem);
      }

      const workshopSlug = myItem?.workshop?.slug;
      if (workshopSlug) {
        const slugRes = await userApi.request(`/workshops/${encodeURIComponent(workshopSlug)}`);
        reporter.assert('paid-signup', slugRes.status === 200,
          `GET /workshops/:slug returns 200 (got ${slugRes.status})`, slugRes.json);
        reporter.assert('paid-signup',
          slugRes.json?.my_signup?.checkout_url === res.json?.checkout_url,
          'detail my_signup.checkout_url matches the active session', slugRes.json);
        reporter.assert('paid-signup',
          typeof slugRes.json?.my_signup?.expires_at === 'string',
          'detail my_signup.expires_at is set on a pending row', slugRes.json);
      } else {
        reporter.skip('paid-signup', 'no workshop slug found in me/signups; skipping detail check');
      }

      // Missing returnUrl on a paid signup → 400 (after we cancel the prior pending).
      await userApi.request(`/workshops/${paidWorkshopId}/signup`, { method: 'DELETE' });
      const noReturnRes = await userApi.request(`/workshops/${paidWorkshopId}/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      reporter.assert('paid-signup', noReturnRes.status === 400,
        `POST paid signup without returnUrl returns 400 (got ${noReturnRes.status})`, noReturnRes.json);
    } catch (err) {
      reporter.fail('paid-signup', `Paid signup error: ${err.message}`);
    } finally {
      // Best-effort cleanup so the seat goes back into the pool.
      await userApi.request(`/workshops/${paidWorkshopId}/signup`, { method: 'DELETE' });
    }
  }

  const exitCode = reporter.summary();
  process.exit(exitCode);
}

run().catch((err) => {
  console.error('Fatal error in web-api integration test runner:', err.message);
  process.exit(1);
});
