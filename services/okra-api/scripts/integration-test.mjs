import crypto from 'node:crypto';
import { createHttpClient } from './integration/http-client.mjs';
import { createReporter } from './integration/reporter.mjs';
import { poll, PollTimeoutError } from './integration/poll.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { createDbClient } from './db-client.mjs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load all fixture images from img/ folder
const CONTENT_TYPE_MAP = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const imgDir = join(__dirname, 'integration', 'img');
const fixtureImages = readdirSync(imgDir)
  .filter((f) => Object.keys(CONTENT_TYPE_MAP).includes(extname(f).toLowerCase()))
  .map((f) => ({
    name: f,
    buffer: readFileSync(join(imgDir, f)),
    contentType: CONTENT_TYPE_MAP[extname(f).toLowerCase()]
  }));

if (fixtureImages.length === 0) {
  console.error('No fixture images found in services/okra-api/scripts/integration/img/');
  process.exit(1);
}

/** Pick a random subset of 1..N images from the fixture pool */
function pickRandomImages() {
  const count = 1 + Math.floor(Math.random() * fixtureImages.length);
  const shuffled = [...fixtureImages].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

// --- Environment variable validation ---

const REQUIRED_ENV_VARS = [
  'API_BASE_URL',
  'ADMIN_API_BASE_URL',
  'ADMIN_TOKEN'
];

function validateEnv() {
  const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(`Missing required environment variable(s): ${missing.join(', ')}`);
    console.error('All of the following must be set:');
    for (const name of REQUIRED_ENV_VARS) {
      console.error(`  ${name}=${process.env[name] ? '✓ set' : '✗ MISSING'}`);
    }
    process.exit(1);
  }
}

// --- Main runner ---

