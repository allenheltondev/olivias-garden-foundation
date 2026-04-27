import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { createDbClient } from '../../scripts/db-client.mjs';
import { isUuid } from '../services/photos.mjs';
import { encodeCursor, decodeCursor, errorResponse } from '../services/pagination.mjs';
import { resolveCountry } from '../services/reverse-geocoder.mjs';
import { getAdminStats } from '../services/admin-stats.mjs';

const s3 = new S3Client({});
const eventBridge = new EventBridgeClient({});
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export async function presignPhotoUrl(bucket, key, expiresIn = 900) {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn });
}

const VALID_STATUSES = ['pending_review', 'approved', 'denied'];
const VALID_ACTIONS = ['approved', 'denied'];
const VALID_DENIAL_REASONS = ['spam', 'invalid_location', 'inappropriate', 'other'];
const VALID_REQUEST_ACTIONS = ['handled'];
const VALID_REQUEST_STATUSES = ['open'];

function getSeedRequestsTableName() {
  const tableName = process.env.SEED_REQUESTS_TABLE_NAME;
  if (!tableName) {
    throw new Error('SEED_REQUESTS_TABLE_NAME is not configured');
  }
  return tableName;
}

async function listOpenSeedRequests() {
  const result = await dynamo.send(new ScanCommand({
    TableName: getSeedRequestsTableName(),
    FilterExpression: 'attribute_exists(createdAt) AND (attribute_not_exists(#status) OR #status = :open)',
    ExpressionAttributeNames: {
      '#status': 'requestStatus',
    },
    ExpressionAttributeValues: {
      ':open': 'open',
    },
  }));

  return (result.Items ?? [])
    .filter((item) => {
      const requestId = String(item.requestId ?? '');
      return requestId !== 'stats#seed-requests' && !requestId.startsWith('ratelimit#');
    })
    .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
    .map((item) => ({
      id: item.requestId,
      name: item.name ?? null,
      email: item.email ?? null,
      fulfillmentMethod: item.fulfillmentMethod ?? null,
      shippingAddress: item.shippingAddress ?? null,
      visitDetails: item.visitDetails ?? null,
      message: item.message ?? null,
      createdAt: item.createdAt ?? null,
      requestStatus: item.requestStatus ?? 'open',
    }));
}

async function markSeedRequestHandled(requestId, cognitoSub, reviewNotes) {
  const result = await dynamo.send(new UpdateCommand({
    TableName: getSeedRequestsTableName(),
    Key: { requestId },
    UpdateExpression: 'SET #status = :handled, #handledAt = :handledAt, #handledBy = :handledBy, #notes = :notes',
    ConditionExpression: 'attribute_exists(requestId) AND attribute_exists(createdAt) AND (attribute_not_exists(#status) OR #status = :open)',
    ExpressionAttributeNames: {
      '#status': 'requestStatus',
      '#handledAt': 'handledAt',
      '#handledBy': 'handledByCognitoSub',
      '#notes': 'reviewNotes',
    },
    ExpressionAttributeValues: {
      ':handled': 'handled',
      ':handledAt': new Date().toISOString(),
      ':handledBy': cognitoSub,
      ':notes': reviewNotes ?? null,
      ':open': 'open',
    },
    ReturnValues: 'ALL_NEW',
  }));

  return result.Attributes ?? null;
}

/**
 * Validate and parse the `limit` query parameter (regex-based).
 * Returns { valid: true, value: number } or { valid: false, response: Response }.
 */
function validateLimit(raw) {
  if (raw == null) return { valid: true, value: 20 };
  const trimmed = String(raw).trim();
  if (!/^[0-9]+$/.test(trimmed)) {
    return { valid: false, response: errorResponse(400, 'INVALID_LIMIT', 'Limit must be a positive integer') };
  }
  const parsed = parseInt(trimmed, 10);
  if (parsed === 0) {
    return { valid: false, response: errorResponse(400, 'INVALID_LIMIT', 'Limit must be a positive integer') };
  }
  return { valid: true, value: Math.min(parsed, 100) };
}

/** Validate/parse the 1-indexed `page` query parameter. Defaults to 1. */
function validatePage(raw) {
  if (raw == null) return { valid: true, value: 1 };
  const trimmed = String(raw).trim();
  if (!/^[0-9]+$/.test(trimmed)) {
    return { valid: false, response: errorResponse(400, 'INVALID_PAGE', 'Page must be a positive integer') };
  }
  const parsed = parseInt(trimmed, 10);
  if (parsed === 0) {
    return { valid: false, response: errorResponse(400, 'INVALID_PAGE', 'Page must be a positive integer') };
  }
  return { valid: true, value: parsed };
}

