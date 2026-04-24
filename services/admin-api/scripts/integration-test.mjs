import crypto from 'node:crypto';
import { createHttpClient } from './integration/http-client.mjs';
import { createReporter } from './integration/reporter.mjs';

// --- Environment variable validation ---

const REQUIRED_ENV_VARS = ['ADMIN_API_BASE_URL', 'ADMIN_TOKEN'];

function validateEnv() {
  const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(`Missing required environment variable(s): ${missing.join(', ')}`);
    console.error('All of the following must be set:');
    for (const name of REQUIRED_ENV_VARS) {
      console.error(`  ${name}=${process.env[name] ? '✓ set' : '✗ MISSING'}`);
    }
    console.error('\nOptional:');
    console.error(`  ADMIN_API_RUN_STRIPE_MUTATIONS=${process.env.ADMIN_API_RUN_STRIPE_MUTATIONS ? 'true' : 'unset (store create/update assertions are skipped)'}`);
    process.exit(1);
  }
}

// --- Helpers ---

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const STORE_PRODUCT_FIELDS = [
  'id',
  'slug',
  'name',
  'short_description',
  'description',
  'status',
  'kind',
  'fulfillment_type',
  'is_public',
  'is_featured',
  'currency',
  'unit_amount_cents',
  'statement_descriptor',
  'nonprofit_program',
  'impact_summary',
  'image_url',
  'metadata',
  'stripe_product_id',
  'stripe_price_id',
  'created_at',
  'updated_at'
];

function missingFields(item, fields) {
  return fields.filter((f) => !(f in item));
}

// --- Main runner ---