async function run() {
  // 1. Validate env vars
  validateEnv();

  // 2. Generate Run_Prefix and print it
  const runPrefix = `ci-${crypto.randomUUID().slice(0, 8)}`;
  console.log(`\nRun_Prefix: ${runPrefix}\n`);

  // 3. Use pre-generated admin token
  const adminToken = process.env.ADMIN_TOKEN;
  console.log('=== Admin Token ===');
  console.log('  ✓ Using pre-generated admin token from ADMIN_TOKEN env var');

  // 4. Create HTTP clients
  const publicApi = createHttpClient(process.env.API_BASE_URL);
  const adminApi = createHttpClient(process.env.ADMIN_API_BASE_URL, {
    Authorization: `Bearer ${adminToken}`
  });

  // 5. Create reporter
  const reporter = createReporter(runPrefix);

  // Track scenario artifacts for admin listing checks
  let approvalSubmissionId = null;
  let denialSubmissionId = null;
  // Track all created photo IDs for cleanup
  const createdPhotoIds = [];

  /**
   * Clean up all test data created during this run.
   * Uses direct DB access to delete submissions, photos, and reviews by runPrefix.
   */
  async function cleanup() {
    if (!process.env.DATABASE_URL) {
      console.log('\n=== Cleanup skipped (no DATABASE_URL) ===');
      return;
    }
    console.log('\n=== Cleanup ===');
    const db = await createDbClient();
    await db.connect();
    try {
      // Find all submissions created by this run via contributor_name prefix
      const subRes = await db.query(
        `SELECT id FROM submissions WHERE contributor_name LIKE $1`,
        [`[${runPrefix}]%`]
      );
      const subIds = subRes.rows.map((r) => r.id);

      if (subIds.length > 0) {
        // Delete reviews, photos, then submissions (FK order)
        await db.query(`DELETE FROM submission_reviews WHERE submission_id = ANY($1)`, [subIds]);
        await db.query(`DELETE FROM submission_photos WHERE submission_id = ANY($1)`, [subIds]);
        await db.query(`DELETE FROM submissions WHERE id = ANY($1)`, [subIds]);
        console.log(`  ✓ Deleted ${subIds.length} submission(s) and associated records`);
      }

      // Clean up any orphaned photo staging rows from this run
      if (createdPhotoIds.length > 0) {
        const photoRes = await db.query(
          `DELETE FROM submission_photos WHERE id = ANY($1) RETURNING id`,
          [createdPhotoIds]
        );
        if (photoRes.rowCount > 0) {
          console.log(`  ✓ Deleted ${photoRes.rowCount} orphaned photo(s)`);
        }
      }

      if (subIds.length === 0 && createdPhotoIds.length === 0) {
        console.log('  ✓ Nothing to clean up');
      }
    } catch (err) {
      console.error(`  ✗ Cleanup failed: ${err.message}`);
    } finally {
      await db.end();
    }

    // Seed request cleanup (DynamoDB) — best-effort, keyed by runPrefix in the name field
    const tableName = process.env.SEED_REQUESTS_TABLE_NAME;
    if (!tableName) {
      return;
    }
    try {
      const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
      const scanRes = await ddb.send(new ScanCommand({
        TableName: tableName,
        FilterExpression: 'begins_with(#name, :prefix)',
        ExpressionAttributeNames: { '#name': 'name' },
        ExpressionAttributeValues: { ':prefix': `[${runPrefix}]` }
      }));
      const items = scanRes.Items ?? [];
      for (const item of items) {
        await ddb.send(new DeleteCommand({ TableName: tableName, Key: { requestId: item.requestId } }));
      }
      if (items.length > 0) {
        console.log(`  ✓ Deleted ${items.length} seed request(s) from DynamoDB`);
      }
    } catch (err) {
      console.error(`  ✗ Seed request cleanup failed: ${err.message}`);
    }
  }

  // --- Public endpoint checks (Task 3.2) ---
  console.log('\n=== Public Endpoint Checks ===');
  {
    const res = await publicApi.request('/okra');
    reporter.assert('public', res.status === 200, `GET /okra returns 200 (got ${res.status})`, res.json);
    reporter.assert('public', res.json?.total_count !== undefined, 'GET /okra has total_count', res.json);
    reporter.assert('public', res.json?.data !== undefined, 'GET /okra has data', res.json);
  }
  {
    const res = await publicApi.request('/okra/stats');
    reporter.assert('public', res.status === 200, `GET /okra/stats returns 200 (got ${res.status})`, res.json);
    reporter.assert('public', res.json?.total_pins !== undefined, 'GET /okra/stats has total_pins', res.json);
    reporter.assert('public', res.json?.country_count !== undefined, 'GET /okra/stats has country_count', res.json);
    reporter.assert('public', res.json?.contributor_count !== undefined, 'GET /okra/stats has contributor_count', res.json);
  }

  // --- Auth boundary checks (Task 3.3) ---
  console.log('\n=== Auth Boundary Checks ===');
  {
    const noAuthAdmin = createHttpClient(process.env.ADMIN_API_BASE_URL);
    const badTokenAdmin = createHttpClient(process.env.ADMIN_API_BASE_URL, {
      Authorization: 'Bearer invalid-token-value'
    });
    const dummyId = '00000000-0000-0000-0000-000000000000';

    // No auth → 401
    {
      const res = await noAuthAdmin.request('/submissions');
      reporter.assert('auth-boundary', res.status === 401, `GET /admin/submissions without auth returns 401 (got ${res.status})`, res.json);
    }
    {
      const res = await noAuthAdmin.request(`/submissions/${dummyId}/statuses`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'approved' }) });
      reporter.assert('auth-boundary', res.status === 401, `POST /admin/submissions/:id/statuses without auth returns 401 (got ${res.status})`, res.json);
    }

    // Invalid token → 401
    {
      const res = await badTokenAdmin.request('/submissions');
      reporter.assert('auth-boundary', res.status === 401, `GET /admin/submissions with invalid token returns 401 (got ${res.status})`, res.json);
    }
    {
      const res = await badTokenAdmin.request(`/submissions/${dummyId}/statuses`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'approved' }) });
      reporter.assert('auth-boundary', res.status === 401, `POST /admin/submissions/:id/statuses with invalid token returns 401 (got ${res.status})`, res.json);
    }
  }

  // --- Approval Scenario (Task 3.4) ---
  console.log('\n=== Approval Scenario ===');
  try {
    // Step 1 & 2: Upload a random selection of fixture images
    const approvalImages = pickRandomImages();
    console.log(`  Using ${approvalImages.length} image(s): ${approvalImages.map((i) => i.name).join(', ')}`);
    const approvalPhotoIds = [];

    for (const img of approvalImages) {
      const photoRes = await publicApi.request('/photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: img.contentType, fileName: img.name })
      });
      reporter.assert('approval', photoRes.status === 201, `POST /photos returns 201 for ${img.name} (got ${photoRes.status})`, photoRes.json);
      const { photoId, uploadUrl } = photoRes.json ?? {};
      reporter.assert('approval', !!photoId, `POST /photos returns photoId for ${img.name}`, photoRes.json);
      reporter.assert('approval', !!uploadUrl, `POST /photos returns uploadUrl for ${img.name}`, photoRes.json);

      const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': img.contentType },
        body: img.buffer
      });
      reporter.assert('approval', uploadRes.status >= 200 && uploadRes.status < 300, `PUT upload ${img.name} returns 2xx (got ${uploadRes.status})`);
      approvalPhotoIds.push(photoId);
      createdPhotoIds.push(photoId);
    }

    // Step 3: Create submission
    const subRes = await publicApi.request('/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        photoIds: approvalPhotoIds,
        contributorName: `[${runPrefix}] Approval Test Grower`,
        contributorEmail: 'approval-test@okra-test.local',
        rawLocationText: 'Integration Test Location',
        displayLat: 33.749,
        displayLng: -84.388,
        storyText: 'Integration test approval scenario',
        privacyMode: 'exact'
      })
    });
    reporter.assert('approval', subRes.status === 201, `POST /submissions returns 201 (got ${subRes.status})`, subRes.json);
    approvalSubmissionId = subRes.json?.submissionId ?? null;
    reporter.assert('approval', !!approvalSubmissionId, 'POST /submissions returns submissionId', subRes.json);
    reporter.assert('approval', subRes.json?.status === 'pending_review', `POST /submissions status is pending_review (got ${subRes.json?.status})`, subRes.json);

    // Step 4: Poll pending_review listing until submission appears with has_photos: true
    console.log('  Polling pending_review listing for approval submission...');
    const queueResult = await poll({
      fn: () => adminApi.request('/submissions?status=pending_review&limit=100'),
      until: (res) => {
        if (!Array.isArray(res.json?.data)) return false;
        return res.json.data.some(
          (s) => s.id === approvalSubmissionId && s.has_photos === true
        );
      },
      intervalMs: 2000,
      timeoutMs: 60000,
      label: `pending_review listing for approval submission ${approvalSubmissionId}`
    });
    reporter.pass('approval', `Submission ${approvalSubmissionId} appeared in pending_review listing with has_photos: true (${queueResult.attempts} attempts, ${queueResult.elapsedMs}ms)`);

    // Step 5: Approve the submission
    const approveRes = await adminApi.request(`/submissions/${approvalSubmissionId}/statuses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved' })
    });
    reporter.assert('approval', approveRes.json?.status === 'approved', `POST approve returns status=approved (got ${approveRes.json?.status})`, approveRes.json);
    reporter.assert('approval', approveRes.json?.reviewed_at != null, `POST approve returns non-null reviewed_at (got ${approveRes.json?.reviewed_at})`, approveRes.json);

    // Step 6: Poll /okra until approved submission appears in public map data
    console.log('  Polling /okra for approved submission...');
    const okraResult = await poll({
      fn: () => publicApi.request('/okra'),
      until: (res) => {
        if (!Array.isArray(res.json?.data)) return false;
        return res.json.data.some(
          (pin) => pin.id === approvalSubmissionId || (pin.contributor_name && pin.contributor_name.includes(runPrefix))
        );
      },
      intervalMs: 2000,
      timeoutMs: 60000,
      label: `okra map for approved submission ${approvalSubmissionId}`
    });
    reporter.pass('approval', `Approved submission ${approvalSubmissionId} appeared in /okra (${okraResult.attempts} attempts, ${okraResult.elapsedMs}ms)`);
  } catch (err) {
    if (err instanceof PollTimeoutError) {
      reporter.fail('approval', `Poll timeout: ${err.message}`, err.lastResult?.json ?? err.lastResult);
    } else {
      reporter.fail('approval', `Approval scenario error: ${err.message}`);
    }
    console.error('Approval scenario failed:', err.message);
  }

  // --- Denial Scenario (Task 3.5) ---
  console.log('\n=== Denial Scenario ===');
  try {
    // Step 1 & 2: Upload a random selection of fixture images
    const denialImages = pickRandomImages();
    console.log(`  Using ${denialImages.length} image(s): ${denialImages.map((i) => i.name).join(', ')}`);
    const denialPhotoIds = [];

    for (const img of denialImages) {
      const photoRes = await publicApi.request('/photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: img.contentType, fileName: img.name })
      });
      reporter.assert('denial', photoRes.status === 201, `POST /photos returns 201 for ${img.name} (got ${photoRes.status})`, photoRes.json);
      const { photoId, uploadUrl } = photoRes.json ?? {};
      reporter.assert('denial', !!photoId, `POST /photos returns photoId for ${img.name}`, photoRes.json);
      reporter.assert('denial', !!uploadUrl, `POST /photos returns uploadUrl for ${img.name}`, photoRes.json);

      const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': img.contentType },
        body: img.buffer
      });
      reporter.assert('denial', uploadRes.status >= 200 && uploadRes.status < 300, `PUT upload ${img.name} returns 2xx (got ${uploadRes.status})`);
      denialPhotoIds.push(photoId);
      createdPhotoIds.push(photoId);
    }

    // Step 3: Create submission
    const subRes = await publicApi.request('/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        photoIds: denialPhotoIds,
        contributorName: `[${runPrefix}] Denial Test Grower`,
        contributorEmail: 'denial-test@okra-test.local',
        rawLocationText: 'Integration Test Location',
        displayLat: 34.052,
        displayLng: -118.244,
        storyText: 'Integration test denial scenario',
        privacyMode: 'exact'
      })
    });
    reporter.assert('denial', subRes.status === 201, `POST /submissions returns 201 (got ${subRes.status})`, subRes.json);
    denialSubmissionId = subRes.json?.submissionId ?? null;
    reporter.assert('denial', !!denialSubmissionId, 'POST /submissions returns submissionId', subRes.json);

    // Step 4: Poll pending_review listing until submission appears with has_photos: true
    console.log('  Polling pending_review listing for denial submission...');
    const queueResult = await poll({
      fn: () => adminApi.request('/submissions?status=pending_review&limit=100'),
      until: (res) => {
        if (!Array.isArray(res.json?.data)) return false;
        return res.json.data.some(
          (s) => s.id === denialSubmissionId && s.has_photos === true
        );
      },
      intervalMs: 2000,
      timeoutMs: 60000,
      label: `pending_review listing for denial submission ${denialSubmissionId}`
    });
    reporter.pass('denial', `Submission ${denialSubmissionId} appeared in pending_review listing with has_photos: true (${queueResult.attempts} attempts, ${queueResult.elapsedMs}ms)`);

    // Step 5: Deny the submission
    const denyRes = await adminApi.request(`/submissions/${denialSubmissionId}/statuses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'denied', reason: 'spam' })
    });
    reporter.assert('denial', denyRes.json?.status === 'denied', `POST deny returns status=denied (got ${denyRes.json?.status})`, denyRes.json);
    reporter.assert('denial', denyRes.json?.reviewed_at != null, `POST deny returns non-null reviewed_at (got ${denyRes.json?.reviewed_at})`, denyRes.json);

    // Step 6: Poll /okra until denied submission is confirmed absent from public map data
    console.log('  Polling /okra to confirm denied submission is absent...');
    const okraResult = await poll({
      fn: () => publicApi.request('/okra'),
      until: (res) => {
        if (!Array.isArray(res.json?.data)) return false;
        return !res.json.data.some(
          (pin) => pin.id === denialSubmissionId || (pin.contributor_name && pin.contributor_name.includes(runPrefix) && pin.contributor_name.includes('Denial'))
        );
      },
      intervalMs: 2000,
      timeoutMs: 60000,
      label: `okra map for denied submission ${denialSubmissionId}`
    });
    reporter.pass('denial', `Denied submission ${denialSubmissionId} confirmed absent from /okra (${okraResult.attempts} attempts, ${okraResult.elapsedMs}ms)`);
  } catch (err) {
    if (err instanceof PollTimeoutError) {
      reporter.fail('denial', `Poll timeout: ${err.message}`, err.lastResult?.json ?? err.lastResult);
    } else {
      reporter.fail('denial', `Denial scenario error: ${err.message}`);
    }
    console.error('Denial scenario failed:', err.message);
  }

  // --- Seed Request Scenario ---
  console.log('\n=== Seed Request Scenario ===');
  try {
    const idempotencyKey = crypto.randomUUID();
    const mailPayload = {
      name: `[${runPrefix}] Seed Request Tester`,
      email: `seed-request+${runPrefix}@okra-test.local`,
      fulfillmentMethod: 'mail',
      shippingAddress: {
        line1: '100 Garden Lane',
        city: 'Austin',
        region: 'TX',
        postalCode: '73301',
        country: 'US'
      }
    };

    // 1. Missing Idempotency-Key → 400
    {
      const res = await publicApi.request('/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mailPayload)
      });
      reporter.assert('seed-request', res.status === 400, `POST /requests without Idempotency-Key returns 400 (got ${res.status})`, res.json);
      reporter.assert('seed-request', res.json?.error === 'MissingIdempotencyKey', 'error code is MissingIdempotencyKey', res.json);
    }

    // 2. Unsupported country → 422
    {
      const badCountry = { ...mailPayload, shippingAddress: { ...mailPayload.shippingAddress, country: 'GB' } };
      const res = await publicApi.request('/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify(badCountry)
      });
      reporter.assert('seed-request', res.status === 422, `POST /requests with unsupported country returns 422 (got ${res.status})`, res.json);
    }

    // 3. Happy path — US mail request → 201
    const firstRes = await publicApi.request('/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(mailPayload)
    });
    reporter.assert('seed-request', firstRes.status === 201, `POST /requests returns 201 (got ${firstRes.status})`, firstRes.json);
    const firstRequestId = firstRes.json?.requestId ?? null;
    reporter.assert('seed-request', !!firstRequestId, 'POST /requests returns requestId', firstRes.json);

    // 4. Replaying same Idempotency-Key → same requestId (cached by Powertools)
    const replayRes = await publicApi.request('/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(mailPayload)
    });
    reporter.assert('seed-request', replayRes.status === 201, `Replay returns 201 (got ${replayRes.status})`, replayRes.json);
    reporter.assert('seed-request', replayRes.json?.requestId === firstRequestId, `Replay returns cached requestId (got ${replayRes.json?.requestId}, expected ${firstRequestId})`, replayRes.json);

    // 5. In-person exchange → 201 (no shipping address required)
    {
      const inPersonPayload = {
        name: `[${runPrefix}] In-Person Tester`,
        email: `seed-request-inperson+${runPrefix}@okra-test.local`,
        fulfillmentMethod: 'in_person',
        visitDetails: { approximateDate: 'next spring', notes: 'Integration run' }
      };
      const res = await publicApi.request('/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify(inPersonPayload)
      });
      reporter.assert('seed-request', res.status === 201, `In-person POST /requests returns 201 (got ${res.status})`, res.json);
    }
  } catch (err) {
    reporter.fail('seed-request', `Seed request scenario error: ${err.message}`);
    console.error('Seed request scenario failed:', err.message);
  }

  // --- Admin listing checks (Task 3.6) ---
  console.log('\n=== Admin Listing Checks ===');
  {
    // pending_review listing
    const pendingRes = await adminApi.request('/submissions?status=pending_review');
    reporter.assert('admin-listing', Array.isArray(pendingRes.json?.data), 'GET /admin/submissions?status=pending_review has data array', pendingRes.json);
    reporter.assert('admin-listing', pendingRes.json?.cursor !== undefined, 'GET /admin/submissions?status=pending_review has cursor field', pendingRes.json);

    // approved listing
    const approvedRes = await adminApi.request('/submissions?status=approved');
    reporter.assert('admin-listing', Array.isArray(approvedRes.json?.data), 'GET /admin/submissions?status=approved has data array', approvedRes.json);
    reporter.assert('admin-listing', approvedRes.json?.cursor !== undefined, 'GET /admin/submissions?status=approved has cursor field', approvedRes.json);
    if (approvalSubmissionId) {
      const found = Array.isArray(approvedRes.json?.data) && approvedRes.json.data.some((s) => s.id === approvalSubmissionId);
      reporter.assert('admin-listing', found, `Approval submission ${approvalSubmissionId} appears in approved listing`, approvedRes.json);
    }

    // denied listing
    const deniedRes = await adminApi.request('/submissions?status=denied');
    reporter.assert('admin-listing', Array.isArray(deniedRes.json?.data), 'GET /admin/submissions?status=denied has data array', deniedRes.json);
    reporter.assert('admin-listing', deniedRes.json?.cursor !== undefined, 'GET /admin/submissions?status=denied has cursor field', deniedRes.json);
    if (denialSubmissionId) {
      const found = Array.isArray(deniedRes.json?.data) && deniedRes.json.data.some((s) => s.id === denialSubmissionId);
      reporter.assert('admin-listing', found, `Denial submission ${denialSubmissionId} appears in denied listing`, deniedRes.json);
    }
  }

  // --- Summary and exit (Task 3.7) ---
  const exitCode = reporter.summary();
  await cleanup();
  process.exit(exitCode);
}

run().catch(async (err) => {
  console.error('Fatal error in integration test runner:', err.message);
  process.exit(1);
});