/**
 * Validate and decode the `cursor` query parameter.
 * Returns { valid: true, value: object|null } or { valid: false, response: Response }.
 */
function validateCursor(raw) {
  if (raw == null) return { valid: true, value: null };
  const decoded = decodeCursor(raw);
  if (!decoded) {
    return { valid: false, response: errorResponse(400, 'INVALID_CURSOR', 'Invalid or malformed cursor') };
  }
  return { valid: true, value: decoded };
}

// Upsert the authenticated admin into admin_users and return the row id.
// Anyone reaching this point has already cleared the Admin-group authorizer
// on the admin API Gateway, so auto-provisioning on first review is safe —
// otherwise only the CI-provisioned user could approve/deny, which is how
// human admins were hitting 403 before.
async function resolveAdminUserId(client, authorizer) {
  const cognitoSub = authorizer?.sub;
  if (!cognitoSub) return null;

  const email = authorizer?.email || null;
  const result = await client.query(
    `INSERT INTO admin_users (cognito_sub, email, display_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (cognito_sub) DO UPDATE SET
       email = COALESCE(EXCLUDED.email, admin_users.email),
       updated_at = now()
     RETURNING id`,
    [cognitoSub, email, email]
  );
  return result.rows[0]?.id ?? null;
}

export function registerAdminRoutes(app) {
  app.get('/requests', async (ctx) => {
    const params = ctx.event?.queryStringParameters || {};
    const status = params.status;

    if (!status || !VALID_REQUEST_STATUSES.includes(status)) {
      return errorResponse(
        400,
        'INVALID_STATUS',
        `status query parameter is required. Must be one of: ${VALID_REQUEST_STATUSES.join(', ')}`
      );
    }

    const limitResult = validateLimit(params.limit);
    if (!limitResult.valid) return limitResult.response;
    const limit = limitResult.value;

    const pageResult = validatePage(params.page);
    if (!pageResult.valid) return pageResult.response;
    const page = pageResult.value;

    try {
      const all = await listOpenSeedRequests();
      const total = all.length;
      const start = (page - 1) * limit;
      const data = all.slice(start, start + limit);
      return { data, total, page, limit };
    } catch (err) {
      console.error(JSON.stringify({
        level: 'error',
        message: err instanceof Error ? err.message : String(err),
        errorName: err instanceof Error ? err.name : 'UnknownError',
        endpoint: 'GET /admin/requests',
      }));
      return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
    }
  });

  app.post('/requests/:id/statuses', async (ctx) => {
    const requestId = ctx.params.id;
    const body = JSON.parse(ctx.event.body || '{}');
    const { status, review_notes } = body;

    if (!status || !VALID_REQUEST_ACTIONS.includes(status)) {
      return errorResponse(400, 'INVALID_ACTION', 'status must be one of: handled');
    }

    const cognitoSub = ctx.event.requestContext?.authorizer?.sub;
    if (!cognitoSub) {
      return errorResponse(403, 'FORBIDDEN', 'Admin user not found');
    }

    try {
      const updated = await markSeedRequestHandled(requestId, cognitoSub, review_notes);
      if (!updated) {
        return errorResponse(404, 'NOT_FOUND', 'Seed request not found');
      }

      return {
        id: updated.requestId,
        requestStatus: updated.requestStatus,
        handledAt: updated.handledAt,
        handledByCognitoSub: updated.handledByCognitoSub,
        reviewNotes: updated.reviewNotes ?? null,
      };
    } catch (err) {
      if (err?.name === 'ConditionalCheckFailedException') {
        return errorResponse(409, 'INVALID_STATE', 'Seed request is already handled or missing');
      }

      console.error(JSON.stringify({
        level: 'error',
        message: err instanceof Error ? err.message : String(err),
        errorName: err instanceof Error ? err.name : 'UnknownError',
        endpoint: 'POST /admin/requests/:id/statuses',
        requestId,
      }));
      return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
    }
  });

  // ─── GET /submissions ───────────────────────────────────────────
  // Canonical REST listing. Omit `status` to return every submission. Pass
  // `status=pending` (alias for `pending_review`) for the moderation-queue
  // subset — status='pending_review' AND at least one photo in 'ready'.
  // `status=pending_review` returns every pending_review row regardless of
  // photo status, so callers that are polling for their own just-created
  // submission before the photo processor finishes still see it.
  app.get('/submissions', async (ctx) => {
    const params = ctx.event.queryStringParameters || {};
    const rawStatus = params.status;
    const status = rawStatus === 'pending' ? 'pending_review' : rawStatus;

    if (status !== undefined && status !== null && !VALID_STATUSES.includes(status)) {
      return errorResponse(400, 'INVALID_STATUS', `Invalid status: ${rawStatus}. Must be one of: ${VALID_STATUSES.concat('pending').join(', ')}`);
    }

    const limitResult = validateLimit(params.limit);
    if (!limitResult.valid) return limitResult.response;
    const limit = limitResult.value;

    const cursorResult = validateCursor(params.cursor);
    if (!cursorResult.valid) return cursorResult.response;
    const cursor = cursorResult.value;

    const filterByStatus = Boolean(status);
    const requireReadyPhoto = rawStatus === 'pending';

    const statusClause = filterByStatus ? 's.status = $1' : 'TRUE';
    const photoClause = requireReadyPhoto
      ? `AND EXISTS (
            SELECT 1 FROM submission_photos sp
             WHERE sp.submission_id = s.id AND sp.status = 'ready'
          )`
      : '';
    const baseParams = filterByStatus ? [status] : [];

    const client = await createDbClient();
    await client.connect();
    try {
      // Total count for the same filter (ignores cursor — reflects the full
      // matching set so the UI can render "(N)" counts and page controls).
      const countQuery = `
        SELECT COUNT(*)::int AS total
        FROM submissions s
        WHERE ${statusClause}
          ${photoClause}
      `;
      const countResult = await client.query(countQuery, baseParams);
      let total = countResult.rows[0]?.total ?? 0;

      if (status === 'pending_review') {
        const editCountResult = await client.query(
          `SELECT COUNT(*)::int AS total
             FROM submission_edits
            WHERE status = 'pending_review'`
        );
        total += editCountResult.rows[0]?.total ?? 0;
      }

      let queryText;
      let queryParams;
      if (cursor) {
        const cursorPlaceholder1 = `$${baseParams.length + 1}`;
        const cursorPlaceholder2 = `$${baseParams.length + 2}`;
        const limitPlaceholder = `$${baseParams.length + 3}`;
        queryText = `
          SELECT s.id, s.contributor_name, s.contributor_email, s.story_text,
                 s.raw_location_text, s.privacy_mode, s.display_lat, s.display_lng,
                 s.status, s.created_at,
                 s.created_at::text AS created_at_raw
          FROM submissions s
          WHERE ${statusClause}
            ${photoClause}
            AND (s.created_at, s.id) > (${cursorPlaceholder1}::timestamptz, ${cursorPlaceholder2})
          ORDER BY s.created_at ASC, s.id ASC
          LIMIT ${limitPlaceholder}
        `;
        queryParams = [...baseParams, cursor.created_at, cursor.id, limit + 1];
      } else {
        const limitPlaceholder = `$${baseParams.length + 1}`;
        queryText = `
          SELECT s.id, s.contributor_name, s.contributor_email, s.story_text,
                 s.raw_location_text, s.privacy_mode, s.display_lat, s.display_lng,
                 s.status, s.created_at,
                 s.created_at::text AS created_at_raw
          FROM submissions s
          WHERE ${statusClause}
            ${photoClause}
          ORDER BY s.created_at ASC, s.id ASC
          LIMIT ${limitPlaceholder}
        `;
        queryParams = [...baseParams, limit + 1];
      }

      const submissionsResult = await client.query(queryText, queryParams);
      const rows = submissionsResult.rows;

      let nextCursor = null;
      if (rows.length > limit) {
        rows.pop();
        const lastRow = rows[rows.length - 1];
        nextCursor = encodeCursor(lastRow);
      }

      let allRows = rows;
      if (status === 'pending_review') {
        const offset = cursor ? 0 : rows.length;
        const editLimit = Math.max(0, limit + 1 - offset);
        if (editLimit > 0) {
          const editResult = await client.query(
            `
              SELECT se.id AS edit_id, se.submission_id AS id,
                     se.contributor_name, s.contributor_email, se.story_text,
                     se.raw_location_text, se.privacy_mode, se.display_lat, se.display_lng,
                     se.status, se.created_at, s.contributor_name AS current_contributor_name,
                     s.story_text AS current_story_text, s.raw_location_text AS current_raw_location_text,
                     s.privacy_mode AS current_privacy_mode, s.display_lat AS current_display_lat,
                     s.display_lng AS current_display_lng, s.created_at AS original_created_at,
                     se.created_at::text AS created_at_raw
                FROM submission_edits se
                JOIN submissions s ON s.id = se.submission_id
               WHERE se.status = 'pending_review'
               ORDER BY se.created_at ASC, se.id ASC
               LIMIT $1
            `,
            [editLimit]
          );
          allRows = [...rows, ...editResult.rows];
          if (!nextCursor && allRows.length > limit) {
            allRows.pop();
          }
        }
      }

      if (allRows.length === 0) {
        return { data: [], cursor: null, total };
      }

      const submissionIds = [...new Set(allRows.map((r) => r.id))];
      const photosResult = await client.query(
        `SELECT sp.submission_id, sp.id,
                COALESCE(sp.normalized_s3_key, sp.original_s3_key) AS display_s3_key,
                sp.review_status,
                sep.action AS edit_action
         FROM submission_photos sp
         LEFT JOIN submission_edit_photos sep
           ON sep.photo_id = sp.id
          AND sep.edit_id = ANY($2::uuid[])
         WHERE sp.submission_id = ANY($1)
           AND sp.removed_at IS NULL
         ORDER BY sp.submission_id, sp.created_at ASC`,
        [submissionIds, allRows.map((row) => row.edit_id).filter(Boolean)]
      );

      const photosBySubmission = {};
      for (const photo of photosResult.rows) {
        if (!photosBySubmission[photo.submission_id]) {
          photosBySubmission[photo.submission_id] = [];
        }
        photosBySubmission[photo.submission_id].push({
          key: photo.display_s3_key,
          id: photo.id,
          review_status: photo.review_status,
          edit_action: photo.edit_action
        });
      }

      const bucket = process.env.MEDIA_BUCKET_NAME;
      const data = await Promise.all(
        allRows.map(async (row) => {
          const keys = photosBySubmission[row.id] || [];
          const signedPhotos = await Promise.all(keys.map(async (photo) => ({
            id: photo.id,
            url: await presignPhotoUrl(bucket, photo.key),
            review_status: photo.review_status,
            edit_action: photo.edit_action
          })));
          return {
            id: row.id, contributor_name: row.contributor_name,
            contributor_email: row.contributor_email,
            story_text: row.story_text, raw_location_text: row.raw_location_text,
            privacy_mode: row.privacy_mode, display_lat: row.display_lat,
            display_lng: row.display_lng, status: row.status,
            created_at: row.created_at, photo_count: signedPhotos.length,
            has_photos: signedPhotos.length > 0, photos: signedPhotos.map((photo) => photo.url),
            photo_details: signedPhotos,
            review_kind: row.edit_id ? 'edit' : 'submission',
            edit_id: row.edit_id ?? null,
            current_contributor_name: row.current_contributor_name ?? null,
            current_story_text: row.current_story_text ?? null,
            current_raw_location_text: row.current_raw_location_text ?? null,
            current_privacy_mode: row.current_privacy_mode ?? null,
            current_display_lat: row.current_display_lat ?? null,
            current_display_lng: row.current_display_lng ?? null,
            original_created_at: row.original_created_at ?? null
          };
        })
      );

      return { data, cursor: nextCursor, total };
    } catch (err) {
      console.error(JSON.stringify({
        level: 'error',
        message: err instanceof Error ? err.message : String(err),
        errorName: err instanceof Error ? err.name : 'UnknownError',
        endpoint: 'GET /admin/submissions'
      }));
      return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
    } finally {
      await client.end();
    }
  });

  // ─── POST /submissions/:id/statuses ─────────────────────────────
  app.post('/submissions/:id/statuses', async (ctx) => {
    const submissionId = ctx.params.id;

    if (!isUuid(submissionId)) {
      return errorResponse(400, 'INVALID_ID', 'Submission ID must be a valid UUID');
    }

    const body = JSON.parse(ctx.event.body || '{}');
    const { status, review_notes, display_lat, display_lng, reason, target_edit_id } = body;

    // Validate status field
    if (!status || !VALID_ACTIONS.includes(status)) {
      return errorResponse(400, 'INVALID_ACTION', 'status must be one of: approved, denied');
    }

    if (target_edit_id !== undefined && target_edit_id !== null && !isUuid(target_edit_id)) {
      return errorResponse(400, 'INVALID_ID', 'target_edit_id must be a valid UUID');
    }

    if (status === 'approved') {
      return handleApproval(ctx, submissionId, { review_notes, display_lat, display_lng, target_edit_id });
    }

    return handleDenial(ctx, submissionId, { reason, review_notes, target_edit_id });
  });

  // ─── GET /stats ────────────────────────────────────────────────
  app.get('/stats', async () => {
    try {
      const stats = await getAdminStats();
      return stats;
    } catch (err) {
      console.error(JSON.stringify({
        level: 'error',
        message: err instanceof Error ? err.message : String(err),
        errorName: err instanceof Error ? err.name : 'UnknownError',
        endpoint: 'GET /admin/stats'
      }));
      return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
    }
  });
}

