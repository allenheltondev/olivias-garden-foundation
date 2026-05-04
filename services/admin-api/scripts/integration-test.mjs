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
  'legacy_image_url',
  'image_urls',
  'images',
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
        images: [],
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

  // --- Workshops (admin-side, no external side effects) ---
  // The full workshop lifecycle is exercised here: create, list, fetch by id,
  // update, list signups (empty), then delete. Workshops live entirely in
  // Postgres so this scenario runs in every environment; cleanup happens
  // inline via the DELETE endpoint.
  console.log('\n=== Admin Workshops Auth Boundary ===');
  {
    const dummyId = '00000000-0000-4000-8000-000000000000';
    {
      const res = await noAuthApi.request('/admin/workshops');
      reporter.assert('admin-workshops-auth', res.status === 401, `GET /admin/workshops without auth returns 401 (got ${res.status})`, res.json);
    }
    {
      const res = await noAuthApi.request('/admin/workshops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: 'should-fail', title: 'should fail', status: 'coming_soon' })
      });
      reporter.assert('admin-workshops-auth', res.status === 401, `POST /admin/workshops without auth returns 401 (got ${res.status})`, res.json);
    }
    {
      const res = await noAuthApi.request(`/admin/workshops/${dummyId}`);
      reporter.assert('admin-workshops-auth', res.status === 401, `GET /admin/workshops/:id without auth returns 401 (got ${res.status})`, res.json);
    }
    {
      const res = await badTokenApi.request('/admin/workshops');
      reporter.assert('admin-workshops-auth',
        res.status === 401 || res.status === 403,
        `GET /admin/workshops with invalid token returns 401/403 (got ${res.status})`, res.json);
    }
  }

  console.log('\n=== Admin Workshops Validation ===');
  {
    const dummyId = '00000000-0000-4000-8000-000000000000';
    {
      const res = await adminApi.request('/admin/workshops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: ''
      });
      reporter.assert('admin-workshops-validation', res.status === 400, `POST /admin/workshops with empty body returns 400 (got ${res.status})`, res.json);
    }
    {
      const res = await adminApi.request('/admin/workshops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: 'NOT_KEBAB', title: 'x', status: 'coming_soon' })
      });
      reporter.assert('admin-workshops-validation', res.status === 400, `POST /admin/workshops with non-kebab slug returns 400 (got ${res.status})`, res.json);
    }
    {
      const res = await adminApi.request('/admin/workshops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: 'ok', title: 'ok', status: 'invalid_status' })
      });
      reporter.assert('admin-workshops-validation', res.status === 400, `POST /admin/workshops with bad status returns 400 (got ${res.status})`, res.json);
    }
    {
      const res = await adminApi.request(`/admin/workshops/${dummyId}`);
      reporter.assert('admin-workshops-validation', res.status === 404, `GET /admin/workshops/:unknown-id returns 404 (got ${res.status})`, res.json);
    }
    {
      const res = await adminApi.request('/admin/workshops/not-a-uuid');
      reporter.assert('admin-workshops-validation', res.status === 400, `GET /admin/workshops/not-a-uuid returns 400 (got ${res.status})`, res.json);
    }
  }

  console.log('\n=== Admin Workshops CRUD ===');
  {
    let createdWorkshopId = null;
    try {
      const slug = `ci-workshop-${runPrefix}`;
      const createPayload = {
        slug,
        title: `CI Workshop ${runPrefix}`,
        short_description: 'Integration test workshop',
        description: 'Created by admin-api integration tests',
        status: 'gauging_interest',
        workshop_date: '2027-06-15T18:00:00.000Z',
        location: 'Test Garden',
        capacity: 12,
        image_s3_key: null
      };

      const createRes = await adminApi.request('/admin/workshops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createPayload)
      });
      reporter.assert('admin-workshops-crud', createRes.status === 201, `POST /admin/workshops returns 201 (got ${createRes.status})`, createRes.json);
      const created = createRes.json;
      reporter.assert('admin-workshops-crud', UUID_PATTERN.test(created?.id ?? ''), `created workshop id is a UUID (got ${created?.id})`, created);
      reporter.assert('admin-workshops-crud', created?.slug === slug, `created workshop slug matches (got ${created?.slug})`, created);
      reporter.assert('admin-workshops-crud', created?.status === 'gauging_interest', `created workshop status is gauging_interest (got ${created?.status})`, created);
      reporter.assert('admin-workshops-crud', created?.capacity === 12, `created workshop capacity is 12 (got ${created?.capacity})`, created);
      createdWorkshopId = created?.id ?? null;

      if (createdWorkshopId) {
        const listRes = await adminApi.request('/admin/workshops');
        reporter.assert('admin-workshops-crud', listRes.status === 200, `GET /admin/workshops returns 200 (got ${listRes.status})`, listRes.json);
        const listFound = Array.isArray(listRes.json?.items) && listRes.json.items.some((w) => w.id === createdWorkshopId);
        reporter.assert('admin-workshops-crud', listFound, 'created workshop appears in admin list', listRes.json);

        const getRes = await adminApi.request(`/admin/workshops/${createdWorkshopId}`);
        reporter.assert('admin-workshops-crud', getRes.status === 200, `GET /admin/workshops/:id returns 200 (got ${getRes.status})`, getRes.json);
        reporter.assert('admin-workshops-crud', getRes.json?.id === createdWorkshopId, 'GET /admin/workshops/:id returns the right workshop', getRes.json);
        reporter.assert('admin-workshops-crud',
          getRes.json?.signup_counts?.registered === 0 && getRes.json?.signup_counts?.waitlisted === 0 && getRes.json?.signup_counts?.interested === 0,
          'newly-created workshop has zero signup counts', getRes.json);

        const updatePayload = {
          ...createPayload,
          title: `${createPayload.title} (updated)`,
          status: 'open',
          capacity: 20
        };
        const updateRes = await adminApi.request(`/admin/workshops/${createdWorkshopId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatePayload)
        });
        reporter.assert('admin-workshops-crud', updateRes.status === 200, `PUT /admin/workshops/:id returns 200 (got ${updateRes.status})`, updateRes.json);
        reporter.assert('admin-workshops-crud', updateRes.json?.status === 'open', `updated status is open (got ${updateRes.json?.status})`, updateRes.json);
        reporter.assert('admin-workshops-crud', updateRes.json?.capacity === 20, `updated capacity is 20 (got ${updateRes.json?.capacity})`, updateRes.json);

        const signupsRes = await adminApi.request(`/admin/workshops/${createdWorkshopId}/signups`);
        reporter.assert('admin-workshops-crud', signupsRes.status === 200, `GET /admin/workshops/:id/signups returns 200 (got ${signupsRes.status})`, signupsRes.json);
        reporter.assert('admin-workshops-crud', Array.isArray(signupsRes.json?.items) && signupsRes.json.items.length === 0, 'newly-created workshop has empty signups list', signupsRes.json);
      }
    } catch (err) {
      reporter.fail('admin-workshops-crud', `Admin workshops CRUD error: ${err.message}`);
    } finally {
      if (createdWorkshopId) {
        const deleteRes = await adminApi.request(`/admin/workshops/${createdWorkshopId}`, { method: 'DELETE' });
        reporter.assert('admin-workshops-crud', deleteRes.status === 200, `DELETE /admin/workshops/:id returns 200 (got ${deleteRes.status})`, deleteRes.json);
      }
    }
  }

  console.log('\n=== Admin Workshop Image Upload Intent ===');
  try {
    const res = await adminApi.request('/admin/workshops/image-upload-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentType: 'image/jpeg', contentLength: 1024 })
    });
    reporter.assert('admin-workshops-image', res.status === 201, `POST /admin/workshops/image-upload-intent returns 201 (got ${res.status})`, res.json);
    reporter.assert('admin-workshops-image', typeof res.json?.uploadUrl === 'string' && res.json.uploadUrl.startsWith('https://'), 'response includes https uploadUrl', res.json);
    reporter.assert('admin-workshops-image', typeof res.json?.s3Key === 'string' && res.json.s3Key.startsWith('workshops/'), 'response includes s3Key under workshops/', res.json);

    const badTypeRes = await adminApi.request('/admin/workshops/image-upload-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentType: 'text/plain', contentLength: 1024 })
    });
    reporter.assert('admin-workshops-image', badTypeRes.status === 400, `POST /admin/workshops/image-upload-intent with bad content type returns 400 (got ${badTypeRes.status})`, badTypeRes.json);
  } catch (err) {
    reporter.fail('admin-workshops-image', `Admin workshop image upload intent error: ${err.message}`);
  }

  // --- Paid workshop validation (no Stripe touch) ---
  // These tests verify the validate-payload path without actually calling
  // Stripe. They run in every environment.
  console.log('\n=== Admin Workshops Paid Validation ===');
  try {
    {
      // is_paid=true with no price_cents → 400 before Stripe is called
      const res = await adminApi.request('/admin/workshops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: `ci-paid-bad-${runPrefix}`,
          title: 'paid no price',
          status: 'coming_soon',
          is_paid: true
        })
      });
      reporter.assert('admin-workshops-paid-validation', res.status === 400,
        `POST is_paid=true with no price_cents returns 400 (got ${res.status})`, res.json);
    }
    {
      // is_paid=true with price_cents below the $0.50 floor → 400
      const res = await adminApi.request('/admin/workshops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: `ci-paid-low-${runPrefix}`,
          title: 'paid too low',
          status: 'coming_soon',
          is_paid: true,
          price_cents: 10,
          currency: 'usd'
        })
      });
      reporter.assert('admin-workshops-paid-validation', res.status === 400,
        `POST is_paid=true with price_cents=10 returns 400 (got ${res.status})`, res.json);
    }
  } catch (err) {
    reporter.fail('admin-workshops-paid-validation', `Paid validation error: ${err.message}`);
  }

  // --- Paid workshop create/update (Stripe side effects, opt-in) ---
  // Mutates Stripe (creates a product + price). Gated behind
  // ADMIN_API_RUN_STRIPE_MUTATIONS=true. Run against a Stripe test-mode
  // secret key. The test cleans up by deleting the workshop, which
  // archives the Stripe product as a side effect.
  console.log('\n=== Admin Paid Workshops (Stripe, opt-in) ===');
  if (!runStripeMutations) {
    reporter.skip('admin-workshops-paid-mutations', 'ADMIN_API_RUN_STRIPE_MUTATIONS is not true; skipping Stripe-touching paid workshop scenario');
  } else {
    let createdWorkshopId = null;
    try {
      const slug = `ci-paid-workshop-${runPrefix}`;
      const createPayload = {
        slug,
        title: `CI Paid Workshop ${runPrefix}`,
        short_description: 'Paid integration test workshop',
        description: 'Created by admin-api integration tests',
        status: 'open',
        workshop_date: '2027-07-15T18:00:00.000Z',
        location: 'Test Garden',
        capacity: 8,
        image_s3_key: null,
        is_paid: true,
        price_cents: 2500,
        currency: 'usd'
      };

      const createRes = await adminApi.request('/admin/workshops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createPayload)
      });
      reporter.assert('admin-workshops-paid-mutations', createRes.status === 201, `POST paid workshop returns 201 (got ${createRes.status})`, createRes.json);
      const created = createRes.json;
      createdWorkshopId = created?.id ?? null;
      reporter.assert('admin-workshops-paid-mutations', created?.is_paid === true, 'created workshop has is_paid=true', created);
      reporter.assert('admin-workshops-paid-mutations', created?.price_cents === 2500, `created price_cents is 2500 (got ${created?.price_cents})`, created);
      reporter.assert('admin-workshops-paid-mutations', typeof created?.stripe_product_id === 'string' && created.stripe_product_id.startsWith('prod_'),
        `stripe_product_id is set and starts with prod_ (got ${created?.stripe_product_id})`, created);
      reporter.assert('admin-workshops-paid-mutations', typeof created?.stripe_price_id === 'string' && created.stripe_price_id.startsWith('price_'),
        `stripe_price_id is set and starts with price_ (got ${created?.stripe_price_id})`, created);

      if (createdWorkshopId) {
        // Bump the price to verify the Stripe price rotates while the
        // product id stays put.
        const updatePayload = { ...createPayload, price_cents: 3000 };
        const updateRes = await adminApi.request(`/admin/workshops/${createdWorkshopId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatePayload)
        });
        reporter.assert('admin-workshops-paid-mutations', updateRes.status === 200, `PUT paid workshop returns 200 (got ${updateRes.status})`, updateRes.json);
        reporter.assert('admin-workshops-paid-mutations', updateRes.json?.price_cents === 3000, `updated price_cents is 3000 (got ${updateRes.json?.price_cents})`, updateRes.json);
        reporter.assert('admin-workshops-paid-mutations', updateRes.json?.stripe_product_id === created.stripe_product_id, 'stripe_product_id unchanged across price update', updateRes.json);
        reporter.assert('admin-workshops-paid-mutations',
          typeof updateRes.json?.stripe_price_id === 'string' && updateRes.json.stripe_price_id !== created.stripe_price_id,
          `stripe_price_id rotates when price changes (old=${created.stripe_price_id}, new=${updateRes.json?.stripe_price_id})`, updateRes.json);

        // Flip back to free; Stripe IDs should null out.
        const flipFreeRes = await adminApi.request(`/admin/workshops/${createdWorkshopId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...createPayload, is_paid: false, price_cents: null })
        });
        reporter.assert('admin-workshops-paid-mutations', flipFreeRes.status === 200, `PUT paid→free returns 200 (got ${flipFreeRes.status})`, flipFreeRes.json);
        reporter.assert('admin-workshops-paid-mutations', flipFreeRes.json?.is_paid === false, 'flipped to is_paid=false', flipFreeRes.json);
        reporter.assert('admin-workshops-paid-mutations', flipFreeRes.json?.stripe_product_id === null, 'stripe_product_id is null after flip to free', flipFreeRes.json);
        reporter.assert('admin-workshops-paid-mutations', flipFreeRes.json?.stripe_price_id === null, 'stripe_price_id is null after flip to free', flipFreeRes.json);
      }
    } catch (err) {
      reporter.fail('admin-workshops-paid-mutations', `Paid workshop scenario error: ${err.message}`);
    } finally {
      if (createdWorkshopId) {
        const deleteRes = await adminApi.request(`/admin/workshops/${createdWorkshopId}`, { method: 'DELETE' });
        reporter.assert('admin-workshops-paid-mutations', deleteRes.status === 200, `DELETE paid workshop returns 200 (got ${deleteRes.status})`, deleteRes.json);
      }
    }
  }

  const exitCode = reporter.summary();
  process.exit(exitCode);
}

run().catch((err) => {
  console.error('Fatal error in admin-api integration test runner:', err.message);
  process.exit(1);
});