async function run() {
  validateEnv();

  const runPrefix = `ci-${crypto.randomUUID().slice(0, 8)}`;
  console.log(`\nRun_Prefix: ${runPrefix}\n`);

  const adminBase = process.env.ADMIN_API_BASE_URL;
  const adminToken = process.env.ADMIN_TOKEN;
  const runStripeMutations = process.env.ADMIN_API_RUN_STRIPE_MUTATIONS === 'true';

  const noAuthApi = createHttpClient(adminBase);
  const badTokenApi = createHttpClient(adminBase, {
    Authorization: 'Bearer invalid-token-value'
  });
  const adminApi = createHttpClient(adminBase, {
    Authorization: `Bearer ${adminToken}`
  });

  const reporter = createReporter(runPrefix);

  // --- Public Store Listing ---
  // GET /store/products is treated as public inside the authorizer
  // (isPublicRoute bypass), but the API Gateway config requires an
  // Authorization header on every request (Auth.Identity.Headers). That means
  // the handler only fires when a header is present; the authorizer then
  // allows the request through without verifying the token. Sending the admin
  // token keeps the test realistic.
  console.log('\n=== Public Store Listing (authorizer bypass) ===');
  try {
    const res = await adminApi.request('/store/products');
    reporter.assert('public-store', res.status === 200, `GET /store/products returns 200 (got ${res.status})`, res.json);
    reporter.assert('public-store', Array.isArray(res.json?.items), 'GET /store/products has items array', res.json);

    if (Array.isArray(res.json?.items) && res.json.items.length > 0) {
      const item = res.json.items[0];
      const missing = missingFields(item, STORE_PRODUCT_FIELDS);
      reporter.assert('public-store', missing.length === 0,
        missing.length === 0
          ? 'first public product has all expected fields'
          : `first public product is missing fields: ${missing.join(', ')}`,
        item);
      reporter.assert('public-store', item.status === 'active', `first public product has status=active (got ${item.status})`, item);
      reporter.assert('public-store', item.is_public === true, `first public product has is_public=true (got ${item.is_public})`, item);
    } else {
      reporter.skip('public-store', 'no active/public products available for shape checks');
    }
  } catch (err) {
    reporter.fail('public-store', `Public store listing error: ${err.message}`);
  }

  // --- Auth Boundary ---
  console.log('\n=== Auth Boundary ===');
  {
    // Valid RFC-4122 v4 UUID that won't match any real product — the admin-api
    // rejects the all-zeros nil UUID because its version/variant bytes fail
    // the regex, which would make this check the wrong kind of 400.
    const dummyId = '00000000-0000-4000-8000-000000000000';

    // No auth → 401 on admin routes.
    {
      const res = await noAuthApi.request('/admin/store/products');
      reporter.assert('auth-boundary', res.status === 401, `GET /admin/store/products without auth returns 401 (got ${res.status})`, res.json);
    }
    {
      const res = await noAuthApi.request('/admin/store/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: 'should-fail', name: 'should fail' })
      });
      reporter.assert('auth-boundary', res.status === 401, `POST /admin/store/products without auth returns 401 (got ${res.status})`, res.json);
    }
    {
      const res = await noAuthApi.request(`/admin/store/products/${dummyId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: 'should-fail', name: 'should fail' })
      });
      reporter.assert('auth-boundary', res.status === 401, `PUT /admin/store/products/:id without auth returns 401 (got ${res.status})`, res.json);
    }

    // Invalid token → 403. API Gateway returns 401 when the Authorization
    // header is missing (short-circuit via Auth.Identity.Headers) and 403
    // when the Lambda authorizer runs and returns a Deny policy. Both are
    // correct rejection paths — asserting 401 or 403 covers either.
    {
      const res = await badTokenApi.request('/admin/store/products');
      reporter.assert('auth-boundary',
        res.status === 401 || res.status === 403,
        `GET /admin/store/products with invalid token returns 401/403 (got ${res.status})`, res.json);
    }
    {
      const res = await badTokenApi.request('/admin/store/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: 'should-fail', name: 'should fail' })
      });
      reporter.assert('auth-boundary',
        res.status === 401 || res.status === 403,
        `POST /admin/store/products with invalid token returns 401/403 (got ${res.status})`, res.json);
    }
  }

  // --- Admin Store Listing ---
  // GET /admin/store/products returns ALL products (including draft/archived),
  // unlike the public listing which filters to status=active+is_public.
  console.log('\n=== Admin Store Listing ===');
  try {
    const res = await adminApi.request('/admin/store/products');
    reporter.assert('admin-store', res.status === 200, `GET /admin/store/products returns 200 (got ${res.status})`, res.json);
    reporter.assert('admin-store', Array.isArray(res.json?.items), 'GET /admin/store/products has items array', res.json);

    if (Array.isArray(res.json?.items) && res.json.items.length > 0) {
      const item = res.json.items[0];
      const missing = missingFields(item, STORE_PRODUCT_FIELDS);
      reporter.assert('admin-store', missing.length === 0,
        missing.length === 0
          ? 'first admin product has all expected fields'
          : `first admin product is missing fields: ${missing.join(', ')}`,
        item);
      reporter.assert('admin-store', UUID_PATTERN.test(item.id), `first admin product id is a UUID (got ${item.id})`, item);
      reporter.assert('admin-store', ['draft', 'active', 'archived'].includes(item.status),
        `first admin product status is one of draft/active/archived (got ${item.status})`, item);
      reporter.assert('admin-store', typeof item.unit_amount_cents === 'number' && item.unit_amount_cents >= 0,
        `first admin product unit_amount_cents is non-negative (got ${item.unit_amount_cents})`, item);
    } else {
      reporter.skip('admin-store', 'no products available for shape checks');
    }
  } catch (err) {
    reporter.fail('admin-store', `Admin store listing error: ${err.message}`);
  }

  // --- Validation: Create with bad payloads ---
  // Every product write goes through validatePayload before Stripe. These
  // should 400 without reaching Stripe, so they run in every environment.
  console.log('\n=== Admin Store Validation ===');
  try {
    // Valid RFC-4122 v4 UUID that won't match any real product — the admin-api
    // rejects the all-zeros nil UUID because its version/variant bytes fail
    // the regex, which would make this check the wrong kind of 400.
    const dummyId = '00000000-0000-4000-8000-000000000000';

    {
      const res = await adminApi.request('/admin/store/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: ''
      });
      reporter.assert('admin-store-validation', res.status === 400,
        `POST /admin/store/products with empty body returns 400 (got ${res.status})`, res.json);
    }
    {
      const res = await adminApi.request('/admin/store/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not json'
      });
      reporter.assert('admin-store-validation', res.status === 400,
        `POST /admin/store/products with invalid JSON returns 400 (got ${res.status})`, res.json);
    }
    {
      const res = await adminApi.request('/admin/store/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: 'NOT_KEBAB_CASE',
          name: 'Bad Slug Product',
          status: 'draft',
          kind: 'donation',
          fulfillment_type: 'none',
          is_public: false,
          is_featured: false,
          currency: 'usd',
          unit_amount_cents: 500,
          metadata: {}
        })
      });
      reporter.assert('admin-store-validation', res.status === 400,
        `POST with non-kebab slug returns 400 (got ${res.status})`, res.json);
    }
    {
      const res = await adminApi.request('/admin/store/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: 'missing-fields'
        })
      });
      reporter.assert('admin-store-validation', res.status === 400,
        `POST missing required fields returns 400 (got ${res.status})`, res.json);
    }
    {
      const res = await adminApi.request(`/admin/store/products/${dummyId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: 'any-slug',
          name: 'Any Name',
          status: 'draft',
          kind: 'donation',
          fulfillment_type: 'none',
          is_public: false,
          is_featured: false,
          currency: 'usd',
          unit_amount_cents: 0,
          metadata: {}
        })
      });
      // Accepts either 404 (no product with this id) or 503 (Stripe not
      // configured); either proves the request reached the handler after
      // validation passed.
      reporter.assert('admin-store-validation',
        res.status === 404 || res.status === 503,
        `PUT /admin/store/products/:id on unknown id returns 404 or 503 (got ${res.status})`, res.json);
    }
    {
      const res = await adminApi.request('/admin/store/products/not-a-uuid', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: 'any-slug',
          name: 'Any Name',
          status: 'draft',
          kind: 'donation',
          fulfillment_type: 'none',
          is_public: false,
          is_featured: false,
          currency: 'usd',
          unit_amount_cents: 0,
          metadata: {}
        })
      });
      reporter.assert('admin-store-validation', res.status === 400,
        `PUT /admin/store/products/not-a-uuid returns 400 (got ${res.status})`, res.json);
    }
  } catch (err) {
    reporter.fail('admin-store-validation', `Admin store validation error: ${err.message}`);
  }

  // --- Store Create/Update (Stripe side effects, opt-in) ---
  // This scenario mutates Stripe (creates a product + price) so it's gated
  // behind ADMIN_API_RUN_STRIPE_MUTATIONS=true. Run it against a Stripe test-
  // mode secret key; we don't archive the product afterwards, so leave the
  // test-mode products cleanup to the Stripe dashboard.
  console.log('\n=== Store Create/Update (Stripe, opt-in) ===');
  if (!runStripeMutations) {
    reporter.skip('admin-store-mutations', 'ADMIN_API_RUN_STRIPE_MUTATIONS is not true; skipping Stripe-touching create/update');
  } else {
    try {
      const slug = `ci-store-${runPrefix}`;
      const payload = {
        slug,
        name: `CI Store Product ${runPrefix}`,
        short_description: 'Integration test product',
        description: 'Created by admin-api integration tests',
        status: 'draft',
        kind: 'donation',
        fulfillment_type: 'none',
        is_public: false,
        is_featured: false,
        currency: 'usd',
        unit_amount_cents: 500,
        statement_descriptor: null,
        nonprofit_program: null,
        impact_summary: null,
        image_url: null,
        metadata: { integrationRun: runPrefix }
      };

      const createRes = await adminApi.request('/admin/store/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      reporter.assert('admin-store-mutations', createRes.status === 201, `POST /admin/store/products returns 201 (got ${createRes.status})`, createRes.json);
      const product = createRes.json;
      reporter.assert('admin-store-mutations', UUID_PATTERN.test(product?.id ?? ''), `created product id is a UUID (got ${product?.id})`, product);
      reporter.assert('admin-store-mutations', product?.slug === slug, `created product slug matches (got ${product?.slug})`, product);
      reporter.assert('admin-store-mutations', typeof product?.stripe_product_id === 'string' && product.stripe_product_id.length > 0, 'created product has stripe_product_id', product);
      reporter.assert('admin-store-mutations', typeof product?.stripe_price_id === 'string' && product.stripe_price_id.length > 0, 'created product has stripe_price_id', product);

      if (product?.id) {
        const updatePayload = {
          ...payload,
          name: `${payload.name} (updated)`,
          status: 'active',
          is_public: true,
          unit_amount_cents: 750
        };
        const updateRes = await adminApi.request(`/admin/store/products/${product.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatePayload)
        });
        reporter.assert('admin-store-mutations', updateRes.status === 200, `PUT /admin/store/products/:id returns 200 (got ${updateRes.status})`, updateRes.json);
        reporter.assert('admin-store-mutations', updateRes.json?.unit_amount_cents === 750, `updated unit_amount_cents is 750 (got ${updateRes.json?.unit_amount_cents})`, updateRes.json);
        reporter.assert('admin-store-mutations', updateRes.json?.status === 'active', `updated status is active (got ${updateRes.json?.status})`, updateRes.json);
        reporter.assert('admin-store-mutations', updateRes.json?.is_public === true, `updated is_public is true (got ${updateRes.json?.is_public})`, updateRes.json);
        reporter.assert('admin-store-mutations', updateRes.json?.stripe_product_id === product.stripe_product_id, 'stripe_product_id unchanged across update', updateRes.json);
        reporter.assert('admin-store-mutations', updateRes.json?.stripe_price_id && updateRes.json.stripe_price_id !== product.stripe_price_id,
          `stripe_price_id rotates when amount changes (old=${product.stripe_price_id}, new=${updateRes.json?.stripe_price_id})`, updateRes.json);
      }
    } catch (err) {
      reporter.fail('admin-store-mutations', `Store create/update error: ${err.message}`);
    }
  }

  const exitCode = reporter.summary();
  process.exit(exitCode);
}

run().catch((err) => {
  console.error('Fatal error in admin-api integration test runner:', err.message);
  process.exit(1);
});