async function handleApproval(ctx, submissionId, { review_notes, display_lat, display_lng, target_edit_id }) {
  const hasLat = display_lat !== undefined && display_lat !== null;
  const hasLng = display_lng !== undefined && display_lng !== null;
  if (hasLat !== hasLng) {
    return errorResponse(400, 'INVALID_COORDINATES', 'Both display_lat and display_lng must be provided together');
  }
  if (hasLat && hasLng) {
    if (typeof display_lat !== 'number' || typeof display_lng !== 'number' ||
        display_lat < -90 || display_lat > 90 || display_lng < -180 || display_lng > 180) {
      return errorResponse(400, 'INVALID_COORDINATES', 'display_lat must be between -90 and 90, display_lng must be between -180 and 180');
    }
  }

  const client = await createDbClient();
  await client.connect();
  let inTxn = false;
  try {
    await client.query('BEGIN');
    inTxn = true;

    // Lock the submission row so contributor PATCH cannot race with admin review.
    const lockResult = await client.query(
      'SELECT id, status FROM submissions WHERE id = $1 FOR UPDATE',
      [submissionId]
    );
    if (lockResult.rows.length === 0) {
      await client.query('ROLLBACK'); inTxn = false;
      return errorResponse(404, 'NOT_FOUND', 'Submission not found');
    }
    const currentStatus = lockResult.rows[0].status;

    const pendingEditResult = await client.query(
      `
        select *
          from submission_edits
         where submission_id = $1
           and status = 'pending_review'
         order by created_at desc
         limit 1
      `,
      [submissionId]
    );
    const pendingEdit = pendingEditResult.rows[0] ?? null;

    if (target_edit_id) {
      if (!pendingEdit || pendingEdit.id !== target_edit_id) {
        await client.query('ROLLBACK'); inTxn = false;
        return errorResponse(404, 'EDIT_NOT_FOUND', 'No pending edit with that id on this submission');
      }
    } else if (pendingEdit) {
      await client.query('ROLLBACK'); inTxn = false;
      return {
        statusCode: 409,
        body: {
          error: { code: 'PENDING_EDIT', message: 'Submission has a pending edit; specify target_edit_id to act on it.' },
          edit_id: pendingEdit.id
        }
      };
    }

    if (pendingEdit) {
      const adminUserId = await resolveAdminUserId(client, ctx.event.requestContext?.authorizer);
      if (!adminUserId) {
        await client.query('ROLLBACK'); inTxn = false;
        return errorResponse(403, 'FORBIDDEN', 'Admin user not found');
      }
      const editResult = await approvePendingEdit(client, submissionId, pendingEdit, adminUserId, {
        review_notes,
        display_lat,
        display_lng,
        hasLat,
        hasLng
      });
      inTxn = false; // approvePendingEdit handles the COMMIT/ROLLBACK
      return editResult;
    }

    if (currentStatus !== 'pending_review') {
      await client.query('ROLLBACK'); inTxn = false;
      return errorResponse(409, 'INVALID_STATE', `Submission is already ${currentStatus}`);
    }

    const photoCountResult = await client.query(
      `SELECT COUNT(*)::int AS count
         FROM submission_photos
        WHERE submission_id = $1
          AND removed_at IS NULL
          AND review_status = 'approved'`,
      [submissionId]
    );
    if (photoCountResult.rows[0].count === 0) {
      await client.query('ROLLBACK'); inTxn = false;
      return errorResponse(400, 'MISSING_PHOTOS', 'At least one photo is required for approval');
    }

    const adminUserId = await resolveAdminUserId(client, ctx.event.requestContext?.authorizer);
    if (!adminUserId) {
      await client.query('ROLLBACK'); inTxn = false;
      return errorResponse(403, 'FORBIDDEN', 'Admin user not found');
    }

    let updateText;
    let updateParams;
    if (hasLat && hasLng) {
      updateText = `UPDATE submissions
        SET status = 'approved', reviewed_by = $2, reviewed_at = now(),
            review_notes = $3, display_lat = $4, display_lng = $5
        WHERE id = $1 AND status = 'pending_review' RETURNING *`;
      updateParams = [submissionId, adminUserId, review_notes || null, display_lat, display_lng];
    } else {
      updateText = `UPDATE submissions
        SET status = 'approved', reviewed_by = $2, reviewed_at = now(),
            review_notes = $3
        WHERE id = $1 AND status = 'pending_review' RETURNING *`;
      updateParams = [submissionId, adminUserId, review_notes || null];
    }

    const updateResult = await client.query(updateText, updateParams);
    if (updateResult.rowCount === 0) {
      // Race condition: status changed between our check and the update
      await client.query('ROLLBACK'); inTxn = false;
      return errorResponse(409, 'INVALID_STATE', 'Submission status changed during processing');
    }

    const row = updateResult.rows[0];
    await client.query(
      `INSERT INTO submission_reviews (submission_id, action, reviewed_by, reviewed_at, notes)
       VALUES ($1, 'approved', $2, now(), $3)`,
      [submissionId, adminUserId, review_notes || null]
    );

    // Resolve country from coordinates and store in the same transaction
    let country = null;
    try {
      country = resolveCountry(row.display_lat, row.display_lng);
      if (country === null) {
        console.warn(JSON.stringify({
          level: 'warn',
          message: 'Reverse geocoder returned null for coordinates',
          display_lat: row.display_lat,
          display_lng: row.display_lng,
          submissionId
        }));
      }
    } catch (geocodeErr) {
      console.error(JSON.stringify({
        level: 'error',
        message: 'Reverse geocoder threw an error',
        error: geocodeErr instanceof Error ? geocodeErr.message : String(geocodeErr),
        submissionId
      }));
      // country remains null — approval still succeeds
    }
    await client.query(
      'UPDATE submissions SET country = $1 WHERE id = $2',
      [country, submissionId]
    );

    await client.query('COMMIT'); inTxn = false;

    const response = {
      id: row.id, contributor_name: row.contributor_name,
      story_text: row.story_text, raw_location_text: row.raw_location_text,
      privacy_mode: row.privacy_mode, display_lat: row.display_lat,
      display_lng: row.display_lng, status: row.status,
      reviewed_by: row.reviewed_by, reviewed_at: row.reviewed_at,
      review_notes: row.review_notes, created_at: row.created_at
    };
    if (row.display_lat === 0 && row.display_lng === 0) {
      response.warnings = [{ code: 'SUSPICIOUS_COORDINATES', message: 'Coordinates are at 0,0 -- verify location is correct' }];
    }
    return response;
  } catch (err) {
    if (inTxn) {
      try { await client.query('ROLLBACK'); } catch (rollbackErr) { void rollbackErr; }
    }
    console.error(JSON.stringify({
      level: 'error',
      message: err instanceof Error ? err.message : String(err),
      errorName: err instanceof Error ? err.name : 'UnknownError',
      endpoint: 'POST /admin/submissions/:id/statuses', submissionId
    }));
    return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
  } finally {
    await client.end();
  }
}

// Caller is responsible for opening the transaction. This helper commits on
// success and rolls back on its own validation failures (returning errorResponse).
async function approvePendingEdit(client, submissionId, edit, adminUserId, { review_notes, display_lat, display_lng, hasLat, hasLng }) {
  try {
    const removeResult = await client.query(
      `
        select photo_id
          from submission_edit_photos
         where edit_id = $1 and action = 'remove'
      `,
      [edit.id]
    );
    const removePhotoIds = removeResult.rows.map((row) => row.photo_id);
    const addResult = await client.query(
      `
        select photo_id
          from submission_edit_photos
         where edit_id = $1 and action = 'add'
      `,
      [edit.id]
    );
    const addPhotoIds = addResult.rows.map((row) => row.photo_id);

    const photoCountResult = await client.query(
      `
        select count(*)::int as count
          from submission_photos
         where submission_id = $1
           and removed_at is null
           and not (id = any($2::uuid[]))
           and (review_status = 'approved' or id = any($3::uuid[]))
      `,
      [submissionId, removePhotoIds, addPhotoIds]
    );
    if (photoCountResult.rows[0].count === 0) {
      await client.query('ROLLBACK');
      return errorResponse(400, 'MISSING_PHOTOS', 'At least one photo is required for approval');
    }

    if (removePhotoIds.length > 0) {
      await client.query(
        `
          update submission_photos
             set removed_at = now()
           where submission_id = $1
             and id = any($2::uuid[])
        `,
        [submissionId, removePhotoIds]
      );
    }
    if (addPhotoIds.length > 0) {
      await client.query(
        `
          update submission_photos
             set review_status = 'approved'
           where submission_id = $1
             and id = any($2::uuid[])
        `,
        [submissionId, addPhotoIds]
      );
    }

    const nextLat = hasLat && hasLng ? display_lat : edit.display_lat;
    const nextLng = hasLat && hasLng ? display_lng : edit.display_lng;
    const country = resolveCountry(nextLat, nextLng);
    const updateResult = await client.query(
      `
        update submissions
           set contributor_name = $2,
               story_text = $3,
               raw_location_text = $4,
               privacy_mode = $5,
               display_lat = $6,
               display_lng = $7,
               reviewed_by = $8,
               reviewed_at = now(),
               review_notes = $9,
               country = $10,
               edit_count = edit_count + 1,
               edited_at = now()
         where id = $1
         returning *
      `,
      [
        submissionId,
        edit.contributor_name,
        edit.story_text,
        edit.raw_location_text,
        edit.privacy_mode,
        nextLat,
        nextLng,
        adminUserId,
        review_notes || null,
        country
      ]
    );

    const row = updateResult.rows[0];
    await client.query(
      `
        update submission_edits
           set status = 'approved',
               reviewed_by = $2,
               reviewed_at = now(),
               review_notes = $3
         where id = $1 and status = 'pending_review'
      `,
      [edit.id, adminUserId, review_notes || null]
    );
    await client.query(
      `INSERT INTO submission_reviews (submission_id, action, reviewed_by, reviewed_at, notes)
       VALUES ($1, 'approved', $2, now(), $3)`,
      [submissionId, adminUserId, review_notes || null]
    );
    await client.query('COMMIT');

    try {
      await eventBridge.send(new PutEventsCommand({
        Entries: [{
          Source: 'okra.api',
          DetailType: 'submission.edit_approved',
          Detail: JSON.stringify({ submissionId, editId: edit.id })
        }]
      }));
    } catch (ebErr) {
      console.error(JSON.stringify({
        level: 'warn',
        message: 'Failed to publish submission edit approval event',
        submissionId,
        editId: edit.id,
        error: ebErr instanceof Error ? ebErr.message : String(ebErr)
      }));
    }

    return {
      id: row.id, contributor_name: row.contributor_name,
      story_text: row.story_text, raw_location_text: row.raw_location_text,
      privacy_mode: row.privacy_mode, display_lat: row.display_lat,
      display_lng: row.display_lng, status: row.status,
      reviewed_by: row.reviewed_by, reviewed_at: row.reviewed_at,
      review_notes: row.review_notes, created_at: row.created_at,
      review_kind: 'edit', edit_id: edit.id
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

async function handleDenial(ctx, submissionId, { reason, review_notes, target_edit_id }) {
  if (!reason || !VALID_DENIAL_REASONS.includes(reason)) {
    return errorResponse(400, 'INVALID_REASON', `Invalid reason. Must be one of: ${VALID_DENIAL_REASONS.join(', ')}`);
  }
  if (reason === 'other' && (!review_notes || review_notes.trim() === '')) {
    return errorResponse(400, 'MISSING_NOTES', 'review_notes is required when reason is "other"');
  }

  const client = await createDbClient();
  await client.connect();
  let inTxn = false;
  try {
    const adminUserId = await resolveAdminUserId(client, ctx.event.requestContext?.authorizer);
    if (!adminUserId) {
      return errorResponse(403, 'FORBIDDEN', 'Admin user not found');
    }

    await client.query('BEGIN');
    inTxn = true;

    const lockResult = await client.query(
      'SELECT id, status FROM submissions WHERE id = $1 FOR UPDATE',
      [submissionId]
    );
    if (lockResult.rows.length === 0) {
      await client.query('ROLLBACK'); inTxn = false;
      return errorResponse(404, 'NOT_FOUND', 'Submission not found');
    }

    const pendingEditResult = await client.query(
      `
        select id
          from submission_edits
         where submission_id = $1
           and status = 'pending_review'
         order by created_at desc
         limit 1
      `,
      [submissionId]
    );
    const pendingEdit = pendingEditResult.rows[0] ?? null;

    if (target_edit_id) {
      if (!pendingEdit || pendingEdit.id !== target_edit_id) {
        await client.query('ROLLBACK'); inTxn = false;
        return errorResponse(404, 'EDIT_NOT_FOUND', 'No pending edit with that id on this submission');
      }
    } else if (pendingEdit) {
      await client.query('ROLLBACK'); inTxn = false;
      return {
        statusCode: 409,
        body: {
          error: { code: 'PENDING_EDIT', message: 'Submission has a pending edit; specify target_edit_id to act on it.' },
          edit_id: pendingEdit.id
        }
      };
    }

    if (pendingEdit) {
      const editId = pendingEdit.id;
      const updateEditResult = await client.query(
        `
          update submission_edits
             set status = 'denied',
                 reviewed_by = $2,
                 reviewed_at = now(),
                 review_notes = $3,
                 denial_reason = $4
           where id = $1 and status = 'pending_review'
           returning *
        `,
        [editId, adminUserId, review_notes || null, reason]
      );
      if (updateEditResult.rowCount === 0) {
        await client.query('ROLLBACK'); inTxn = false;
        return errorResponse(409, 'INVALID_STATE', 'Submission edit is already reviewed');
      }
      await client.query(
        `INSERT INTO submission_reviews (submission_id, action, reason, reviewed_by, reviewed_at, notes)
         VALUES ($1, 'denied', $2, $3, now(), $4)`,
        [submissionId, reason, adminUserId, review_notes || null]
      );
      await client.query(
        `
          update submission_photos sp
             set review_status = 'denied',
                 removed_at = now()
            from submission_edit_photos sep
           where sep.photo_id = sp.id
             and sep.edit_id = $1
             and sep.action = 'add'
             and sp.removed_at is null
        `,
        [editId]
      );
      await client.query('COMMIT'); inTxn = false;
      try {
        await eventBridge.send(new PutEventsCommand({
          Entries: [{
            Source: 'okra.api',
            DetailType: 'submission.edit_denied',
            Detail: JSON.stringify({ submissionId, editId })
          }]
        }));
      } catch (ebErr) {
        console.error(JSON.stringify({
          level: 'warn',
          message: 'Failed to publish submission edit denial event',
          submissionId,
          editId,
          error: ebErr instanceof Error ? ebErr.message : String(ebErr)
        }));
      }
      return {
        id: submissionId,
        status: 'approved',
        review_kind: 'edit',
        edit_id: editId,
        reviewed_by: adminUserId,
        reviewed_at: updateEditResult.rows[0].reviewed_at,
        review_notes: review_notes || null
      };
    }

    const updateResult = await client.query(
      `UPDATE submissions
       SET status = 'denied', reviewed_by = $2, reviewed_at = now(), review_notes = $3
       WHERE id = $1 AND status = 'pending_review' RETURNING *`,
      [submissionId, adminUserId, review_notes || null]
    );

    if (updateResult.rowCount === 0) {
      const currentStatus = lockResult.rows[0].status;
      await client.query('ROLLBACK'); inTxn = false;
      return errorResponse(409, 'INVALID_STATE', `Submission is already ${currentStatus}`);
    }

    const row = updateResult.rows[0];
    await client.query(
      `INSERT INTO submission_reviews (submission_id, action, reason, reviewed_by, reviewed_at, notes)
       VALUES ($1, 'denied', $2, $3, now(), $4)`,
      [submissionId, reason, adminUserId, review_notes || null]
    );
    await client.query('COMMIT'); inTxn = false;

    try {
      await eventBridge.send(new PutEventsCommand({
        Entries: [{
          Source: 'okra.api',
          DetailType: 'SubmissionDenied',
          Detail: JSON.stringify({ submissionId })
        }]
      }));
    } catch (ebErr) {
      console.error(JSON.stringify({
        level: 'warn',
        message: 'Failed to publish cleanup event',
        submissionId,
        error: ebErr instanceof Error ? ebErr.message : String(ebErr)
      }));
    }

    return {
      id: row.id, contributor_name: row.contributor_name,
      story_text: row.story_text, raw_location_text: row.raw_location_text,
      privacy_mode: row.privacy_mode, display_lat: row.display_lat,
      display_lng: row.display_lng, status: row.status,
      reviewed_by: row.reviewed_by, reviewed_at: row.reviewed_at,
      review_notes: row.review_notes, created_at: row.created_at
    };
  } catch (err) {
    if (inTxn) {
      try { await client.query('ROLLBACK'); } catch (rollbackErr) { void rollbackErr; }
    }
    console.error(JSON.stringify({
      level: 'error',
      message: err instanceof Error ? err.message : String(err),
      errorName: err instanceof Error ? err.name : 'UnknownError',
      endpoint: 'POST /admin/submissions/:id/statuses', submissionId
    }));
    return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
  } finally {
    await client.end();
  }
}
